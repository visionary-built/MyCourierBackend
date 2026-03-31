const path = require("path");
const fs = require("fs");
const multer = require("multer");
const LastMailDeliveryNote = require("../models/LastMailDeliveryNote");
const LastMailReturnNote = require("../models/LastMailReturnNote");
const BookingStatus = require("../models/bookingStatus");
const ManualBooking = require("../models/ManualBooking");
const Rider = require("../models/Rider");
const DeliverySheetPhaseI = require("../models/DeliverySheetPhaseI");
const { assignConsignmentToRider } = require("../services/deliveryAssignmentService");

const codSlipDir = path.join(__dirname, "..", "uploads", "cod-slips");
if (!fs.existsSync(codSlipDir)) {
  fs.mkdirSync(codSlipDir, { recursive: true });
}
const codSlipStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, codSlipDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `cod-${Date.now()}-${Math.floor(Math.random() * 10000)}${ext}`);
  }
});
const codSlipUpload = multer({
  storage: codSlipStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(jpe?g|png|webp|gif|pdf)$/i.test(file.originalname);
    if (ok) cb(null, true);
    else cb(new Error("Only image or PDF files allowed for bank slip"));
  }
});
/** Multer middleware — field name `bankSlip` (required to complete COD collection). */
exports.uploadCodBankSlip = codSlipUpload.single("bankSlip");

const ALLOWED_ROLES = ["superAdmin", "admin", "operation", "operationPortal"];
const RECEIVE_NOTE_STATUSES = [
  "close",
  "incomplete",
  "refused",
  "untracable addrress",
  "delivered",
  "call not responsding",
  "costumer want delivery tomorrow",
  "out of city",
  "forcefully open return",
  "allow to open as per shipper"
];
const RECEIVE_TO_BOOKING_STATUS = {
  delivered: "delivered",
  refused: "returned",
  "forcefully open return": "returned",
  close: "pending",
  incomplete: "in-transit",
  "untracable addrress": "in-transit",
  "call not responsding": "in-transit",
  "costumer want delivery tomorrow": "in-transit",
  "out of city": "in-transit",
  "allow to open as per shipper": "in-transit"
};
const RECEIVE_TO_TRACKING_STAGE = {
  delivered: "Delivered",
  refused: "Return To Shipper",
  "forcefully open return": "Return To Office",
  close: "Booking",
  incomplete: "1st Attempt Delivery",
  "untracable addrress": "Not At Home",
  "call not responsding": "Not Responding",
  "costumer want delivery tomorrow": "2nd Attempt Out For Delivery",
  "out of city": "Return To Office",
  "allow to open as per shipper": "In Transit"
};

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

async function getBookingRowForCn(cn) {
  const upper = normalizeCn(cn);
  const bs = await BookingStatus.findOne({ consignmentNumber: upper }).lean();
  if (bs) {
    return { source: "booking_status", row: bs, consignmentNumber: upper };
  }
  const mb = await ManualBooking.findOne({ consignmentNo: upper }).lean();
  if (mb) {
    return {
      source: "manual_booking",
      row: mb,
      consignmentNumber: upper
    };
  }
  return { source: null, row: null, consignmentNumber: upper };
}

function computeNoteStatsFromEntries(entries, bookingByCn) {
  let deliveredCount = 0;
  let deliveredCodAmount = 0;
  let totalCodSnapshot = 0;
  for (const e of entries) {
    totalCodSnapshot += Number(e.codAmount) || 0;
    const b = bookingByCn.get(normalizeCn(e.consignmentNumber));
    const st = b?.status;
    if (st === "delivered") {
      deliveredCount += 1;
      deliveredCodAmount += Number(b.codAmount != null ? b.codAmount : e.codAmount) || 0;
    }
  }
  const totalParcels = entries.length;
  return {
    totalParcels,
    deliveredCount,
    notDeliveredCount: Math.max(0, totalParcels - deliveredCount),
    totalCodSnapshot,
    deliveredCodAmount
  };
}

async function loadBookingMapForCns(cns) {
  const uniq = [...new Set((cns || []).map((c) => normalizeCn(c)))].filter(Boolean);
  const map = new Map();
  if (uniq.length === 0) return map;
  const [bsList, mbList] = await Promise.all([
    BookingStatus.find({ consignmentNumber: { $in: uniq } })
      .select("consignmentNumber status codAmount")
      .lean(),
    ManualBooking.find({ consignmentNo: { $in: uniq } }).select("consignmentNo status codAmount").lean()
  ]);
  bsList.forEach((b) => map.set(b.consignmentNumber, b));
  mbList.forEach((m) => map.set(m.consignmentNo, m));
  return map;
}

/**
 * CNs for create-in-one-step: `consignmentNumbers` (array), or string split by comma/space/semicolon,
 * plus optional `scanBar` (same splitting). Order preserved; duplicates removed.
 */
function parseInitialConsignmentNumbers(body) {
  if (!body) return [];
  const list = [];
  const raw = body.consignmentNumbers;
  if (Array.isArray(raw)) {
    for (const x of raw) {
      const n = normalizeCn(x);
      if (n) list.push(n);
    }
  } else if (typeof raw === "string" && raw.trim()) {
    for (const part of raw.split(/[\s,;]+/)) {
      const n = normalizeCn(part);
      if (n) list.push(n);
    }
  }
  if (body.scanBar != null && String(body.scanBar).trim()) {
    for (const part of String(body.scanBar).split(/[\s,;]+/)) {
      const n = normalizeCn(part);
      if (n) list.push(n);
    }
  }
  return [...new Set(list)];
}

/**
 * One scan onto an open note document (same rules as POST .../scan). Mutates and saves `note` on success.
 */
async function scanConsignmentOntoNoteDocument(note, cn, req) {
  if (!note || note.status !== "open") {
    return { success: false, statusCode: 404, message: "Note not found or already closed" };
  }
  const normalized = normalizeCn(cn);
  if (!normalized) {
    return { success: false, statusCode: 400, message: "consignmentNumber is required" };
  }
  if (note.entries.some((e) => e.consignmentNumber === normalized)) {
    return {
      success: false,
      statusCode: 400,
      message: "This consignment is already scanned on this note",
      meta: { noteNo: note.noteNo, shipmentCount: note.shipmentCount }
    };
  }

  const resolved = await resolveConsignment(normalized);
  if (!resolved) {
    return { success: false, statusCode: 400, message: "Consignment not found in booking system" };
  }

  const riderIdRaw = note.riderId || req.body.riderId;
  if (!riderIdRaw) {
    return {
      success: false,
      statusCode: 400,
      message:
        "riderId is required: send riderId when creating the delivery note, or include riderId on this scan"
    };
  }

  const rider = await Rider.findById(riderIdRaw);
  if (!rider || !rider.active) {
    return { success: false, statusCode: 404, message: "Rider not found or inactive" };
  }

  if (!note.riderId) {
    note.riderId = rider._id;
  } else if (note.riderId.toString() !== rider._id.toString()) {
    return {
      success: false,
      statusCode: 400,
      message: "This note is locked to another rider; use the rider set when the note was created"
    };
  }

  const assignResult = await assignConsignmentToRider(String(rider._id), normalized, {
    allowSameRiderNoOp: true
  });
  if (!assignResult.success) {
    return { success: false, statusCode: assignResult.statusCode, message: assignResult.message };
  }

  note.entries.push({
    consignmentNumber: normalized,
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
  return { success: true, assignResult };
}

// ─── A) Delivery note (create + scan) ───────────────────────────────────────

exports.createDeliveryNote = async (req, res) => {
  try {
    if (!assertRole(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const { remarks, riderId } = req.body;
    const initialCns = parseInitialConsignmentNumbers(req.body);
    if (initialCns.length > 0 && !riderId) {
      return res.status(400).json({
        success: false,
        message: "riderId is required when adding consignment numbers on create"
      });
    }

    const payload = {
      remarks,
      status: "open",
      createdByRole: req.user.role,
      createdById: String(req.user.id || req.user._id || "")
    };
    if (riderId) {
      const rider = await Rider.findById(riderId);
      if (!rider || !rider.active) {
        return res.status(404).json({ success: false, message: "Rider not found or inactive" });
      }
      payload.riderId = rider._id;
    }
    const note = await LastMailDeliveryNote.create(payload);

    for (const cn of initialCns) {
      const result = await scanConsignmentOntoNoteDocument(note, cn, req);
      if (!result.success) {
        return res.status(result.statusCode).json({
          success: false,
          message: result.message,
          failedConsignment: cn,
          data: { note, ...(result.meta || {}) }
        });
      }
    }

    let message;
    if (initialCns.length > 0) {
      message = `Delivery note created with ${initialCns.length} consignment(s) — assigned to rider (in-transit + delivery sheet)`;
    } else if (payload.riderId) {
      message =
        "Delivery note created — scans will assign each consignment to this rider (in-transit + delivery sheet)";
    } else {
      message =
        "Delivery note created — provide riderId on create or on first scan to assign shipments to a rider";
    }

    return res.status(201).json({
      success: true,
      message,
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
    const result = await scanConsignmentOntoNoteDocument(note, consignmentNumber, req);
    if (!result.success) {
      const err = { success: false, message: result.message };
      if (result.meta) err.data = result.meta;
      return res.status(result.statusCode).json(err);
    }

    const { assignResult } = result;
    return res.status(200).json({
      success: true,
      message: assignResult.alreadyAssigned
        ? "Consignment scanned — already assigned to this rider; note updated"
        : "Consignment scanned — assigned to rider (in-transit) and note updated",
      data: {
        note,
        assignment: {
          deliverySheetId: assignResult.deliverySheet._id,
          alreadyAssigned: !!assignResult.alreadyAssigned
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

/**
 * Remove one scanned CN from an open delivery note and mirror delivery-sheet + booking cleanup
 * (Last Mail creates one active sheet per CN for the rider).
 */
exports.removeDeliveryNoteEntry = async (req, res) => {
  try {
    if (!assertRole(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { id } = req.params;
    const rawCn = req.params.consignmentNumber != null ? String(req.params.consignmentNumber) : "";
    const cn = normalizeCn(decodeURIComponent(rawCn));
    if (!cn) {
      return res.status(400).json({ success: false, message: "consignmentNumber is required" });
    }

    const note = await LastMailDeliveryNote.findById(id);
    if (!note) {
      return res.status(404).json({ success: false, message: "Note not found" });
    }
    if (note.status !== "open") {
      return res.status(400).json({ success: false, message: "Only open notes can remove consignments" });
    }

    const idx = note.entries.findIndex((e) => e.consignmentNumber === cn);
    if (idx === -1) {
      return res.status(404).json({ success: false, message: "Consignment not found on this note" });
    }

    note.entries.splice(idx, 1);
    note.shipmentCount = note.entries.length;
    await note.save();

    if (note.riderId) {
      const sheet = await DeliverySheetPhaseI.findOne({
        riderId: note.riderId,
        status: "active",
        consignmentNumbers: cn
      });
      if (sheet) {
        const remaining = (sheet.consignmentNumbers || []).filter((x) => normalizeCn(x) !== cn);
        if (remaining.length === 0) {
          await DeliverySheetPhaseI.deleteOne({ _id: sheet._id });
        } else {
          sheet.consignmentNumbers = remaining;
          await sheet.save();
        }
      }

      try {
        await BookingStatus.findOneAndUpdate(
          { consignmentNumber: cn },
          {
            status: "pending",
            remarks: "Removed from delivery note — back to pending"
          }
        );
      } catch (_e) {
        /* ignore */
      }
      try {
        await ManualBooking.findOneAndUpdate(
          { consignmentNo: cn },
          { status: "pending" }
        );
      } catch (_e) {
        /* ignore */
      }
    }

    return res.status(200).json({
      success: true,
      message: "Consignment removed from note",
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

exports.updateDeliveryNote = async (req, res) => {
  try {
    if (!assertRole(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { id } = req.params;
    const { remarks, riderId } = req.body;
    const note = await LastMailDeliveryNote.findById(id);
    if (!note) {
      return res.status(404).json({ success: false, message: "Note not found" });
    }
    if (note.status === "closed") {
      return res.status(400).json({ success: false, message: "Closed note cannot be updated" });
    }

    if (remarks !== undefined) {
      note.remarks = String(remarks || "").trim();
    }

    if (riderId !== undefined) {
      if (!riderId) {
        note.riderId = undefined;
      } else {
        const rider = await Rider.findById(riderId);
        if (!rider || !rider.active) {
          return res.status(404).json({ success: false, message: "Rider not found or inactive" });
        }

        if (note.entries.length > 0 && note.riderId && note.riderId.toString() !== rider._id.toString()) {
          return res.status(400).json({
            success: false,
            message: "Rider cannot be changed after scans exist on this note"
          });
        }
        note.riderId = rider._id;
      }
    }

    await note.save();
    return res.status(200).json({
      success: true,
      message: "Delivery note updated",
      data: note
    });
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

/**
 * Submit delivery note after scanning (open → submitted). No more scans; use Close later to archive.
 */
exports.submitDeliveryNote = async (req, res) => {
  try {
    if (!assertRole(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const { remarks } = req.body;
    const note = await LastMailDeliveryNote.findById(req.params.id);
    if (!note) {
      return res.status(404).json({ success: false, message: "Note not found" });
    }
    if (note.status !== "open") {
      return res.status(400).json({
        success: false,
        message: "Only open notes can be submitted"
      });
    }
    note.status = "submitted";
    note.submittedAt = new Date();
    if (remarks) note.remarks = note.remarks ? `${note.remarks} | ${remarks}` : remarks;
    await note.save();
    return res.status(200).json({
      success: true,
      message: "Delivery note submitted",
      data: note
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

/**
 * Final archive: submitted → closed. (Optional legacy: open → closed in one step.)
 */
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
    if (note.status === "closed") {
      return res.status(400).json({ success: false, message: "Note is already closed" });
    }
    if (note.status === "open") {
      return res.status(400).json({
        success: false,
        message: "Submit the delivery note first (use Submit), then you can close it from the list"
      });
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

exports.deleteDeliveryNote = async (req, res) => {
  try {
    if (!assertRole(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const note = await LastMailDeliveryNote.findByIdAndDelete(req.params.id);
    if (!note) {
      return res.status(404).json({ success: false, message: "Note not found" });
    }
    return res.status(200).json({
      success: true,
      message: "Delivery note deleted",
      data: { id: note._id, noteNo: note.noteNo }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// ─── B2) Receive note — closed delivery notes with rider + booking stats ─────

exports.listReceiveNotes = async (req, res) => {
  try {
    if (!assertRole(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const { page = 1, limit = 20 } = req.query;
    const pageNo = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNo - 1) * size;

    const { status, receiveStatus } = req.query;
    const query = {};
    if (status) query.status = status;
    if (receiveStatus) query.receiveStatus = String(receiveStatus).trim().toLowerCase();
    const [notes, total] = await Promise.all([
      LastMailDeliveryNote.find(query)
        .populate("riderId", "riderName riderCode mobileNo active")
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(size)
        .lean(),
      LastMailDeliveryNote.countDocuments(query)
    ]);

    const data = await Promise.all(
      notes.map(async (note) => {
        const cns = (note.entries || []).map((e) => e.consignmentNumber);
        const bookingByCn = await loadBookingMapForCns(cns);
        const stats = computeNoteStatsFromEntries(note.entries || [], bookingByCn);
        return { ...note, stats };
      })
    );

    return res.status(200).json({
      success: true,
      message: "Delivery notes for receive view (optional ?status=open|closed)",
      data,
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

exports.getReceiveNoteDetail = async (req, res) => {
  try {
    if (!assertRole(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const note = await LastMailDeliveryNote.findById(req.params.id)
      .populate("riderId", "riderName riderCode mobileNo active address cnicNo")
      .lean();
    if (!note) {
      return res.status(404).json({ success: false, message: "Note not found" });
    }

    const entryDetails = await Promise.all(
      (note.entries || []).map(async (e) => {
        const { source, row } = await getBookingRowForCn(e.consignmentNumber);
        return {
          scan: e,
          consignmentNumber: normalizeCn(e.consignmentNumber),
          currentBooking: row,
          source
        };
      })
    );

    const bookingByCn = await loadBookingMapForCns((note.entries || []).map((x) => x.consignmentNumber));
    const stats = computeNoteStatsFromEntries(note.entries || [], bookingByCn);

    return res.status(200).json({
      success: true,
      data: {
        note,
        rider: note.riderId || null,
        stats,
        entries: entryDetails
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

exports.updateReceiveNote = async (req, res) => {
  try {
    if (!assertRole(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { id } = req.params;
    const { remarks, receiveStatus } = req.body;

    const note = await LastMailDeliveryNote.findById(id);
    if (!note) {
      return res.status(404).json({ success: false, message: "Note not found" });
    }

    if (remarks !== undefined) {
      note.remarks = String(remarks || "").trim();
    }
    if (receiveStatus !== undefined) {
      // Lock receive-status after closure: once marked "close", no further status edits.
      if (note.receiveStatus === "close") {
        const nextNormalized = String(receiveStatus || "")
          .trim()
          .toLowerCase();
        if (nextNormalized && nextNormalized !== "close") {
          return res.status(400).json({
            success: false,
            message: "Receive status is locked after close"
          });
        }
      }

      const normalized = String(receiveStatus || "")
        .trim()
        .toLowerCase();
      if (!normalized) {
        note.receiveStatus = undefined;
        note.receiveStatusAt = undefined;
      } else if (!RECEIVE_NOTE_STATUSES.includes(normalized)) {
        return res.status(400).json({
          success: false,
          message: "Invalid receiveStatus"
        });
      } else {
        note.receiveStatus = normalized;
        note.receiveStatusAt = new Date();

        const bookingStatus = RECEIVE_TO_BOOKING_STATUS[normalized];
        const cns = (note.entries || []).map((e) => normalizeCn(e.consignmentNumber)).filter(Boolean);
        if (bookingStatus && cns.length > 0) {
          const detailedStage = RECEIVE_TO_TRACKING_STAGE[normalized] || bookingStatus;
          const actionRemarks = `Receive note action: ${normalized}`;
          const timelineEntry = {
            status: detailedStage,
            timestamp: new Date(),
            remarks: actionRemarks,
            updatedBy: req.user.role
          };

          await Promise.all([
            BookingStatus.updateMany(
              { consignmentNumber: { $in: cns } },
              {
                $set: { status: bookingStatus, remarks: actionRemarks },
                $push: { statusHistory: timelineEntry }
              }
            ),
            ManualBooking.updateMany(
              { consignmentNo: { $in: cns } },
              {
                $set: { status: bookingStatus, remarks: actionRemarks },
                $push: { statusHistory: timelineEntry }
              }
            )
          ]);
        }
      }
    }

    await note.save();

    return res.status(200).json({
      success: true,
      message: "Receive note updated",
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

    /** Delivered shipments with COD still held pending bank deposit (slip upload completes collection). */
    const baseQuery = {
      codAmount: { $gt: 0 },
      status: "delivered",
      ...pendingCodClause
    };
    const destFilter = destinationCity
      ? { ...baseQuery, destinationCity: new RegExp(destinationCity.trim(), "i") }
      : baseQuery;

    const [bsRows, mbRows] = await Promise.all([
      BookingStatus.find(destFilter)
        .select(
          "consignmentNumber codAmount status consigneeName consigneeMobile destinationCity originCity bookingDate updatedAt cashCollectedAt codBankSlipUrl"
        )
        .sort({ updatedAt: -1 })
        .lean(),
      ManualBooking.find({
        codAmount: { $gt: 0 },
        status: "delivered",
        ...pendingCodClause,
        ...(destinationCity
          ? { destinationCity: new RegExp(destinationCity.trim(), "i") }
          : {})
      })
        .select(
          "consignmentNo codAmount status consigneeName consigneeMobile destinationCity originCity date updatedAt createdAt cashCollectedAt codBankSlipUrl"
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
        codBankSlipUrl: b.codBankSlipUrl,
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
        codBankSlipUrl: m.codBankSlipUrl,
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
      message:
        "Pending cash (COD) — delivered shipments with COD not yet deposited to bank (upload bank slip via collect to complete)",
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
 * Complete COD collection after bank deposit — multipart/form-data:
 *   bankSlip (file, required), consignmentNumber, source: booking_status | manual_booking, remarks?
 * Sets cashCollectedAt, codBankSlipUrl, removes row from pending cash list.
 */
exports.recordCashCollection = async (req, res) => {
  try {
    if (!assertRole(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    if (!req.file || !req.file.filename) {
      return res.status(400).json({
        success: false,
        message:
          "bankSlip file is required — send multipart/form-data with field name bankSlip (image or PDF)"
      });
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
    const slipUrl = `/uploads/cod-slips/${req.file.filename}`;
    const historyEntry = {
      status: "COD Collected",
      timestamp: now,
      remarks:
        remarks ||
        `Bank deposit recorded — slip uploaded (${slipUrl}) (Last Mail)`,
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
      if (doc.status !== "delivered") {
        return res.status(400).json({
          success: false,
          message: "COD collection can only be completed for delivered consignments"
        });
      }
      if (doc.cashCollectedAt) {
        return res.status(400).json({ success: false, message: "COD already recorded as collected" });
      }
      doc.cashCollectedAt = now;
      doc.codBankSlipUrl = slipUrl;
      if (!Array.isArray(doc.statusHistory)) doc.statusHistory = [];
      doc.statusHistory.push(historyEntry);
      await doc.save();
      return res.status(200).json({
        success: true,
        message: "Cash collection completed — bank slip saved",
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
      if (doc.status !== "delivered") {
        return res.status(400).json({
          success: false,
          message: "COD collection can only be completed for delivered consignments"
        });
      }
      if (doc.cashCollectedAt) {
        return res.status(400).json({ success: false, message: "COD already recorded as collected" });
      }
      doc.cashCollectedAt = now;
      doc.codBankSlipUrl = slipUrl;
      if (!Array.isArray(doc.statusHistory)) doc.statusHistory = [];
      doc.statusHistory.push(historyEntry);
      await doc.save();
      return res.status(200).json({
        success: true,
        message: "Cash collection completed — bank slip saved",
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

/**
 * Completed COD collections (bank slip uploaded + cashCollectedAt set) — for "Complete" page.
 */
exports.listCompletedCashCollection = async (req, res) => {
  try {
    if (!assertRole(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { page = 1, limit = 20, destinationCity } = req.query;
    const pageNo = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.min(200, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNo - 1) * size;

    const destRx = destinationCity ? new RegExp(destinationCity.trim(), "i") : null;

    const [bsRows, mbRows] = await Promise.all([
      BookingStatus.find({
        codAmount: { $gt: 0 },
        cashCollectedAt: { $ne: null },
        ...(destRx ? { destinationCity: destRx } : {})
      })
        .select(
          "consignmentNumber codAmount status consigneeName consigneeMobile destinationCity originCity bookingDate cashCollectedAt codBankSlipUrl updatedAt"
        )
        .sort({ cashCollectedAt: -1 })
        .lean(),
      ManualBooking.find({
        codAmount: { $gt: 0 },
        cashCollectedAt: { $ne: null },
        ...(destRx ? { destinationCity: destRx } : {})
      })
        .select(
          "consignmentNo codAmount status consigneeName consigneeMobile destinationCity originCity date cashCollectedAt codBankSlipUrl updatedAt"
        )
        .sort({ cashCollectedAt: -1 })
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
        cashCollectedAt: b.cashCollectedAt,
        codBankSlipUrl: b.codBankSlipUrl,
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
        cashCollectedAt: m.cashCollectedAt,
        codBankSlipUrl: m.codBankSlipUrl,
        source: "manual_booking"
      }))
    ];

    rows.sort((a, b) => new Date(b.cashCollectedAt) - new Date(a.cashCollectedAt));
    const total = rows.length;
    const paginated = rows.slice(skip, skip + size);
    const totalCodCompleted = rows.reduce((sum, r) => sum + (Number(r.codAmount) || 0), 0);

    return res.status(200).json({
      success: true,
      message: "Completed COD cash collections (bank deposit recorded)",
      data: {
        rows: paginated,
        summary: {
          totalRecords: total,
          totalCodAmountCompleted: totalCodCompleted
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
