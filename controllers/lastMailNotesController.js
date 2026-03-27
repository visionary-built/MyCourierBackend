const LastMailDeliveryNote = require("../models/LastMailDeliveryNote");
const LastMailReturnNote = require("../models/LastMailReturnNote");
const BookingStatus = require("../models/bookingStatus");
const ManualBooking = require("../models/ManualBooking");

const ALLOWED_ROLES = ["superAdmin", "admin", "operation", "operationPortal"];

const assertRole = (req) => req.user && ALLOWED_ROLES.includes(req.user.role);

const normalizeCn = (cn) => String(cn || "").trim().toUpperCase();

/**
 * Resolve consignment snapshot from BookingStatus or ManualBooking.
 */
async function resolveConsignment(cn) {
  const upper = normalizeCn(cn);
  const bs = await BookingStatus.findOne({ consignmentNumber: upper }).lean();
  if (bs) {
    return {
      source: "booking_status",
      consigneeName: bs.consigneeName,
      destinationCity: bs.destinationCity,
      codAmount: bs.codAmount != null ? bs.codAmount : 0,
      weight: bs.weight,
      bookingStatus: bs.status
    };
  }
  const mb = await ManualBooking.findOne({ consignmentNo: upper }).lean();
  if (mb) {
    return {
      source: "manual_booking",
      consigneeName: mb.consigneeName,
      destinationCity: mb.destinationCity,
      codAmount: mb.codAmount != null ? mb.codAmount : 0,
      weight: mb.weight,
      bookingStatus: mb.status
    };
  }
  return null;
}

// ─── A) Delivery note (create + scan) ───────────────────────────────────────

exports.createDeliveryNote = async (req, res) => {
  try {
    if (!assertRole(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const { remarks } = req.body;
    const note = await LastMailDeliveryNote.create({
      remarks,
      status: "open",
      createdByRole: req.user.role,
      createdById: String(req.user.id || req.user._id || "")
    });
    return res.status(201).json({
      success: true,
      message: "Delivery note created — scan consignments to add shipments",
      data: note
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

exports.scanDeliveryNote = async (req, res) => {
  try {
    if (!assertRole(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const { id } = req.params;
    const { consignmentNumber } = req.body;
    if (!consignmentNumber) {
      return res.status(400).json({ success: false, message: "consignmentNumber is required" });
    }

    const note = await LastMailDeliveryNote.findById(id);
    if (!note || note.status !== "open") {
      return res.status(404).json({
        success: false,
        message: "Note not found or already closed"
      });
    }

    const cn = normalizeCn(consignmentNumber);
    const existsOnNote = note.entries.some((e) => e.consignmentNumber === cn);
    if (existsOnNote) {
      return res.status(400).json({
        success: false,
        message: "This consignment is already scanned on this note",
        data: { noteNo: note.noteNo, shipmentCount: note.shipmentCount }
      });
    }

    const resolved = await resolveConsignment(cn);
    if (!resolved) {
      return res.status(400).json({
        success: false,
        message: "Consignment not found in booking system"
      });
    }

    note.entries.push({
      consignmentNumber: cn,
      scannedAt: new Date(),
      scannedByRole: req.user.role,
      scannedById: String(req.user.id || req.user._id || ""),
      consigneeName: resolved.consigneeName,
      destinationCity: resolved.destinationCity,
      codAmount: resolved.codAmount,
      weight: resolved.weight,
      source: resolved.source
    });
    note.shipmentCount = note.entries.length;
    await note.save();

    return res.status(200).json({
      success: true,
      message: "Consignment scanned — shipment count updated",
      data: note
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

exports.getDeliveryNoteById = async (req, res) => {
  try {
    if (!assertRole(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const note = await LastMailDeliveryNote.findById(req.params.id);
    if (!note) {
      return res.status(404).json({ success: false, message: "Note not found" });
    }
    return res.status(200).json({ success: true, data: note });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

exports.listDeliveryNotes = async (req, res) => {
  try {
    if (!assertRole(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const { status, page = 1, limit = 20 } = req.query;
    const query = {};
    if (status) query.status = status;
    const pageNo = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNo - 1) * size;

    const [notes, total] = await Promise.all([
      LastMailDeliveryNote.find(query).sort({ createdAt: -1 }).skip(skip).limit(size).lean(),
      LastMailDeliveryNote.countDocuments(query)
    ]);

    return res.status(200).json({
      success: true,
      data: notes,
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

exports.closeDeliveryNote = async (req, res) => {
  try {
    if (!assertRole(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const { remarks } = req.body;
    const note = await LastMailDeliveryNote.findById(req.params.id);
    if (!note) {
      return res.status(404).json({ success: false, message: "Note not found" });
    }
    note.status = "closed";
    note.closedAt = new Date();
    if (remarks) note.remarks = note.remarks ? `${note.remarks} | ${remarks}` : remarks;
    await note.save();
    return res.status(200).json({
      success: true,
      message: "Delivery note closed",
      data: note
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// ─── C) Pending cash collection ─────────────────────────────────────────────

exports.getPendingCashCollection = async (req, res) => {
  try {
    if (!assertRole(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { page = 1, limit = 20, destinationCity } = req.query;
    const pageNo = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.min(200, Math.max(1, parseInt(limit, 10) || 20));

    const pendingCodClause = {
      $or: [{ cashCollectedAt: { $exists: false } }, { cashCollectedAt: null }]
    };

    const baseQuery = {
      codAmount: { $gt: 0 },
      status: { $nin: ["delivered", "cancelled"] },
      ...pendingCodClause
    };
    const destFilter = destinationCity
      ? { ...baseQuery, destinationCity: new RegExp(destinationCity.trim(), "i") }
      : baseQuery;

    const [bsRows, mbRows] = await Promise.all([
      BookingStatus.find(destFilter)
        .select(
          "consignmentNumber codAmount status consigneeName consigneeMobile destinationCity originCity bookingDate updatedAt cashCollectedAt"
        )
        .sort({ updatedAt: -1 })
        .lean(),
      ManualBooking.find({
        codAmount: { $gt: 0 },
        status: { $nin: ["delivered", "cancelled"] },
        ...pendingCodClause,
        ...(destinationCity
          ? { destinationCity: new RegExp(destinationCity.trim(), "i") }
          : {})
      })
        .select(
          "consignmentNo codAmount status consigneeName consigneeMobile destinationCity originCity date updatedAt createdAt cashCollectedAt"
        )
        .sort({ updatedAt: -1 })
        .lean()
    ]);

    const rows = [
      ...bsRows.map((b) => ({
        consignmentNumber: b.consignmentNumber,
        codAmount: b.codAmount,
        status: b.status,
        consigneeName: b.consigneeName,
        consigneeMobile: b.consigneeMobile,
        destinationCity: b.destinationCity,
        originCity: b.originCity,
        bookingDate: b.bookingDate,
        updatedAt: b.updatedAt,
        source: "booking_status"
      })),
      ...mbRows.map((m) => ({
        consignmentNumber: m.consignmentNo,
        codAmount: m.codAmount,
        status: m.status,
        consigneeName: m.consigneeName,
        consigneeMobile: m.consigneeMobile,
        destinationCity: m.destinationCity,
        originCity: m.originCity,
        bookingDate: m.date || m.createdAt,
        updatedAt: m.updatedAt,
        source: "manual_booking"
      }))
    ];

    rows.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    const total = rows.length;
    const skip = (pageNo - 1) * size;
    const paginated = rows.slice(skip, skip + size);

    const totalCodPending = rows.reduce((sum, r) => sum + (Number(r.codAmount) || 0), 0);

    return res.status(200).json({
      success: true,
      message: "Pending cash (COD) collection — consignments with COD not yet delivered/cancelled",
      data: {
        rows: paginated,
        summary: {
          totalShipments: total,
          totalCodAmountPending: totalCodPending
        }
      },
      pagination: {
        page: pageNo,
        limit: size,
        total,
        totalPages: Math.ceil(total / size) || 1
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

/**
 * Record COD collected at office — sets cashCollectedAt and removes row from pending list.
 * Body: { consignmentNumber, source: "booking_status" | "manual_booking", remarks? }
 */
exports.recordCashCollection = async (req, res) => {
  try {
    if (!assertRole(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { consignmentNumber, source, remarks } = req.body;
    if (!consignmentNumber || !source) {
      return res.status(400).json({
        success: false,
        message: "consignmentNumber and source are required (booking_status | manual_booking)"
      });
    }

    const cn = normalizeCn(consignmentNumber);
    const now = new Date();
    const historyEntry = {
      status: "COD Collected",
      timestamp: now,
      remarks: remarks || "Cash recorded at office (Last Mail)",
      updatedBy: req.user.role
    };

    if (source === "booking_status") {
      const doc = await BookingStatus.findOne({ consignmentNumber: cn });
      if (!doc) {
        return res.status(404).json({ success: false, message: "Consignment not found in booking status" });
      }
      if (!doc.codAmount || doc.codAmount <= 0) {
        return res.status(400).json({ success: false, message: "No COD amount on this consignment" });
      }
      if (doc.cashCollectedAt) {
        return res.status(400).json({ success: false, message: "COD already recorded as collected" });
      }
      doc.cashCollectedAt = now;
      if (!Array.isArray(doc.statusHistory)) doc.statusHistory = [];
      doc.statusHistory.push(historyEntry);
      await doc.save();
      return res.status(200).json({
        success: true,
        message: "Cash collection recorded",
        data: doc
      });
    }

    if (source === "manual_booking") {
      const doc = await ManualBooking.findOne({ consignmentNo: cn });
      if (!doc) {
        return res.status(404).json({ success: false, message: "Consignment not found in manual bookings" });
      }
      if (!doc.codAmount || doc.codAmount <= 0) {
        return res.status(400).json({ success: false, message: "No COD amount on this consignment" });
      }
      if (doc.cashCollectedAt) {
        return res.status(400).json({ success: false, message: "COD already recorded as collected" });
      }
      doc.cashCollectedAt = now;
      if (!Array.isArray(doc.statusHistory)) doc.statusHistory = [];
      doc.statusHistory.push(historyEntry);
      await doc.save();
      return res.status(200).json({
        success: true,
        message: "Cash collection recorded",
        data: doc
      });
    }

    return res.status(400).json({
      success: false,
      message: 'source must be "booking_status" or "manual_booking"'
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// ─── E) Return note (create + scan) ──────────────────────────────────────────

exports.createReturnNote = async (req, res) => {
  try {
    if (!assertRole(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const { remarks } = req.body;
    const note = await LastMailReturnNote.create({
      remarks,
      status: "open",
      createdByRole: req.user.role,
      createdById: String(req.user.id || req.user._id || "")
    });
    return res.status(201).json({
      success: true,
      message: "Return note created — scan consignments to add returns",
      data: note
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

exports.scanReturnNote = async (req, res) => {
  try {
    if (!assertRole(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const { id } = req.params;
    const { consignmentNumber } = req.body;
    if (!consignmentNumber) {
      return res.status(400).json({ success: false, message: "consignmentNumber is required" });
    }

    const note = await LastMailReturnNote.findById(id);
    if (!note || note.status !== "open") {
      return res.status(404).json({
        success: false,
        message: "Return note not found or already closed"
      });
    }

    const cn = normalizeCn(consignmentNumber);
    if (note.entries.some((e) => e.consignmentNumber === cn)) {
      return res.status(400).json({
        success: false,
        message: "This consignment is already scanned on this return note",
        data: { returnNoteNo: note.returnNoteNo, shipmentCount: note.shipmentCount }
      });
    }

    const resolved = await resolveConsignment(cn);
    if (!resolved) {
      return res.status(400).json({
        success: false,
        message: "Consignment not found in booking system"
      });
    }

    note.entries.push({
      consignmentNumber: cn,
      scannedAt: new Date(),
      scannedByRole: req.user.role,
      scannedById: String(req.user.id || req.user._id || ""),
      consigneeName: resolved.consigneeName,
      destinationCity: resolved.destinationCity,
      bookingStatus: resolved.bookingStatus,
      source: resolved.source
    });
    note.shipmentCount = note.entries.length;
    await note.save();

    return res.status(200).json({
      success: true,
      message: "Return scan recorded — shipment count updated",
      data: note
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

exports.getReturnNoteById = async (req, res) => {
  try {
    if (!assertRole(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const note = await LastMailReturnNote.findById(req.params.id);
    if (!note) {
      return res.status(404).json({ success: false, message: "Return note not found" });
    }
    return res.status(200).json({ success: true, data: note });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

exports.listReturnNotes = async (req, res) => {
  try {
    if (!assertRole(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const { status, page = 1, limit = 20 } = req.query;
    const query = {};
    if (status) query.status = status;
    const pageNo = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNo - 1) * size;

    const [notes, total] = await Promise.all([
      LastMailReturnNote.find(query).sort({ createdAt: -1 }).skip(skip).limit(size).lean(),
      LastMailReturnNote.countDocuments(query)
    ]);

    return res.status(200).json({
      success: true,
      data: notes,
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

exports.closeReturnNote = async (req, res) => {
  try {
    if (!assertRole(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const { remarks } = req.body;
    const note = await LastMailReturnNote.findById(req.params.id);
    if (!note) {
      return res.status(404).json({ success: false, message: "Return note not found" });
    }
    note.status = "closed";
    note.closedAt = new Date();
    if (remarks) note.remarks = note.remarks ? `${note.remarks} | ${remarks}` : remarks;
    await note.save();
    return res.status(200).json({
      success: true,
      message: "Return note closed",
      data: note
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};
