const DeliverySheetPhaseI = require("../models/DeliverySheetPhaseI");
const BookingStatus = require("../models/bookingStatus");
const ManualBooking = require("../models/ManualBooking");

const ALLOWED_ROLES = ["superAdmin", "admin", "operation", "operationPortal"];

/**
 * Pickup history = timeline of consignments assigned to riders via delivery sheets (first-mile / pickup assignment).
 * Each DeliverySheetPhaseI row typically represents one consignment handed to a rider.
 */
exports.getPickupHistory = async (req, res) => {
  try {
    if (!req.user || !ALLOWED_ROLES.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const {
      page = 1,
      limit = 20,
      riderId,
      consignmentNumber,
      sheetStatus,
      dateFrom,
      dateTo
    } = req.query;

    const query = {};
    if (riderId) query.riderId = riderId;
    if (sheetStatus) query.status = sheetStatus;
    if (consignmentNumber) {
      query.consignmentNumbers = String(consignmentNumber).trim().toUpperCase();
    }
    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setDate(end.getDate() + 1);
        query.createdAt.$lt = end;
      }
    }

    const pageNo = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNo - 1) * size;

    const [sheets, total] = await Promise.all([
      DeliverySheetPhaseI.find(query).sort({ createdAt: -1 }).skip(skip).limit(size).lean(),
      DeliverySheetPhaseI.countDocuments(query)
    ]);

    const allCns = [...new Set(sheets.flatMap((s) => s.consignmentNumbers || []))];
    const [bsRows, mbRows] = await Promise.all([
      BookingStatus.find({ consignmentNumber: { $in: allCns } })
        .select("consignmentNumber originCity destinationCity status")
        .lean(),
      ManualBooking.find({ consignmentNo: { $in: allCns } })
        .select("consignmentNo originCity destinationCity status")
        .lean()
    ]);

    const cnMeta = new Map();
    bsRows.forEach((b) => {
      cnMeta.set(b.consignmentNumber, {
        originCity: b.originCity,
        destinationCity: b.destinationCity,
        bookingStatus: b.status
      });
    });
    mbRows.forEach((m) => {
      if (!cnMeta.has(m.consignmentNo)) {
        cnMeta.set(m.consignmentNo, {
          originCity: m.originCity,
          destinationCity: m.destinationCity,
          bookingStatus: m.status
        });
      }
    });

    const items = [];
    for (const sheet of sheets) {
      const cns = sheet.consignmentNumbers || [];
      for (const cn of cns) {
        const meta = cnMeta.get(cn) || {};
        items.push({
          eventType: "assigned_to_rider",
          consignmentNumber: cn,
          assignedAt: sheet.createdAt,
          sheetId: sheet._id,
          sheetStatus: sheet.status,
          completedAt: sheet.completedAt || null,
          riderId: sheet.riderId,
          riderName: sheet.riderName,
          riderCode: sheet.riderCode,
          originCity: meta.originCity || null,
          destinationCity: meta.destinationCity || null,
          bookingStatus: meta.bookingStatus || null
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: "Pickup history retrieved successfully",
      data: items,
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
