const Rider = require('../models/Rider');
const ManualBooking = require('../models/ManualBooking');
const BookingStatus = require('../models/bookingStatus');
const DeliverySheetPhaseI = require('../models/DeliverySheetPhaseI');
const { getCargoContext } = require('../services/cargoLinkageService');
const { assignConsignmentToRider } = require('../services/deliveryAssignmentService');

const normalizeCn = (cn) => String(cn || '').trim().toUpperCase();

const BOOKING_STATUS_LIST_FIELDS =
  'consignmentNumber consigneeName consigneeAddress consigneeMobile destinationCity originCity weight codAmount pieces accountNo agentName status bookingDate deliveryDate remarks referenceNo';
const MANUAL_BOOKING_LIST_FIELDS =
  'consignmentNo consigneeName consigneeAddress consigneeMobile destinationCity originCity weight codAmount pieces status date createdAt updatedAt senderName productDetail customerReferenceNo remarks orderId';

/**
 * Load booking / manual rows for many CNs. BookingStatus wins if both exist.
 * @returns {Map<string, object>}
 */
async function loadBookingsByConsignmentNumbers(consignmentNumbers) {
  const uniq = [...new Set((consignmentNumbers || []).map(normalizeCn))].filter(Boolean);
  const map = new Map();
  if (uniq.length === 0) return map;

  const [bsList, mbList] = await Promise.all([
    BookingStatus.find({ consignmentNumber: { $in: uniq } }).select(BOOKING_STATUS_LIST_FIELDS).lean(),
    ManualBooking.find({ consignmentNo: { $in: uniq } }).select(MANUAL_BOOKING_LIST_FIELDS).lean()
  ]);

  bsList.forEach((b) => {
    map.set(b.consignmentNumber, { ...b, source: 'booking_status' });
  });
  mbList.forEach((m) => {
    const cn = normalizeCn(m.consignmentNo);
    if (!map.has(cn)) {
      map.set(cn, {
        consignmentNumber: cn,
        consigneeName: m.consigneeName,
        consigneeAddress: m.consigneeAddress,
        consigneeMobile: m.consigneeMobile,
        destinationCity: m.destinationCity,
        originCity: m.originCity,
        weight: m.weight,
        codAmount: m.codAmount,
        pieces: m.pieces,
        status: m.status,
        bookingDate: m.date || m.createdAt,
        deliveryDate: m.updatedAt,
        remarks: m.remarks,
        accountNo: null,
        agentName: null,
        referenceNo: m.customerReferenceNo,
        orderId: m.orderId,
        source: 'manual_booking'
      });
    }
  });
  return map;
}

function attachBookingsToSheetDocs(sheetDocs, bookingMap) {
  return sheetDocs.map((sheet) => {
    const obj = sheet.toObject ? sheet.toObject({ virtuals: true }) : { ...sheet };
    const cns = obj.consignmentNumbers || [];
    obj.bookings = cns.map((cn) => {
      const key = normalizeCn(cn);
      return (
        bookingMap.get(key) || {
          consignmentNumber: key,
          source: null,
          missingBooking: true
        }
      );
    });
    return obj;
  });
}

// Get all active riders for selection
const getActiveRiders = async (req, res) => {
  try {
    const riders = await Rider.find({ active: true })
      .select('riderName riderCode mobileNo')
      .sort({ riderName: 1 });

    res.status(200).json({
      success: true,
      data: riders
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Create a new delivery sheet - Deprecated: Use addConsignmentNumber directly
const createOrGetDeliverySheet = async (req, res) => {
  try {
    const { riderId } = req.body;

    if (!riderId) {
      return res.status(400).json({
        success: false,
        message: 'Rider ID is required'
      });
    }

    const rider = await Rider.findById(riderId);
    if (!rider || !rider.active) {
      return res.status(404).json({
        success: false,
        message: 'Rider not found or inactive'
      });
    }

    // Instead of creating empty sheets, return rider info and instruct to use add-consignment
    res.status(200).json({
      success: true,
      data: {
        riderId: rider._id,
        riderName: rider.riderName,
        riderCode: rider.riderCode,
        message: 'Rider verified. Use add-consignment endpoint to create delivery sheets with consignments.'
      },
      message: 'Please use the add-consignment endpoint to create delivery sheets directly with consignment numbers'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Add consignment number to delivery sheet - Creates a new sheet for each consignment
const addConsignmentNumber = async (req, res) => {
  try {
    const { riderId, consignmentNumber } = req.body;

    const result = await assignConsignmentToRider(riderId, consignmentNumber, {
      allowSameRiderNoOp: false
    });
    if (!result.success) {
      return res.status(result.statusCode).json({
        success: false,
        message: result.message
      });
    }

    const { deliverySheet, cargo } = result;
    res.status(200).json({
      success: true,
      data: {
        ...(deliverySheet.toObject ? deliverySheet.toObject() : deliverySheet),
        cargo
      },
      message: 'New delivery sheet created with consignment number and booking status updated to in-transit'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Get all delivery sheets with parcel details for a rider
const getDeliverySheetWithParcels = async (req, res) => {
  try {
    const { riderId } = req.params;

    if (!riderId) {
      return res.status(400).json({
        success: false,
        message: 'Rider ID is required'
      });
    }

    // Get all active delivery sheets for this rider (since each consignment has its own sheet)
    const deliverySheets = await DeliverySheetPhaseI.find({
      riderId: riderId,
      status: 'active'
    }).sort({ createdAt: -1 });
    
    if (!deliverySheets || deliverySheets.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No active delivery sheets found for this rider'
      });
    }

    // Get all consignment numbers from all sheets
    const allConsignmentNumbers = deliverySheets.reduce((acc, sheet) => {
      return acc.concat(sheet.consignmentNumbers);
    }, []);

    // Fetch parcels from both BookingStatus and ManualBooking models
    const [bookingStatusParcels, manualBookingParcels] = await Promise.all([
      BookingStatus.find({
        consignmentNumber: { $in: allConsignmentNumbers }
      }).select('consignmentNumber destinationCity accountNo agentName status bookingDate deliveryDate remarks'),
      
      ManualBooking.find({
        consignmentNo: { $in: allConsignmentNumbers }
      }).select('consignmentNo destinationCity status createdAt updatedAt')
    ]);

    // Combine and format the parcels data
    const parcels = [];
    
    // Add BookingStatus parcels
    bookingStatusParcels.forEach(parcel => {
      parcels.push({
        consignmentNumber: parcel.consignmentNumber,
        destinationCity: parcel.destinationCity,
        accountNo: parcel.accountNo,
        agentName: parcel.agentName,
        status: parcel.status,
        bookingDate: parcel.bookingDate,
        deliveryDate: parcel.deliveryDate,
        remarks: parcel.remarks,
        source: 'booking_status'
      });
    });
    
    // Add ManualBooking parcels
    manualBookingParcels.forEach(parcel => {
      parcels.push({
        consignmentNumber: parcel.consignmentNo,
        destinationCity: parcel.destinationCity,
        accountNo: 'N/A',
        agentName: 'N/A',
        status: parcel.status,
        bookingDate: parcel.createdAt,
        deliveryDate: parcel.updatedAt,
        remarks: 'Manual Booking',
        source: 'manual_booking'
      });
    });

    // Return the most recent delivery sheet info with all parcels
    const mostRecentSheet = deliverySheets[0];
    const totalCount = deliverySheets.reduce((sum, sheet) => sum + sheet.count, 0);

    res.status(200).json({
      success: true,
      data: {
        deliverySheet: {
          _id: mostRecentSheet._id,
          riderId: mostRecentSheet.riderId,
          riderName: mostRecentSheet.riderName,
          riderCode: mostRecentSheet.riderCode,
          count: totalCount, // Total count of all active sheets
          status: mostRecentSheet.status,
          createdAt: mostRecentSheet.createdAt
        },
        parcels: parcels
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Get specific rider own active delivery sheet with parcels
const getMyActiveDeliverySheet = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    req.params.riderId = req.user.id;
    return getDeliverySheetWithParcels(req, res);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Remove consignment number from delivery sheet
const removeConsignmentNumber = async (req, res) => {
  try {
    const { riderId, consignmentNumber } = req.body;

    if (!riderId || !consignmentNumber) {
      return res.status(400).json({
        success: false,
        message: 'Rider ID and consignment number are required'
      });
    }

    // Get active delivery sheet for the rider
    const deliverySheet = await DeliverySheetPhaseI.findActiveByRider(riderId);
    
    if (!deliverySheet) {
      return res.status(404).json({
        success: false,
        message: 'No active delivery sheet found for this rider'
      });
    }

    // Remove consignment number from the sheet
    const index = deliverySheet.consignmentNumbers.indexOf(consignmentNumber.toUpperCase());
    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: 'Consignment number not found in this delivery sheet'
      });
    }

    deliverySheet.consignmentNumbers.splice(index, 1);
    await deliverySheet.save();

    // Update BookingStatus back to 'pending' when removed from rider
    try {
      await BookingStatus.findOneAndUpdate(
        { consignmentNumber: consignmentNumber.toUpperCase() },
        { 
          status: 'pending',
          remarks: 'Removed from delivery assignment - back to pending'
        }
      );
    } catch (statusError) {
      console.error("Error updating booking status:", statusError);
    }

    // Also update ManualBooking status back to 'pending'
    try {
      await ManualBooking.findOneAndUpdate(
        { consignmentNo: consignmentNumber.toUpperCase() },
        { status: 'pending' }
      );
    } catch (manualBookingError) {
      console.error("Error updating manual booking status:", manualBookingError);
    }

    res.status(200).json({
      success: true,
      data: deliverySheet,
      message: 'Consignment number removed successfully and booking status updated to pending'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Complete delivery sheet
const completeDeliverySheet = async (req, res) => {
  try {
    const { riderId } = req.params;
    const { remarks } = req.body;

    if (!riderId) {
      return res.status(400).json({
        success: false,
        message: 'Rider ID is required'
      });
    }

    // Get active delivery sheet for the rider
    const deliverySheet = await DeliverySheetPhaseI.findActiveByRider(riderId);
    
    if (!deliverySheet) {
      return res.status(404).json({
        success: false,
        message: 'No active delivery sheet found for this rider'
      });
    }

    deliverySheet.status = 'delivered';
    deliverySheet.completedAt = new Date();
    if (remarks) {
      deliverySheet.remarks = remarks;
    }
    
    await deliverySheet.save();
    try {
      await BookingStatus.updateMany(
        { consignmentNumber: { $in: deliverySheet.consignmentNumbers } },
        { 
          status: 'delivered',
          deliveryDate: new Date(),
          remarks: remarks || 'Delivered - Delivery sheet completed'
        }
      );
    } catch (statusError) {
      console.error("Error updating booking statuses:", statusError);
    }

    try {
      await ManualBooking.updateMany(
        { consignmentNo: { $in: deliverySheet.consignmentNumbers } },
        { status: 'delivered' }
      );
    } catch (manualBookingError) {
      console.error("Error updating manual booking statuses:", manualBookingError);
    }

    res.status(200).json({
      success: true,
      data: deliverySheet,
      message: 'Delivery sheet completed successfully and all bookings marked as delivered'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Rider accepts an assigned consignment
const riderAcceptConsignment = async (req, res) => {
  try {
    const { consignmentNumber } = req.params;
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!consignmentNumber) {
      return res.status(400).json({ success: false, message: 'Consignment number is required' });
    }

    const cn = consignmentNumber.toUpperCase();
    const activeSheet = await DeliverySheetPhaseI.findActiveByRider(req.user.id);
    if (!activeSheet || !activeSheet.consignmentNumbers.includes(cn)) {
      return res.status(404).json({ success: false, message: 'Consignment not assigned to you' });
    }

    // Search for consignment in both BookingStatus and ManualBooking models
    let booking = await BookingStatus.findOne({ consignmentNumber: cn });
    let manualBooking = null;
    
    if (!booking) {
      // If not found in BookingStatus, search in ManualBooking
      manualBooking = await ManualBooking.findOne({ consignmentNo: cn });
      
      if (!manualBooking) {
        return res.status(404).json({ success: false, message: 'Booking not found for this consignment number' });
      }
    }

    const acceptNote = `Accepted by ${req.user.riderCode || req.user._id} at ${new Date().toISOString()}`;
    if (booking) {
      booking.status = 'in-transit';
      booking.remarks = booking.remarks ? `${booking.remarks} | ${acceptNote}` : acceptNote;
      // Push status history if field exists
      try {
        if (Array.isArray(booking.statusHistory)) {
          booking.statusHistory.push({ status: 'in-transit', timestamp: new Date(), remarks: acceptNote, updatedBy: req.user.id });
        }
      } catch (_) {}
      await booking.save();
    } else if (manualBooking) {
      manualBooking.status = 'in-transit';
      manualBooking.remarks = manualBooking.remarks ? `${manualBooking.remarks} | ${acceptNote}` : acceptNote;
      try {
        if (Array.isArray(manualBooking.statusHistory)) {
          manualBooking.statusHistory.push({ status: 'in-transit', timestamp: new Date(), remarks: acceptNote, updatedBy: req.user.id });
        }
      } catch (_) {}
      await manualBooking.save();
    }

    return res.status(200).json({
      success: true,
      message: 'Consignment accepted successfully',
      data: { consignmentNumber: cn, booking: booking || manualBooking }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error', error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
  }
};

// Rider declines an assigned consignment function
const riderDeclineConsignment = async (req, res) => {
  try {
    const { consignmentNumber } = req.params;
    const { reason } = req.body;
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!consignmentNumber) {
      return res.status(400).json({ success: false, message: 'Consignment number is required' });
    }
    if (!reason || String(reason).trim().length < 3) {
      return res.status(400).json({ success: false, message: 'Decline reason is required' });
    }

    const cn = consignmentNumber.toUpperCase();
    const activeSheet = await DeliverySheetPhaseI.findActiveByRider(req.user.id);
    if (!activeSheet || !activeSheet.consignmentNumbers.includes(cn)) {
      return res.status(404).json({ success: false, message: 'Consignment not assigned to you' });
    }

    activeSheet.consignmentNumbers = activeSheet.consignmentNumbers.filter(x => x !== cn);
    await activeSheet.save();

    // Search for consignment in both BookingStatus and ManualBooking models
    let booking = await BookingStatus.findOne({ consignmentNumber: cn });
    let manualBooking = null;
    
    if (!booking) {
      // If not found in BookingStatus, search in ManualBooking
      manualBooking = await ManualBooking.findOne({ consignmentNo: cn });
    }
    
    if (booking) {
      const declineNote = `Declined by ${req.user.riderCode || req.user._id} at ${new Date().toISOString()}: ${reason}`;
      booking.remarks = booking.remarks ? `${booking.remarks} | ${declineNote}` : declineNote;
      if (
        ['in-transit', 'at-origin-facility', 'at-destination-facility'].includes(booking.status)
      ) {
        booking.status = 'pending';
      }
      await booking.save();
    }
    
    if (manualBooking) {
      const declineNote = `Declined by ${req.user.riderCode || req.user._id} at ${new Date().toISOString()}: ${reason}`;
      manualBooking.remarks = manualBooking.remarks ? `${manualBooking.remarks} | ${declineNote}` : declineNote;
      if (
        ['in-transit', 'at-origin-facility', 'at-destination-facility'].includes(manualBooking.status)
      ) {
        manualBooking.status = 'pending';
      }
      await manualBooking.save();
    }

    return res.status(200).json({
      success: true,
      message: 'Consignment declined and unassigned. Admin can reassign.',
      data: { consignmentNumber: cn }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Server error', error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
  }
};

// Get all delivery sheets (for admin view)
const getAllDeliverySheets = async (req, res) => {
  try {
    const { status, riderId, page = 1, limit = 10 } = req.query;

    const query = {};
    if (status) query.status = status;
    if (riderId) query.riderId = riderId;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const deliverySheets = await DeliverySheetPhaseI.find(query)
      .populate('rider', 'riderName riderCode mobileNo')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await DeliverySheetPhaseI.countDocuments(query);

    const allCns = deliverySheets.reduce((acc, s) => acc.concat(s.consignmentNumbers || []), []);
    const bookingMap = await loadBookingsByConsignmentNumbers(allCns);
    const deliverySheetsWithBookings = attachBookingsToSheetDocs(deliverySheets, bookingMap);

    res.status(200).json({
      success: true,
      data: {
        deliverySheets: deliverySheetsWithBookings,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Get delivery sheet by ID
const getDeliverySheetById = async (req, res) => {
  try {
    const { id } = req.params;

    const deliverySheet = await DeliverySheetPhaseI.findById(id)
      .populate('rider', 'riderName riderCode mobileNo');

    if (!deliverySheet) {
      return res.status(404).json({
        success: false,
        message: 'Delivery sheet not found'
      });
    }

    const bookingMap = await loadBookingsByConsignmentNumbers(deliverySheet.consignmentNumbers);
    const parcels = (deliverySheet.consignmentNumbers || []).map((cn) => {
      const key = normalizeCn(cn);
      return (
        bookingMap.get(key) || {
          consignmentNumber: key,
          source: null,
          missingBooking: true
        }
      );
    });

    res.status(200).json({
      success: true,
      data: {
        deliverySheet,
        parcels
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

const DELIVERY_SHEET_STATUSES = [
  'active',
  'pending',
  'in-transit',
  'delivered',
  'cancelled',
  'completed',
  'close',
  'incomplete',
  'refused',
  'untracable addrress',
  'call not responsding',
  'costumer want delivery tomorrow',
  'out of city',
  'forcefully open return',
  'allow to open as per shipper'
];

// Admin: update a delivery sheet by document id (e.g. edit modal)
const updateDeliverySheetById = async (req, res) => {
  try {
    const { id } = req.params;
    const { riderName, riderCode, status, remarks } = req.body;

    const deliverySheet = await DeliverySheetPhaseI.findById(id);
    if (!deliverySheet) {
      return res.status(404).json({
        success: false,
        message: 'Delivery sheet not found'
      });
    }

    const previousStatus = deliverySheet.status;

    if (riderName !== undefined) {
      deliverySheet.riderName = String(riderName).trim();
    }
    if (riderCode !== undefined) {
      deliverySheet.riderCode = String(riderCode).trim();
    }
    if (remarks !== undefined) {
      deliverySheet.remarks = remarks == null ? '' : String(remarks).trim();
    }
    if (status !== undefined) {
      const normalized = String(status).trim().toLowerCase();
      if (!DELIVERY_SHEET_STATUSES.includes(normalized)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid status'
        });
      }
      // ManualBooking / rider-complete flow use "delivered" only. "completed" on a sheet is the same
      // closure state; store as "delivered" so one terminal value matches list + booking views.
      const finalSheetStatus = normalized === 'completed' ? 'delivered' : normalized;
      deliverySheet.status = finalSheetStatus;
      if (finalSheetStatus === 'delivered') {
        deliverySheet.completedAt = deliverySheet.completedAt || new Date();
      }
    }

    await deliverySheet.save();

    const finishedNow =
      deliverySheet.status === 'delivered' &&
      previousStatus !== 'delivered' &&
      previousStatus !== 'completed';

    if (finishedNow && deliverySheet.consignmentNumbers.length > 0) {
      const remarkText = deliverySheet.remarks || 'Delivered - Delivery sheet updated by admin';
      try {
        await BookingStatus.updateMany(
          { consignmentNumber: { $in: deliverySheet.consignmentNumbers } },
          {
            status: 'delivered',
            deliveryDate: new Date(),
            remarks: remarkText
          }
        );
      } catch (statusError) {
        console.error('Error updating booking statuses:', statusError);
      }
      try {
        await ManualBooking.updateMany(
          { consignmentNo: { $in: deliverySheet.consignmentNumbers } },
          { status: 'delivered' }
        );
      } catch (manualBookingError) {
        console.error('Error updating manual booking statuses:', manualBookingError);
      }
    }

    const populated = await DeliverySheetPhaseI.findById(deliverySheet._id).populate(
      'rider',
      'riderName riderCode mobileNo'
    );

    res.status(200).json({
      success: true,
      data: populated,
      message: 'Delivery sheet updated successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

module.exports = {
  getActiveRiders,
  createOrGetDeliverySheet,
  addConsignmentNumber,
  getDeliverySheetWithParcels,
  getMyActiveDeliverySheet,
  removeConsignmentNumber,
  completeDeliverySheet,
   riderAcceptConsignment,
   riderDeclineConsignment,
  getAllDeliverySheets,
  getDeliverySheetById,
  updateDeliverySheetById
};
