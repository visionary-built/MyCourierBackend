const {
  recordOriginArrival: applyOriginArrival,
  recordDestinationArrival: applyDestinationArrival
} = require("../services/arrivalEventsService");
const { getCargoContext } = require("../services/cargoLinkageService");

const ALLOWED_ROLES = ["superAdmin", "admin", "operation", "operationPortal"];

function assertRole(req) {
  return req.user && ALLOWED_ROLES.includes(req.user.role);
}

exports.recordOriginArrival = async (req, res) => {
  try {
    if (!assertRole(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const { consignmentNumber, remarks } = req.body;
    if (!consignmentNumber) {
      return res.status(400).json({ success: false, message: "consignmentNumber is required" });
    }

    const result = await applyOriginArrival(consignmentNumber, {
      remarks,
      updatedBy: req.user.role
    });

    if (!result.ok) {
      return res.status(404).json({ success: false, message: result.message });
    }

    const cargo = await getCargoContext(result.consignmentNumber);
    return res.status(200).json({
      success: true,
      message: "Origin arrival recorded",
      data: {
        consignmentNumber: result.consignmentNumber,
        stage: result.stage,
        booking: result.booking,
        manualBooking: result.manualBooking,
        parcel: result.parcel,
        arrival: result.arrival,
        cargo
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

exports.recordDestinationArrival = async (req, res) => {
  try {
    if (!assertRole(req)) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const { consignmentNumber, remarks } = req.body;
    if (!consignmentNumber) {
      return res.status(400).json({ success: false, message: "consignmentNumber is required" });
    }

    const result = await applyDestinationArrival(consignmentNumber, {
      remarks,
      updatedBy: req.user.role
    });

    if (!result.ok) {
      return res.status(404).json({ success: false, message: result.message });
    }

    const cargo = await getCargoContext(result.consignmentNumber);
    return res.status(200).json({
      success: true,
      message: "Destination arrival recorded",
      data: {
        consignmentNumber: result.consignmentNumber,
        stage: result.stage,
        booking: result.booking,
        manualBooking: result.manualBooking,
        parcel: result.parcel,
        arrival: result.arrival,
        cargo
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};
