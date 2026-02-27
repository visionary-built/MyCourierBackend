const BookingStatus = require('../models/bookingStatus');
const ManualBooking = require('../models/ManualBooking');
const DeliverySheetPhaseI = require('../models/DeliverySheetPhaseI');

// Get single consignment by ID
exports.getTrackingById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ 
        success: false, 
        message: 'Consignment ID is required' 
      });
    }

    const booking = await BookingStatus.findById(id);

    if (!booking) {
      return res.status(404).json({ 
        success: false, 
        message: `No booking found with ID: ${id}`,
        data: null
      });
    }

    return res.status(200).json({ 
      success: true, 
      message: 'Tracking data retrieved successfully',
      data: booking 
    });
  } catch (error) {
    console.error('Error in getTrackingById:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Internal server error while retrieving tracking information',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get consignment by consignment number
exports.getTrackingByConsignmentNumber = async (req, res) => {
  try {
    const { consignmentNumber } = req.params;
    if (!consignmentNumber) {
      return res.status(400).json({ 
        success: false, 
        message: 'Consignment number is required' 
      });
    }

    const booking = await BookingStatus.findOne({ 
      consignmentNumber: consignmentNumber.toUpperCase() 
    });

    if (!booking) {
      return res.status(404).json({ 
        success: false, 
        message: `No booking found with consignment number: ${consignmentNumber}`,
        data: null
      });
    }

    return res.status(200).json({ 
      success: true, 
      message: 'Tracking data retrieved successfully',
      data: booking 
    });
  } catch (error) {
    console.error('Error in getTrackingByConsignmentNumber:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Internal server error while retrieving tracking information',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


// Get all consignments from multiple sources
exports.getAllConsignments = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    let bookingStatusQuery = {};
    if (status) {
      bookingStatusQuery.status = status;
    }
    const [bookingStatuses, totalBookings] = await Promise.all([
      BookingStatus.find(bookingStatusQuery)
        .sort({ createdAt: -1 })
        .lean(),
      BookingStatus.countDocuments(bookingStatusQuery)
    ]);

    let manualBookingQuery = {};
    if (status) {
      manualBookingQuery.status = status;
    }

    const [manualBookings, totalManualBookings] = await Promise.all([
      ManualBooking.find(manualBookingQuery)
        .sort({ createdAt: -1 })
        .lean(),
      ManualBooking.countDocuments(manualBookingQuery)
    ]);

    const deliverySheets = await DeliverySheetPhaseI.find({})
      .populate('rider', 'riderName riderCode')
      .lean();
    const combinedData = [
      ...bookingStatuses.map(item => ({
        _id: item._id,
        consignmentNumber: item.consignmentNumber,
        source: 'booking_status',
        status: item.status,
        bookingDate: item.bookingDate,
        deliveryDate: item.deliveryDate,
        destinationCity: item.destinationCity,
        accountNo: item.accountNo,
        agentName: item.agentName,
        consigneeName: item.consigneeName,
        consigneeMobile: item.consigneeMobile,
        consigneeAddress: item.consigneeAddress,
        pieces: item.pieces,
        weight: item.weight,
        codAmount: item.codAmount,
        referenceNo: item.referenceNo,
        remarks: item.remarks
      })),
      ...manualBookings.map(item => ({
        _id: item._id,
        consignmentNumber: item.consignmentNo,
        source: 'manual_booking',
        status: item.status,
        bookingDate: item.date,
        deliveryDate: item.deliveryDate,
        destinationCity: item.destinationCity,
        consigneeName: item.consigneeName,
        consigneeMobile: item.consigneeMobile,
        consigneeAddress: item.consigneeAddress,
        pieces: item.pieces,
        weight: item.weight,
        codAmount: item.codAmount,
        referenceNo: item.customerReferenceNo,
        remarks: item.remarks
      })),
      ...deliverySheets.flatMap(sheet => 
        sheet.consignmentNumbers.map(cn => ({
          consignmentNumber: cn,
          source: 'delivery_sheet',
          rider: {
            name: sheet.riderName,
            code: sheet.riderCode,
            id: sheet.riderId
          },
          status: sheet.status,
          createdAt: sheet.createdAt,
          updatedAt: sheet.updatedAt
        }))
      )
    ];

    // Sort by booking date (newest first)
    combinedData.sort((a, b) => new Date(b.bookingDate || b.createdAt) - new Date(a.bookingDate || a.createdAt));

    // Apply pagination
    const paginatedData = combinedData.slice(skip, skip + parseInt(limit));
    const totalItems = combinedData.length;
    const totalPages = Math.ceil(totalItems / limit);

    return res.status(200).json({
      success: true,
      message: 'Consignments retrieved successfully',
      data: {
        total: totalItems,
        totalPages,
        currentPage: parseInt(page),
        consignments: paginatedData
      }
    });
  } catch (error) {
    console.error('Error in getAllConsignments:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while retrieving consignments',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};
