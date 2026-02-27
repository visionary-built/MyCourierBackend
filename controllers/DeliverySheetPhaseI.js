const Rider = require('../models/Rider');
const ManualBooking = require('../models/ManualBooking');
const BookingStatus = require('../models/bookingStatus');
const DeliverySheetPhaseI = require('../models/DeliverySheetPhaseI');
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

    if (!riderId || !consignmentNumber) {
      return res.status(400).json({
        success: false,
        message: 'Rider ID and consignment number are required'
      });
    }

    const cnRegex = /^[A-Z0-9]+$/;
    if (!cnRegex.test(consignmentNumber.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid consignment number format'
      });
    }

    const rider = await Rider.findById(riderId);
    if (!rider || !rider.active) {
      return res.status(404).json({
        success: false,
        message: 'Rider not found or inactive'
      });
    }

    // Search for consignment in both BookingStatus and ManualBooking models
    let booking = await BookingStatus.findOne({ 
      consignmentNumber: consignmentNumber.toUpperCase() 
    });
    
    let manualBooking = null;
    if (!booking) {
      // If not found in BookingStatus, search in ManualBooking
      manualBooking = await ManualBooking.findOne({ 
        consignmentNo: consignmentNumber.toUpperCase() 
      });
      
      if (!manualBooking) {
        return res.status(404).json({
          success: false,
          message: 'Consignment number not found in booking system'
        });
      }
    }

    // Check if consignment exists in any ACTIVE delivery sheet
    const existingActiveSheet = await DeliverySheetPhaseI.findOne({ 
      consignmentNumbers: consignmentNumber.toUpperCase(),
      status: 'active'
    });
    
    if (existingActiveSheet) {
      if (existingActiveSheet.riderId.toString() !== riderId) {
        return res.status(400).json({
          success: false,
          message: 'Consignment number is already assigned to another active rider'
        });
      } else {
        return res.status(400).json({
          success: false,
          message: 'Consignment number is already assigned to you in another delivery sheet'
        });
      }
    }

    // Clean up any empty active sheets for this rider to prevent duplicates
    await DeliverySheetPhaseI.deleteMany({
      riderId: rider._id,
      status: 'active',
      $or: [
        { consignmentNumbers: { $size: 0 } },
        { consignmentNumbers: { $exists: false } }
      ]
    });

    // Create a new delivery sheet for this consignment
    const deliverySheet = await DeliverySheetPhaseI.create({
      riderId: rider._id,
      riderName: rider.riderName,
      riderCode: rider.riderCode,
      consignmentNumbers: [consignmentNumber.toUpperCase()],
      count: 1
    });

    try {
      // Update BookingStatus if it exists
      if (booking) {
        await BookingStatus.findOneAndUpdate(
          { consignmentNumber: consignmentNumber.toUpperCase() },
          { 
            status: 'in-transit',
            remarks: `Assigned to rider: ${rider.riderName} (${rider.riderCode})`
          }
        );
      }
      
      // Update ManualBooking if it exists
      if (manualBooking) {
        await ManualBooking.findOneAndUpdate(
          { consignmentNo: consignmentNumber.toUpperCase() },
          { status: 'in-transit' }
        );
      }
    } catch (updateError) {
      console.error("Error updating booking status:", updateError);
    }

    res.status(200).json({
      success: true,
      data: deliverySheet,
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
      if (booking.status === 'in-transit') {
        booking.status = 'pending';
      }
      await booking.save();
    }
    
    if (manualBooking) {
      const declineNote = `Declined by ${req.user.riderCode || req.user._id} at ${new Date().toISOString()}: ${reason}`;
      manualBooking.remarks = manualBooking.remarks ? `${manualBooking.remarks} | ${declineNote}` : declineNote;
      if (manualBooking.status === 'in-transit') {
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

    res.status(200).json({
      success: true,
      data: {
        deliverySheets,
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

    // Get parcel details
    const parcels = await BookingStatus.find({
      consignmentNumber: { $in: deliverySheet.consignmentNumbers }
    }).select('consignmentNumber destinationCity accountNo agentName status bookingDate deliveryDate remarks');

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
  getDeliverySheetById
};
