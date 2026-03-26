const Rider = require('../models/Rider');
const ParcelService = require('../services/parcelService');
const ManualBooking = require('../models/ManualBooking');

exports.searchParcels = async (req, res) => {
  try {
    const { rider, consignmentNumber, status, page = 1, limit = 10 } = req.query;
    const searchCriteria = {
      rider,
      consignmentNumber,
      status
    };
    const result = await ParcelService.searchParcels(searchCriteria, page, limit);

    // Fallback: if not found in arrival scan, allow direct search in ManualBooking
    // so newly created manual consignments can still be discovered here.
    if (result.parcels.length === 0 && consignmentNumber) {
      const manual = await ManualBooking.findOne({
        consignmentNo: consignmentNumber.toUpperCase().trim()
      }).lean();

      if (manual) {
        const manualParcel = {
          _id: manual._id,
          consignmentNumber: manual.consignmentNo,
          rider: manual.assignedTo || null,
          status: manual.status || 'pending',
          destinationCity: manual.destinationCity,
          originCity: manual.originCity,
          consigneeName: manual.consigneeName,
          consigneeMobile: manual.consigneeMobile,
          codAmount: manual.codAmount || 0,
          remarks: manual.remarks || '',
          source: 'manual_booking',
          createdAt: manual.createdAt,
          updatedAt: manual.updatedAt
        };

        return res.status(200).json({
          success: true,
          message: 'Parcels retrieved successfully',
          data: {
            parcels: [manualParcel],
            pagination: {
              currentPage: 1,
              totalPages: 1,
              totalCount: 1,
              hasNextPage: false,
              hasPreviousPage: false,
              limit: parseInt(limit)
            }
          },
          searchCriteria: {
            rider: rider || null,
            consignmentNumber: consignmentNumber || null,
            status: status || null
          }
        });
      }
    }

    if (result.parcels.length === 0) {
      let message = 'No parcels found';
      if (consignmentNumber) {
        message = `No parcel found with consignment number: ${consignmentNumber}`;
      } else if (rider) {
        message = `No parcels found for rider: ${rider}`;
      }

      return res.status(404).json({
        success: false,
        message,
        data: {
          parcels: [],
          pagination: {
            currentPage: parseInt(page),
            totalPages: 0,
            totalCount: 0,
            hasNextPage: false,
            hasPreviousPage: false,
            limit: parseInt(limit)
          }
        }
      });
    }

    res.status(200).json({
      success: true,
      message: 'Parcels retrieved successfully',
      data: {
        parcels: result.parcels,
        pagination: {
          currentPage: result.currentPage,
          totalPages: result.totalPages,
          totalCount: result.totalCount,
          hasNextPage: result.hasNextPage,
          hasPreviousPage: result.hasPreviousPage,
          limit: result.limit
        }
      },
      searchCriteria: {
        rider: rider || null,
        consignmentNumber: consignmentNumber || null,
        status: status || null
      }
    });

  } catch (error) {
    console.error('Error searching parcels:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while searching parcels',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get rider statistics
exports.getRiderStatistics = async (req, res) => {
  try {
    const { rider } = req.params;

    if (!rider) {
      return res.status(400).json({
        success: false,
        message: 'Rider name is required'
      });
    }

    const stats = await ParcelService.getRiderStats(rider);

    res.status(200).json({
      success: true,
      message: `Statistics retrieved for rider: ${rider}`,
      data: {
        rider,
        statistics: stats
      }
    });

  } catch (error) {
    console.error('Error getting rider statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while getting statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Update parcel status
exports.updateParcelStatus = async (req, res) => {
  try {
    const { consignmentNumber } = req.params;
    const { status, remarks, arrivalDate } = req.body;

    if (!consignmentNumber) {
      return res.status(400).json({
        success: false,
        message: 'Consignment number is required'
      });
    }

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required'
      });
    }

    const validStatuses = ['pending', 'in-transit', 'delivered', 'returned', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Valid statuses are: ${validStatuses.join(', ')}`
      });
    }

    const updateData = { status };

    if (remarks) updateData.remarks = remarks;
    if (arrivalDate) updateData.arrivalDate = new Date(arrivalDate);
    if (status === 'delivered') updateData.deliveryDate = new Date();

    const parcel = await ParcelService.updateParcelStatus(consignmentNumber, {
      status,
      remarks,
      arrivalDate
    });

    if (!parcel) {
      return res.status(404).json({
        success: false,
        message: `Parcel with consignment number ${consignmentNumber} not found`
      });
    }

    res.status(200).json({
      success: true,
      message: 'Parcel status updated successfully',
      data: parcel
    });

  } catch (error) {
    console.error('Error updating parcel status:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while updating parcel status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get parcel by consignment number
exports.getParcelById = async (req, res) => {
  try {
    const { consignmentNumber } = req.params;

    if (!consignmentNumber) {
      return res.status(400).json({
        success: false,
        message: 'Consignment number is required'
      });
    }

    let parcel = await ParcelService.getParcelByConsignmentNumber(consignmentNumber);

    // Fallback for manual bookings that are not yet in arrival scan collection
    if (!parcel) {
      const manual = await ManualBooking.findOne({
        consignmentNo: consignmentNumber.toUpperCase().trim()
      }).lean();

      if (manual) {
        parcel = {
          _id: manual._id,
          consignmentNumber: manual.consignmentNo,
          rider: manual.assignedTo || null,
          status: manual.status || 'pending',
          destinationCity: manual.destinationCity,
          originCity: manual.originCity,
          consigneeName: manual.consigneeName,
          consigneeMobile: manual.consigneeMobile,
          codAmount: manual.codAmount || 0,
          remarks: manual.remarks || '',
          source: 'manual_booking',
          createdAt: manual.createdAt,
          updatedAt: manual.updatedAt
        };
      }
    }

    if (!parcel) {
      return res.status(404).json({
        success: false,
        message: `Parcel with consignment number ${consignmentNumber} not found`
      });
    }

    res.status(200).json({
      success: true,
      message: 'Parcel retrieved successfully',
      data: parcel
    });

  } catch (error) {
    console.error('Error getting parcel:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while getting parcel',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Get all riders
exports.getAllArrivalScanRider = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;
    const search = req.query.search || '';
    const status = req.query.status;

    let query = {};

    if (search) {
      query.$or = [
        { riderName: { $regex: search, $options: 'i' } },
        { riderCode: { $regex: search, $options: 'i' } },
        { soName: { $regex: search, $options: 'i' } },
        { mobileNo: { $regex: search, $options: 'i' } },
        { cnicNo: { $regex: search, $options: 'i' } },
        { address: { $regex: search, $options: 'i' } }
      ];
    }

    if (status !== undefined) {
      query.active = status === 'active';
    }

    const total = await Rider.countDocuments(query);
    const riders = await Rider.find(query)
      .skip(startIndex)
      .limit(limit)
      .sort({ createdAt: -1 });

    const totalPages = Math.ceil(total / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    res.status(200).json({
      success: true,
      message: 'Riders retrieved successfully',
      count: riders.length,
      total,
      pagination: {
        page,
        limit,
        totalPages,
        hasNextPage,
        hasPrevPage,
        nextPage: hasNextPage ? page + 1 : null,
        prevPage: hasPrevPage ? page - 1 : null
      },
      data: riders
    });

  } catch (error) {
    console.error('Error getting riders:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while getting riders',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};