const ReturnSheet = require('../models/ReturnSheet');
const Rider = require('../models/Rider');
const BookingStatus = require('../models/bookingStatus');

// Create return Sheet
const registerReturn = async (req, res) => {
  try {
    const { consignmentNumber } = req.body;
    const riderId = req.body.riderId || req.user?.id; // prefer authenticated rider
    if (!riderId || !consignmentNumber) {
      return res.status(400).json({ success: false, message: 'Rider ID and consignment number are required' });
    }
    const cn = consignmentNumber.toUpperCase();
    const rider = await Rider.findById(riderId);
    if (!rider || !rider.active) {
      return res.status(404).json({ success: false, message: 'Rider not found or inactive' });
    }
    const booking = await BookingStatus.findOne({ consignmentNumber: cn });
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Consignment number not found in booking system' });
    }
    let returnSheet = await ReturnSheet.findOne({ riderId, outcome: 'received_at_office', createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } });
    if (!returnSheet) {
      returnSheet = await ReturnSheet.create({
        riderId: rider._id,
        riderName: rider.riderName,
        riderCode: rider.riderCode,
        consignmentNumbers: [cn],
        orderStatuses: [booking.status],
        count: 1,
        outcome: 'received_at_office'
      });
    } else {
      if (returnSheet.consignmentNumbers.includes(cn)) {
        return res.status(400).json({ success: false, message: 'Consignment number already registered in this return sheet' });
      }
      returnSheet.consignmentNumbers.push(cn);
      returnSheet.orderStatuses.push(booking.status);
      await returnSheet.save();
    }
    booking.status = 'returned';
    await booking.save();
    res.status(200).json({ success: true, data: returnSheet, message: 'Return registered successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
  }
};

// Get return sheet for a rider 
const getReturnSheet = async (req, res) => {
  try {
    const riderId = req.params.riderId || req.user?.id; 
    if (!riderId) {
      return res.status(400).json({ success: false, message: 'Rider ID is required' });
    }
    const returnSheet = await ReturnSheet.findOne({ riderId, outcome: 'received_at_office', createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } });
    if (!returnSheet) {
      return res.status(404).json({ success: false, message: 'No active return sheet found for this rider' });
    }
    // Get parcel details
    const parcels = await BookingStatus.find({ consignmentNumber: { $in: returnSheet.consignmentNumbers } });
    res.status(200).json({ success: true, data: { returnSheet, parcels } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
  }
};

// Complete return sheet (move to next outcome)
const completeReturnSheet = async (req, res) => {
  try {
    const { id } = req.params;
    const { outcome, remarks } = req.body;
    const returnSheet = await ReturnSheet.findById(id);
    if (!returnSheet) {
      return res.status(404).json({ success: false, message: 'Return sheet not found' });
    }
    returnSheet.outcome = outcome || 'to_be_sent_back';
    if (remarks) returnSheet.remarks = remarks;
    await returnSheet.save();
    res.status(200).json({ success: true, data: returnSheet, message: 'Return sheet updated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
  }
};

// Admin: Get all return sheets (with filters)
const getAllReturnSheets = async (req, res) => {
  try {
    const { riderId, outcome, page = 1, limit = 10 } = req.query;
    const query = {};
    if (riderId) query.riderId = riderId;
    if (outcome) query.outcome = outcome;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const returnSheets = await ReturnSheet.find(query)
      .populate('riderId', 'riderName riderCode')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    const total = await ReturnSheet.countDocuments(query);
    res.status(200).json({
      success: true,
      data: {
        returnSheets,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit))
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
  }
};

module.exports = {
  registerReturn,
  getReturnSheet,
  completeReturnSheet,
  getAllReturnSheets
};
