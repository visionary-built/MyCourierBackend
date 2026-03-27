const BookingStatus = require("../models/bookingStatus");
const ManualBooking = require("../models/ManualBooking");
const ArrivalParcel = require("../models/arrivalScan");
const { getCargoContext } = require("../services/cargoLinkageService");
const { getArrivalMetaForConsignment } = require("../services/arrivalEventsService");

const ALLOWED_ROLES = ["superAdmin", "admin", "operation", "operationPortal"];

const assertRole = (req) => req.user && ALLOWED_ROLES.includes(req.user.role);

const normalizeCn = (cn) => String(cn || "").trim().toUpperCase();

/**
 * A) Quick scan — one request returns booking + parcel + cargo + arrival for barcode/CN lookup.
 */
exports.quickScan = async (req, res) => {
  try {
    if (!assertRole(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const cn = normalizeCn(req.params.consignmentNumber);
    if (!cn) {
      return res.status(400).json({ success: false, message: "Consignment number is required" });
    }

    const [booking, manual, parcel, cargo, arrival] = await Promise.all([
      BookingStatus.findOne({ consignmentNumber: cn }).lean(),
      ManualBooking.findOne({ consignmentNo: cn }).lean(),
      ArrivalParcel.findOne({ consignmentNumber: cn }).lean(),
      getCargoContext(cn),
      getArrivalMetaForConsignment(cn)
    ]);

    if (!booking && !manual) {
      return res.status(404).json({
        success: false,
        message: "Consignment not found in booking system"
      });
    }

    const primary = booking || manual;
    const statusHistory = primary.statusHistory || [];
    const recentHistory = Array.isArray(statusHistory)
      ? [...statusHistory].sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0)).slice(0, 15)
      : [];

    return res.status(200).json({
      success: true,
      message: "Quick scan result",
      data: {
        consignmentNumber: cn,
        source: booking ? "booking_status" : "manual_booking",
        booking: booking || null,
        manualBooking: manual && !booking ? manual : null,
        parcel: parcel || null,
        cargo,
        arrival,
        currentStatus: primary.status,
        consigneeName: primary.consigneeName,
        destinationCity: primary.destinationCity,
        originCity: primary.originCity,
        codAmount: primary.codAmount != null ? primary.codAmount : undefined,
        recentHistory
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

/**
 * B) Scanning history — merged timeline from statusHistory on all bookings (BookingStatus + ManualBooking).
 */
exports.getScanningHistory = async (req, res) => {
  try {
    if (!assertRole(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { page = 1, limit = 20, consignmentNumber, dateFrom, dateTo } = req.query;
    const pageNo = Math.max(1, parseInt(page, 10) || 1);
    const size = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNo - 1) * size;

    const matchStages = [];
    if (consignmentNumber) {
      matchStages.push({
        $match: { consignmentNumber: normalizeCn(consignmentNumber) }
      });
    }
    if (dateFrom || dateTo) {
      const range = {};
      if (dateFrom) range.$gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setDate(end.getDate() + 1);
        range.$lt = end;
      }
      matchStages.push({ $match: { timestamp: range } });
    }

    const manualColl = ManualBooking.collection.collectionName;

    const pipeline = [
      { $unwind: "$statusHistory" },
      {
        $project: {
          consignmentNumber: 1,
          eventType: "$statusHistory.status",
          timestamp: "$statusHistory.timestamp",
          remarks: "$statusHistory.remarks",
          updatedBy: "$statusHistory.updatedBy",
          reason: "$statusHistory.reason",
          source: { $literal: "booking_status" }
        }
      },
      {
        $unionWith: {
          coll: manualColl,
          pipeline: [
            { $unwind: "$statusHistory" },
            {
              $project: {
                consignmentNumber: "$consignmentNo",
                eventType: "$statusHistory.status",
                timestamp: "$statusHistory.timestamp",
                remarks: "$statusHistory.remarks",
                updatedBy: "$statusHistory.updatedBy",
                reason: "$statusHistory.reason",
                source: { $literal: "manual_booking" }
              }
            }
          ]
        }
      },
      ...matchStages,
      { $sort: { timestamp: -1 } },
      {
        $facet: {
          rows: [{ $skip: skip }, { $limit: size }],
          totalCount: [{ $count: "count" }]
        }
      }
    ];

    const aggResult = await BookingStatus.aggregate(pipeline).allowDiskUse(true);
    const facet = aggResult[0] || {};
    const rows = facet.rows || [];
    const total = facet.totalCount && facet.totalCount[0] ? facet.totalCount[0].count : 0;

    return res.status(200).json({
      success: true,
      message: "Scanning history (from booking status timelines)",
      data: rows,
      pagination: {
        page: pageNo,
        limit: size,
        total,
        totalPages: Math.ceil(total / size) || 1
      }
    });
  } catch (error) {
    console.error("getScanningHistory:", error);
    return res.status(500).json({
      success: false,
      message: "Server error — if MongoDB version is old, $unionWith may be unsupported",
      error: error.message
    });
  }
};
