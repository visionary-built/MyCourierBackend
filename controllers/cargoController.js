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

const isAuthorized = (req) => req.user && ALLOWED_ROLES.includes(req.user.role);

exports.createBag = async (req, res) => {
  try {
    if (!isAuthorized(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { originCity, destinationCity, consignmentNumbers = [], remarks } = req.body;
    const normalizedCNs = normalizeCN(consignmentNumbers);

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

exports.createManifest = async (req, res) => {
  try {
    if (!isAuthorized(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { bagIds = [], originCity, destinationCity, remarks } = req.body;

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
