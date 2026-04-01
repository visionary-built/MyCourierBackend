const Rider = require("../models/Rider");
const ManualBooking = require("../models/ManualBooking");
const BookingStatus = require("../models/bookingStatus");
const DeliverySheetPhaseI = require("../models/DeliverySheetPhaseI");
const { getCargoContext } = require("./cargoLinkageService");

const CN_REGEX = /^[A-Z0-9]+$/;

function normalizeCity(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

/**
 * Same behaviour as Delivery Sheet "add consignment": active sheet per CN, booking → in-transit.
 * @param {string} riderId
 * @param {string} consignmentNumber
 * @param {{ allowSameRiderNoOp?: boolean }} [options] If true, CN already on an active sheet for this rider succeeds without error (idempotent for Last Mail scans).
 * @returns {Promise<{ success: true, deliverySheet: object, cargo: object, alreadyAssigned?: boolean } | { success: false, statusCode: number, message: string }>}
 */
async function assignConsignmentToRider(riderId, consignmentNumber, options = {}) {
  const { allowSameRiderNoOp = false } = options;
  const cn = String(consignmentNumber || "")
    .trim()
    .toUpperCase();

  if (!riderId || !cn) {
    return { success: false, statusCode: 400, message: "Rider ID and consignment number are required" };
  }
  if (!CN_REGEX.test(cn)) {
    return { success: false, statusCode: 400, message: "Invalid consignment number format" };
  }

  const rider = await Rider.findById(riderId);
  if (!rider || !rider.active) {
    return { success: false, statusCode: 404, message: "Rider not found or inactive" };
  }

  let booking = await BookingStatus.findOne({ consignmentNumber: cn });
  let manualBooking = null;
  if (!booking) {
    manualBooking = await ManualBooking.findOne({ consignmentNo: cn });
    if (!manualBooking) {
      return { success: false, statusCode: 404, message: "Consignment number not found in booking system" };
    }
  }

  const destCity = booking ? booking.destinationCity : manualBooking?.destinationCity;
  if (rider.city && destCity && String(rider.city).trim() && String(destCity).trim()) {
    if (normalizeCity(rider.city) !== normalizeCity(destCity)) {
      return {
        success: false,
        statusCode: 400,
        message: `Rider is assigned to ${String(rider.city).trim()} — parcel destination is ${String(destCity).trim()}`
      };
    }
  }

  const existingActiveSheet = await DeliverySheetPhaseI.findOne({
    consignmentNumbers: cn,
    status: "active"
  });

  if (existingActiveSheet) {
    if (existingActiveSheet.riderId.toString() !== String(riderId)) {
      return {
        success: false,
        statusCode: 400,
        message: "Consignment number is already assigned to another active rider"
      };
    }
    if (allowSameRiderNoOp) {
      const cargo = await getCargoContext(cn);
      return {
        success: true,
        deliverySheet: existingActiveSheet,
        cargo,
        alreadyAssigned: true
      };
    }
    return {
      success: false,
      statusCode: 400,
      message: "Consignment number is already assigned to you in another delivery sheet"
    };
  }

  await DeliverySheetPhaseI.deleteMany({
    riderId: rider._id,
    status: "active",
    $or: [{ consignmentNumbers: { $size: 0 } }, { consignmentNumbers: { $exists: false } }]
  });

  const deliverySheet = await DeliverySheetPhaseI.create({
    riderId: rider._id,
    riderName: rider.riderName,
    riderCode: rider.riderCode,
    consignmentNumbers: [cn],
    count: 1
  });

  try {
    if (booking) {
      await BookingStatus.findOneAndUpdate(
        { consignmentNumber: cn },
        {
          status: "in-transit",
          remarks: `Assigned to rider: ${rider.riderName} (${rider.riderCode})`
        }
      );
    }
    if (manualBooking) {
      await ManualBooking.findOneAndUpdate({ consignmentNo: cn }, { status: "in-transit" });
    }
  } catch (updateError) {
    console.error("Error updating booking status (deliveryAssignmentService):", updateError);
  }

  const cargo = await getCargoContext(cn);
  return { success: true, deliverySheet, cargo, alreadyAssigned: false };
}

module.exports = { assignConsignmentToRider };
