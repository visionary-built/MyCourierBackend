const Parcel = require('../models/arrivalScan');

class ParcelService {
  
  // Search parcels with filters
  static async searchParcels(searchCriteria, page = 1, limit = 10) {
    const { rider, consignmentNumber, status } = searchCriteria;
    let query = {};
    
    if (consignmentNumber) {
      query.consignmentNumber = consignmentNumber.toUpperCase().trim();
    }
    
    if (rider) {
      query.rider = { $regex: rider.trim(), $options: 'i' };
    }
    
    if (status) {
      query.status = status;
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const parcels = await Parcel.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    
    const totalCount = await Parcel.countDocuments(query);
    
    return {
      parcels,
      totalCount,
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalCount / parseInt(limit)),
      hasNextPage: parseInt(page) < Math.ceil(totalCount / parseInt(limit)),
      hasPreviousPage: parseInt(page) > 1,
      limit: parseInt(limit)
    };
  }
  
  // Get rider statistics
  static async getRiderStats(riderName) {
    const stats = await Parcel.aggregate([
      {
        $match: {
          rider: { $regex: riderName.trim(), $options: 'i' }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      },
      {
        $group: {
          _id: null,
          statusCounts: {
            $push: {
              status: '$_id',
              count: '$count',
              totalAmount: '$totalAmount'
            }
          },
          totalParcels: { $sum: '$count' },
          grandTotalAmount: { $sum: '$totalAmount' }
        }
      }
    ]);
    
    return stats.length > 0 ? stats[0] : {
      statusCounts: [],
      totalParcels: 0,
      grandTotalAmount: 0
    };
  }
  
  // Get parcel by consignment number
  static async getParcelByConsignmentNumber(consignmentNumber) {
    return await Parcel.findOne({ 
      consignmentNumber: consignmentNumber.toUpperCase() 
    });
  }
  
  // Update parcel status
  static async updateParcelStatus(consignmentNumber, updateData) {
    const { status, remarks, arrivalDate } = updateData;
    
    const updateFields = { status };
    
    if (remarks) updateFields.remarks = remarks;
    if (arrivalDate) updateFields.arrivalDate = new Date(arrivalDate);
    if (status === 'delivered') updateFields.deliveryDate = new Date();
    
    return await Parcel.findOneAndUpdate(
      { consignmentNumber: consignmentNumber.toUpperCase() },
      updateFields,
      { new: true, runValidators: true }
    );
  }
  
  // Get all riders
  static async getAllRider() {
    const riders = await Parcel.distinct('rider');
    return riders.sort();
  }
  
  // Create new parcel
  static async createParcel(parcelData) {
    const parcel = new Parcel(parcelData);
    return await parcel.save();
  }
  
  // Get parcels by status
  static async getParcelsByStatus(status, page = 1, limit = 10) {
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const parcels = await Parcel.find({ status })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    
    const totalCount = await Parcel.countDocuments({ status });
    
    return {
      parcels,
      totalCount,
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalCount / parseInt(limit)),
      hasNextPage: parseInt(page) < Math.ceil(totalCount / parseInt(limit)),
      hasPreviousPage: parseInt(page) > 1,
      limit: parseInt(limit)
    };
  }
  
  // Get parcels by rider
  static async getParcelsByRider(rider, page = 1, limit = 10) {
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const parcels = await Parcel.find({ 
      rider: { $regex: rider.trim(), $options: 'i' } 
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    
    const totalCount = await Parcel.countDocuments({ 
      rider: { $regex: rider.trim(), $options: 'i' } 
    });
    
    return {
      parcels,
      totalCount,
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalCount / parseInt(limit)),
      hasNextPage: parseInt(page) < Math.ceil(totalCount / parseInt(limit)),
      hasPreviousPage: parseInt(page) > 1,
      limit: parseInt(limit)
    };
  }
}

module.exports = ParcelService; 