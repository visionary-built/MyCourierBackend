const BookingStatus = require("../models/bookingStatus");
const ManualBooking = require("../models/ManualBooking");
const Parcel = require("../models/arrivalScan");

const ORIGIN_STAGE = "Arrived At Facility";
const DEST_STAGE = "Unload At Destination";

const normalizeCn = (cn) => String(cn || "").trim().toUpperCase();

/**
 * Derive origin/destination arrival timestamps from statusHistory (any source).
 */
function getArrivalSummaryFromHistory(statusHistory = []) {
  let originArrivalAt = null;
  let destinationArrivalAt = null;
  if (!Array.isArray(statusHistory)) {
    return { originArrivalAt, destinationArrivalAt, originStage: ORIGIN_STAGE, destinationStage: DEST_STAGE };
  }
  for (const h of statusHistory) {
    const label = String(h.status || "").toLowerCase();
    const ts = h.timestamp ? new Date(h.timestamp) : h.createdAt ? new Date(h.createdAt) : null;
    if (!ts || Number.isNaN(ts.getTime())) continue;
    if (label.includes("arrived at facility")) {
      if (!originArrivalAt || ts > originArrivalAt) originArrivalAt = ts;
    }
    if (label.includes("unload at destination")) {
      if (!destinationArrivalAt || ts > destinationArrivalAt) destinationArrivalAt = ts;
    }
  }
  return {
    originArrivalAt,
    destinationArrivalAt,
    originStage: ORIGIN_STAGE,
    destinationStage: DEST_STAGE
  };
}

/**
 * Record origin facility arrival — updates BookingStatus, ManualBooking (if present), and arrival-scan Parcel (if present).
 */
async function recordOriginArrival(consignmentNumber, opts = {}) {
  return applyArrivalStage(normalizeCn(consignmentNumber), ORIGIN_STAGE, opts);
}

/**
 * Record destination (hub) arrival — same linkage as origin.
 */
async function recordDestinationArrival(consignmentNumber, opts = {}) {
  return applyArrivalStage(normalizeCn(consignmentNumber), DEST_STAGE, opts);
}

function stageToBookingStatus(stage) {
  if (stage === ORIGIN_STAGE) return "at-origin-facility";
  if (stage === DEST_STAGE) return "at-destination-facility";
  return "in-transit";
}

async function applyArrivalStage(cn, stage, { remarks, updatedBy, skipParcel = false } = {}) {
  const dbStatus = stageToBookingStatus(stage);
  const historyEntry = {
    status: stage,
    timestamp: new Date(),
    remarks: remarks || undefined,
    updatedBy: updatedBy || "system"
  };

  const bs = await BookingStatus.findOne({ consignmentNumber: cn });
  const mb = await ManualBooking.findOne({ consignmentNo: cn });

  if (!bs && !mb) {
    return { ok: false, code: "NOT_FOUND", message: "Consignment not found in booking system" };
  }

  const bookingTerminal = (s) =>
    ["delivered", "cancelled", "returned"].includes(String(s || "").toLowerCase());

  if (bs) {
    if (!bookingTerminal(bs.status)) {
      bs.status = dbStatus;
      if (!Array.isArray(bs.statusHistory)) bs.statusHistory = [];
      bs.statusHistory.push(historyEntry);
      if (remarks) bs.remarks = remarks;
      await bs.save();
    }
  }

  if (mb) {
    if (!bookingTerminal(mb.status)) {
      mb.status = dbStatus;
      if (!Array.isArray(mb.statusHistory)) mb.statusHistory = [];
      mb.statusHistory.push(historyEntry);
      if (remarks) mb.remarks = remarks;
      await mb.save();
    }
  }

  let parcel = null;
  if (!skipParcel) {
    parcel = await Parcel.findOne({ consignmentNumber: cn });
    if (parcel) {
      const note = `${stage}${remarks ? ` — ${remarks}` : ""}`;
      parcel.status = dbStatus;
      parcel.arrivalDate = new Date();
      parcel.remarks = parcel.remarks ? `${parcel.remarks} | ${note}` : note;
      await parcel.save();
    }
  }

  const primary = bs || mb;
  const statusHistory = primary && primary.statusHistory ? primary.statusHistory : [];

  return {
    ok: true,
    stage,
    consignmentNumber: cn,
    booking: bs,
    manualBooking: mb,
    parcel,
    arrival: getArrivalSummaryFromHistory(statusHistory)
  };
}

/**
 * Load arrival summary for a CN from BookingStatus or ManualBooking (for parcel / scan APIs).
 */
async function getArrivalMetaForConsignment(consignmentNumber) {
  const cn = normalizeCn(consignmentNumber);
  const bs = await BookingStatus.findOne({ consignmentNumber: cn }).select("statusHistory").lean();
  if (bs && Array.isArray(bs.statusHistory) && bs.statusHistory.length) {
    return getArrivalSummaryFromHistory(bs.statusHistory);
  }
  const mb = await ManualBooking.findOne({ consignmentNo: cn }).select("statusHistory").lean();
  if (mb && Array.isArray(mb.statusHistory) && mb.statusHistory.length) {
    return getArrivalSummaryFromHistory(mb.statusHistory);
  }
  return getArrivalSummaryFromHistory([]);
}

module.exports = {
  ORIGIN_STAGE,
  DEST_STAGE,
  normalizeCn,
  getArrivalSummaryFromHistory,
  getArrivalMetaForConsignment,
  recordOriginArrival,
  recordDestinationArrival
};
