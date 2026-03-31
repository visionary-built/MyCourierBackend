const CargoBag = require("../models/CargoBag");
const CargoManifest = require("../models/CargoManifest");
const BookingStatus = require("../models/bookingStatus");
const ManualBooking = require("../models/ManualBooking");
const {
  appendCargoNoteToBookings
} = require("../services/cargoLinkageService");

const ALLOWED_ROLES = ["superAdmin", "admin", "operation", "operationPortal"];

const normalizeCN = (numbers = []) =>
  [...new Set(numbers.map((cn) => String(cn).trim().toUpperCase()).filter(Boolean))];

const normalizeBagTokens = (values = []) =>
  [...new Set(values.map((v) => String(v).trim().toUpperCase()).filter(Boolean))];

/** Expected bag numbers for a manifest (bagNumbers or resolved from bagIds). */
async function getExpectedBagNumbersForManifest(manifest) {
  let expected = normalizeBagTokens(manifest.bagNumbers || []);
  if (expected.length === 0 && Array.isArray(manifest.bagIds) && manifest.bagIds.length > 0) {
    const bagDocs = await CargoBag.find({ _id: { $in: manifest.bagIds } })
      .select("bagNo")
      .lean();
    expected = normalizeBagTokens(bagDocs.map((b) => b.bagNo));
  }
  return expected;
}

function verifyBagsAgainstExpected(expected, scanned) {
  const expectedSet = new Set(expected);
  const scannedSet = new Set(scanned);
  const matchedBags = scanned.filter((bn) => expectedSet.has(bn));
  const unexpectedBags = scanned.filter((bn) => !expectedSet.has(bn));
  const missingBags = expected.filter((bn) => !scannedSet.has(bn));
  return {
    totals: {
      expectedBags: expected.length,
      scanned: scanned.length,
      matched: matchedBags.length,
      missing: missingBags.length,
      unexpected: unexpectedBags.length
    },
    matchedBags,
    missingBags,
    unexpectedBags,
    isComplete: missingBags.length === 0 && unexpectedBags.length === 0
  };
}

function verifyConsignmentsAgainstExpected(expected, scanned) {
  const expectedSet = new Set(expected);
  const scannedSet = new Set(scanned);
  const matchedConsignments = scanned.filter((cn) => expectedSet.has(cn));
  const unexpectedConsignments = scanned.filter((cn) => !expectedSet.has(cn));
  const missingConsignments = expected.filter((cn) => !scannedSet.has(cn));
  return {
    totals: {
      expected: expected.length,
      scanned: scanned.length,
      matched: matchedConsignments.length,
      missing: missingConsignments.length,
      unexpected: unexpectedConsignments.length
    },
    matchedConsignments,
    missingConsignments,
    unexpectedConsignments,
    isComplete: missingConsignments.length === 0 && unexpectedConsignments.length === 0
  };
}

const isAuthorized = (req) => req.user && ALLOWED_ROLES.includes(req.user.role);

exports.createBag = async (req, res) => {
  try {
    if (!isAuthorized(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { originCity, destinationCity, consignmentNumbers = [], remarks, seal } = req.body;
    const normalizedCNs = normalizeCN(consignmentNumbers);
    const normalizedSeal = seal != null ? String(seal).trim().toUpperCase() : undefined;

    if (!originCity || !destinationCity || normalizedCNs.length === 0) {
      return res.status(400).json({
        success: false,
        message: "originCity, destinationCity and consignmentNumbers are required"
      });
    }

    const [existingBookings, existingManual] = await Promise.all([
      BookingStatus.find({
        consignmentNumber: { $in: normalizedCNs }
      }).select("consignmentNumber"),
      ManualBooking.find({
        consignmentNo: { $in: normalizedCNs }
      }).select("consignmentNo")
    ]);

    const foundSet = new Set([
      ...existingBookings.map((b) => b.consignmentNumber),
      ...existingManual.map((m) => m.consignmentNo)
    ]);
    const missing = normalizedCNs.filter((cn) => !foundSet.has(cn));
    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Some consignment numbers were not found",
        missingConsignments: missing
      });
    }

    const bag = await CargoBag.create({
      originCity,
      destinationCity,
      consignmentNumbers: normalizedCNs,
      remarks,
      seal: normalizedSeal,
      createdByRole: req.user.role,
      createdById: String(req.user.id || req.user._id || "")
    });

    await appendCargoNoteToBookings(normalizedCNs, {
      remarks: `Cargo: added to bag ${bag.bagNo} (${originCity} → ${destinationCity})`,
      updatedBy: req.user.role
    });

    return res.status(201).json({
      success: true,
      message: "Bag created successfully",
      data: bag
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

exports.markBagInTransit = async (req, res) => {
  try {
    if (!isAuthorized(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { id } = req.params;
    const { remarks } = req.body;
    const bag = await CargoBag.findById(id);
    if (!bag) {
      return res.status(404).json({ success: false, message: "Bag not found" });
    }

    bag.status = "in-transit";
    bag.inTransitAt = new Date();
    if (remarks) bag.remarks = remarks;
    await bag.save();

    await BookingStatus.updateMany(
      { consignmentNumber: { $in: bag.consignmentNumbers } },
      {
        $set: { status: "in-transit" },
        $push: {
          statusHistory: {
            status: "in-transit",
            timestamp: new Date(),
            remarks: `Moved to in-transit via Bag ${bag.bagNo}`,
            updatedBy: req.user.role
          }
        }
      }
    );

    await ManualBooking.updateMany(
      { consignmentNo: { $in: bag.consignmentNumbers } },
      {
        $set: { status: "in-transit" },
        $push: {
          statusHistory: {
            status: "in-transit",
            timestamp: new Date(),
            remarks: `Moved to in-transit via Bag ${bag.bagNo}`,
            updatedBy: req.user.role
          }
        }
      }
    );

    return res.status(200).json({
      success: true,
      message: "Bag marked as in-transit",
      data: bag
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

exports.receiveBag = async (req, res) => {
  try {
    if (!isAuthorized(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { id } = req.params;
    const { remarks } = req.body;
    const bag = await CargoBag.findById(id);
    if (!bag) {
      return res.status(404).json({ success: false, message: "Bag not found" });
    }

    if (bag.status === "cancelled") {
      return res.status(400).json({ success: false, message: "Cancelled bag cannot be received" });
    }
    if (bag.status === "completed") {
      return res.status(400).json({ success: false, message: "Bag is already received" });
    }

    bag.status = "completed";
    bag.completedAt = new Date();
    if (remarks) bag.remarks = remarks;
    await bag.save();

    await BookingStatus.updateMany(
      { consignmentNumber: { $in: bag.consignmentNumbers } },
      {
        $set: { status: "completed" },
        $push: {
          statusHistory: {
            status: "completed",
            timestamp: new Date(),
            remarks: `Received via Bag ${bag.bagNo}`,
            updatedBy: req.user.role
          }
        }
      }
    );

    await ManualBooking.updateMany(
      { consignmentNo: { $in: bag.consignmentNumbers } },
      {
        $set: { status: "completed" },
        $push: {
          statusHistory: {
            status: "completed",
            timestamp: new Date(),
            remarks: `Received via Bag ${bag.bagNo}`,
            updatedBy: req.user.role
          }
        }
      }
    );

    await appendCargoNoteToBookings(bag.consignmentNumbers, {
      remarks: `Cargo: bag ${bag.bagNo} received at destination`,
      updatedBy: req.user.role
    });

    return res.status(200).json({
      success: true,
      message: "Bag received successfully",
      data: bag
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

exports.getBagHistory = async (req, res) => {
  try {
    if (!isAuthorized(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { status, page = 1, limit = 20 } = req.query;
    const query = {};
    if (status) query.status = status;

    const pageNo = parseInt(page, 10);
    const size = parseInt(limit, 10);
    const skip = (pageNo - 1) * size;

    const [bags, total] = await Promise.all([
      CargoBag.find(query).sort({ createdAt: -1 }).skip(skip).limit(size),
      CargoBag.countDocuments(query)
    ]);

    return res.status(200).json({
      success: true,
      data: bags,
      pagination: {
        page: pageNo,
        limit: size,
        total,
        totalPages: Math.ceil(total / size)
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

exports.getBagDetail = async (req, res) => {
  try {
    if (!isAuthorized(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { id } = req.params;
    const bag = await CargoBag.findById(id).lean();
    if (!bag) {
      return res.status(404).json({ success: false, message: "Bag not found" });
    }

    const expected = normalizeCN(bag.consignmentNumbers || []);
    const received = normalizeCN(bag.receivedConsignmentNumbers || []);
    const cnVerification = verifyConsignmentsAgainstExpected(expected, received);

    return res.status(200).json({
      success: true,
      data: {
        bag,
        summary: {
          expectedConsignmentNumbers: expected,
          receivedConsignmentNumbers: received,
          expectedCount: expected.length
        },
        cnVerification: {
          bagId: bag._id,
          bagNo: bag.bagNo,
          ...cnVerification
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

exports.checkBagConsignments = async (req, res) => {
  try {
    if (!isAuthorized(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { id } = req.params;
    const bag = await CargoBag.findById(id).lean();
    if (!bag) {
      return res.status(404).json({ success: false, message: "Bag not found" });
    }

    const expected = normalizeCN(bag.consignmentNumbers || []);
    const singleScan = req.body && req.body.scanBar ? [req.body.scanBar] : [];
    const scannedInput = Array.isArray(req.body?.scannedConsignmentNumbers)
      ? req.body.scannedConsignmentNumbers
      : [];
    const fromPersisted =
      req.body?.mergePersisted === true
        ? normalizeCN(bag.receivedConsignmentNumbers || [])
        : [];
    const scanned = normalizeCN([...fromPersisted, ...scannedInput, ...singleScan]);
    const verified = verifyConsignmentsAgainstExpected(expected, scanned);

    return res.status(200).json({
      success: true,
      data: {
        bagId: bag._id,
        bagNo: bag.bagNo,
        receivedConsignmentNumbers: normalizeCN(bag.receivedConsignmentNumbers || []),
        totals: verified.totals,
        matchedConsignments: verified.matchedConsignments,
        missingConsignments: verified.missingConsignments,
        unexpectedConsignments: verified.unexpectedConsignments,
        isComplete: verified.isComplete
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

/**
 * Persist which CNs were scanned during Receive Bag verification.
 * Only consignment numbers on the bag are stored; extras are ignored.
 */
exports.updateBagReceivedConsignments = async (req, res) => {
  try {
    if (!isAuthorized(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { id } = req.params;
    const { scannedConsignmentNumbers } = req.body || {};
    if (!Array.isArray(scannedConsignmentNumbers)) {
      return res.status(400).json({
        success: false,
        message: "scannedConsignmentNumbers must be an array"
      });
    }

    const bag = await CargoBag.findById(id);
    if (!bag) {
      return res.status(404).json({ success: false, message: "Bag not found" });
    }

    const expected = normalizeCN(bag.consignmentNumbers || []);
    const expectedSet = new Set(expected);
    const normalized = normalizeCN(scannedConsignmentNumbers);
    const allowed = normalized.filter((cn) => expectedSet.has(cn));

    bag.receivedConsignmentNumbers = allowed;
    await bag.save();

    const verified = verifyConsignmentsAgainstExpected(expected, allowed);

    return res.status(200).json({
      success: true,
      message: "Received consignments updated",
      data: {
        bagId: bag._id,
        bagNo: bag.bagNo,
        receivedConsignmentNumbers: allowed,
        totals: verified.totals,
        matchedConsignments: verified.matchedConsignments,
        missingConsignments: verified.missingConsignments,
        unexpectedConsignments: verified.unexpectedConsignments,
        isComplete: verified.isComplete
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

exports.createManifest = async (req, res) => {
  try {
    if (!isAuthorized(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { bagIds = [], originCity, destinationCity, remarks, scanBar } = req.body;

    if (!originCity || !destinationCity || !Array.isArray(bagIds) || bagIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "originCity, destinationCity and bagIds are required"
      });
    }

    const bags = await CargoBag.find({ _id: { $in: bagIds } });
    if (bags.length !== bagIds.length) {
      return res.status(400).json({
        success: false,
        message: "Some bags were not found"
      });
    }

    const bagNumbers = bags.map((b) => b.bagNo);
    const consignmentNumbers = normalizeCN(bags.flatMap((b) => b.consignmentNumbers));

    const manifest = await CargoManifest.create({
      bagIds,
      bagNumbers,
      consignmentNumbers,
      originCity,
      destinationCity,
      remarks,
      scanBar,
      status: "pending",
      createdByRole: req.user.role,
      createdById: String(req.user.id || req.user._id || "")
    });

    await appendCargoNoteToBookings(consignmentNumbers, {
      remarks: `Cargo: listed on manifest ${manifest.manifestNo} (${originCity} → ${destinationCity}); bags: ${bagNumbers.join(", ")}`,
      updatedBy: req.user.role
    });

    return res.status(201).json({
      success: true,
      message: "Manifest created successfully",
      data: manifest
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

exports.receiveManifest = async (req, res) => {
  try {
    if (!isAuthorized(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { id } = req.params;
    const { remarks } = req.body;
    const manifest = await CargoManifest.findById(id);
    if (!manifest) {
      return res.status(404).json({ success: false, message: "Manifest not found" });
    }

    if (manifest.status === "cancelled") {
      return res.status(400).json({ success: false, message: "Cancelled manifest cannot be received" });
    }
    if (manifest.status === "completed") {
      return res.status(400).json({ success: false, message: "Manifest is already received" });
    }

    manifest.status = "completed";
    manifest.completedAt = new Date();
    if (remarks) manifest.remarks = remarks;
    await manifest.save();

    if (Array.isArray(manifest.bagIds) && manifest.bagIds.length > 0) {
      await CargoBag.updateMany(
        { _id: { $in: manifest.bagIds }, status: { $nin: ["cancelled", "completed"] } },
        { $set: { status: "completed", completedAt: new Date() } }
      );
    }

    await BookingStatus.updateMany(
      { consignmentNumber: { $in: manifest.consignmentNumbers } },
      {
        $set: { status: "completed" },
        $push: {
          statusHistory: {
            status: "completed",
            timestamp: new Date(),
            remarks: `Received via Manifest ${manifest.manifestNo}`,
            updatedBy: req.user.role
          }
        }
      }
    );

    await ManualBooking.updateMany(
      { consignmentNo: { $in: manifest.consignmentNumbers } },
      {
        $set: { status: "completed" },
        $push: {
          statusHistory: {
            status: "completed",
            timestamp: new Date(),
            remarks: `Received via Manifest ${manifest.manifestNo}`,
            updatedBy: req.user.role
          }
        }
      }
    );

    await appendCargoNoteToBookings(manifest.consignmentNumbers, {
      remarks: `Cargo: manifest ${manifest.manifestNo} received at destination`,
      updatedBy: req.user.role
    });

    return res.status(200).json({
      success: true,
      message: "Manifest received successfully",
      data: manifest
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

exports.getPendingManifestReport = async (req, res) => {
  try {
    if (!isAuthorized(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { page = 1, limit = 20 } = req.query;
    const pageNo = parseInt(page, 10);
    const size = parseInt(limit, 10);
    const skip = (pageNo - 1) * size;

    const query = { status: "pending" };
    const [manifests, total] = await Promise.all([
      CargoManifest.find(query).sort({ createdAt: -1 }).skip(skip).limit(size),
      CargoManifest.countDocuments(query)
    ]);

    return res.status(200).json({
      success: true,
      data: manifests,
      pagination: {
        page: pageNo,
        limit: size,
        total,
        totalPages: Math.ceil(total / size)
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

exports.getManifestHistory = async (req, res) => {
  try {
    if (!isAuthorized(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { status, page = 1, limit = 20 } = req.query;
    const query = {};
    if (status) query.status = status;

    const pageNo = parseInt(page, 10);
    const size = parseInt(limit, 10);
    const skip = (pageNo - 1) * size;

    const [manifests, total] = await Promise.all([
      CargoManifest.find(query).sort({ createdAt: -1 }).skip(skip).limit(size),
      CargoManifest.countDocuments(query)
    ]);

    return res.status(200).json({
      success: true,
      data: manifests,
      pagination: {
        page: pageNo,
        limit: size,
        total,
        totalPages: Math.ceil(total / size)
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

exports.getManifestDetail = async (req, res) => {
  try {
    if (!isAuthorized(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { id } = req.params;
    const manifest = await CargoManifest.findById(id).lean();
    if (!manifest) {
      return res.status(404).json({ success: false, message: "Manifest not found" });
    }

    const bags = await CargoBag.find({ _id: { $in: manifest.bagIds || [] } })
      .sort({ createdAt: -1 })
      .lean();
    const bagMap = new Map(bags.map((b) => [String(b._id), b]));
    const bagDetails = (manifest.bagIds || [])
      .map((bid) => {
        const b = bagMap.get(String(bid));
        if (!b) return null;
        return {
          _id: b._id,
          bagNo: b.bagNo,
          seal: b.seal || null,
          originCity: b.originCity,
          destinationCity: b.destinationCity,
          status: b.status,
          count: b.count,
          consignmentNumbers: b.consignmentNumbers || [],
          remarks: b.remarks || "",
          createdAt: b.createdAt
        };
      })
      .filter(Boolean);

    const expectedBagNumbers = await getExpectedBagNumbersForManifest(manifest);
    const receivedBagNumbers = normalizeBagTokens(manifest.receivedBagNumbers || []);
    const bagVerification = verifyBagsAgainstExpected(expectedBagNumbers, receivedBagNumbers);

    return res.status(200).json({
      success: true,
      data: {
        manifest,
        summary: {
          bagCount: bagDetails.length,
          totalConsignments: (manifest.consignmentNumbers || []).length,
          expectedBagNumbers,
          receivedBagNumbers
        },
        bagVerification: {
          manifestId: manifest._id,
          manifestNo: manifest.manifestNo,
          ...bagVerification
        },
        bags: bagDetails
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

exports.checkManifestConsignments = async (req, res) => {
  try {
    if (!isAuthorized(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { id } = req.params;
    const manifest = await CargoManifest.findById(id).lean();
    if (!manifest) {
      return res.status(404).json({ success: false, message: "Manifest not found" });
    }

    const expected = normalizeCN(manifest.consignmentNumbers || []);

    const singleScan = req.body && req.body.scanBar ? [req.body.scanBar] : [];
    const scannedInput = Array.isArray(req.body?.scannedConsignmentNumbers)
      ? req.body.scannedConsignmentNumbers
      : [];
    const scanned = normalizeCN([...scannedInput, ...singleScan]);
    const verified = verifyConsignmentsAgainstExpected(expected, scanned);

    return res.status(200).json({
      success: true,
      data: {
        manifestId: manifest._id,
        manifestNo: manifest.manifestNo,
        scanBar: manifest.scanBar || manifest.manifestNo,
        totals: verified.totals,
        matchedConsignments: verified.matchedConsignments,
        missingConsignments: verified.missingConsignments,
        unexpectedConsignments: verified.unexpectedConsignments,
        isComplete: verified.isComplete
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

exports.checkManifestBags = async (req, res) => {
  try {
    if (!isAuthorized(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { id } = req.params;
    const manifest = await CargoManifest.findById(id).lean();
    if (!manifest) {
      return res.status(404).json({ success: false, message: "Manifest not found" });
    }

    const expected = await getExpectedBagNumbersForManifest(manifest);

    const singleScan = req.body && req.body.scanBar ? [req.body.scanBar] : [];
    const scannedInput = Array.isArray(req.body?.scannedBagNumbers) ? req.body.scannedBagNumbers : [];
    const fromPersisted =
      req.body?.mergePersisted === true
        ? normalizeBagTokens(manifest.receivedBagNumbers || [])
        : [];
    const scanned = normalizeBagTokens([...fromPersisted, ...scannedInput, ...singleScan]);
    const verified = verifyBagsAgainstExpected(expected, scanned);

    return res.status(200).json({
      success: true,
      data: {
        manifestId: manifest._id,
        manifestNo: manifest.manifestNo,
        scanBar: manifest.scanBar || manifest.manifestNo,
        receivedBagNumbers: normalizeBagTokens(manifest.receivedBagNumbers || []),
        totals: verified.totals,
        matchedBags: verified.matchedBags,
        missingBags: verified.missingBags,
        unexpectedBags: verified.unexpectedBags,
        isComplete: verified.isComplete
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

/**
 * Persist which bags were scanned during Receive Manifest verification.
 * Only bag numbers that belong to this manifest are stored (extras are ignored).
 */
exports.updateManifestReceivedBags = async (req, res) => {
  try {
    if (!isAuthorized(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { id } = req.params;
    const { scannedBagNumbers } = req.body || {};
    if (!Array.isArray(scannedBagNumbers)) {
      return res.status(400).json({
        success: false,
        message: "scannedBagNumbers must be an array of bag numbers"
      });
    }

    const manifest = await CargoManifest.findById(id);
    if (!manifest) {
      return res.status(404).json({ success: false, message: "Manifest not found" });
    }

    const expected = await getExpectedBagNumbersForManifest(manifest.toObject());
    const expectedSet = new Set(expected);
    const normalized = normalizeBagTokens(scannedBagNumbers);
    const allowed = normalized.filter((bn) => expectedSet.has(bn));

    manifest.receivedBagNumbers = allowed;
    await manifest.save();

    const verified = verifyBagsAgainstExpected(expected, allowed);

    return res.status(200).json({
      success: true,
      message: "Received bags updated",
      data: {
        manifestId: manifest._id,
        manifestNo: manifest.manifestNo,
        receivedBagNumbers: allowed,
        totals: verified.totals,
        matchedBags: verified.matchedBags,
        missingBags: verified.missingBags,
        unexpectedBags: verified.unexpectedBags,
        isComplete: verified.isComplete
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};
