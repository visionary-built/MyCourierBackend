const CargoBag = require("../models/CargoBag");
const CargoManifest = require("../models/CargoManifest");
const BookingStatus = require("../models/bookingStatus");
const ManualBooking = require("../models/ManualBooking");

/**
 * Lightweight cargo context for API responses (tracking, booking detail, parcels).
 */
async function getCargoContext(consignmentNumber) {
  const cn = String(consignmentNumber || "")
    .trim()
    .toUpperCase();
  if (!cn) {
    return { bag: null, manifest: null };
  }

  const [bag, manifest] = await Promise.all([
    CargoBag.findOne({ consignmentNumbers: cn })
      .select("bagNo status originCity destinationCity createdAt inTransitAt remarks")
      .lean(),
    CargoManifest.findOne({ consignmentNumbers: cn })
      .select("manifestNo status originCity destinationCity createdAt remarks")
      .lean()
  ]);

  return {
    bag: bag
      ? {
          bagNo: bag.bagNo,
          status: bag.status,
          originCity: bag.originCity,
          destinationCity: bag.destinationCity,
          createdAt: bag.createdAt,
          inTransitAt: bag.inTransitAt,
          remarks: bag.remarks
        }
      : null,
    manifest: manifest
      ? {
          manifestNo: manifest.manifestNo,
          status: manifest.status,
          originCity: manifest.originCity,
          destinationCity: manifest.destinationCity,
          createdAt: manifest.createdAt,
          remarks: manifest.remarks
        }
      : null
  };
}

/**
 * Append a non-destructive statusHistory line on both BookingStatus and ManualBooking when present.
 */
async function appendCargoNoteToBookings(consignmentNumbers, { remarks, updatedBy }) {
  const cns = [...new Set(consignmentNumbers.map((c) => String(c).trim().toUpperCase()).filter(Boolean))];
  if (cns.length === 0 || !remarks) return;

  const ts = new Date();
  const entry = {
    status: "Cargo",
    timestamp: ts,
    remarks,
    updatedBy: updatedBy || "system"
  };

  await Promise.all([
    BookingStatus.updateMany(
      { consignmentNumber: { $in: cns } },
      { $push: { statusHistory: entry } }
    ),
    ManualBooking.updateMany(
      { consignmentNo: { $in: cns } },
      { $push: { statusHistory: entry } }
    )
  ]);
}

/**
 * Remove a consignment from all bags/manifests (void, return-to-office, etc.).
 * Empty bags/manifests are marked cancelled.
 */
async function detachConsignmentFromCargo(consignmentNumber, { reason = "removed", source = "system" } = {}) {
  const cn = String(consignmentNumber || "")
    .trim()
    .toUpperCase();
  if (!cn) return { detached: false };

  const note = `Cargo: ${reason} (${source}) — CN ${cn}`;

  const bags = await CargoBag.find({ consignmentNumbers: cn });
  for (const bag of bags) {
    bag.consignmentNumbers = (bag.consignmentNumbers || []).filter((c) => c !== cn);
    if (bag.consignmentNumbers.length === 0) {
      bag.status = "cancelled";
    }
    bag.remarks = bag.remarks ? `${bag.remarks}; ${note}` : note;
    await bag.save();
  }

  const manifests = await CargoManifest.find({ consignmentNumbers: cn });
  for (const m of manifests) {
    m.consignmentNumbers = (m.consignmentNumbers || []).filter((c) => c !== cn);
    const remaining = new Set(m.consignmentNumbers);

    const newBagIds = [];
    const newBagNumbers = [];
    for (const bid of m.bagIds || []) {
      const b = await CargoBag.findById(bid);
      if (!b) continue;
      const overlap = b.consignmentNumbers.some((c) => remaining.has(c));
      if (overlap) {
        newBagIds.push(b._id);
        newBagNumbers.push(b.bagNo);
      }
    }
    m.bagIds = newBagIds;
    m.bagNumbers = [...new Set(newBagNumbers)];

    if (m.consignmentNumbers.length === 0) {
      m.status = "cancelled";
    }
    m.remarks = m.remarks ? `${m.remarks}; ${note}` : note;
    await m.save();
  }

  await appendCargoNoteToBookings([cn], {
    remarks: note,
    updatedBy: source
  });

  return { detached: true, bagsUpdated: bags.length, manifestsUpdated: manifests.length };
}

module.exports = {
  getCargoContext,
  appendCargoNoteToBookings,
  detachConsignmentFromCargo
};
