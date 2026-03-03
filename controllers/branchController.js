const Branch = require('../models/Branch');
const ManualBooking = require('../models/ManualBooking');
const BookingStatus = require('../models/bookingStatus');

function buildDateFilter(dateFrom, dateTo) {
  const dateQuery = {};
  const hasDateFilter = [dateFrom, dateTo].some(
    (v) => v != null && String(v).trim() !== ''
  );

  if (hasDateFilter) {
    if (dateFrom) {
      dateQuery.$gte = new Date(dateFrom);
    }
    if (dateTo) {
      const end = new Date(dateTo);
      end.setDate(end.getDate() + 1);
      dateQuery.$lt = end;
    }
  }

  return { dateQuery, hasDateFilter };
}

function buildCityFilter(branch) {
  // Use case-insensitive partial match so "Karachi" also matches "Karachi (21)"
  const city = branch.city || '';
  const cityRegex = new RegExp(city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  return { originCity: cityRegex };
}

exports.createBranch = async (req, res) => {
  try {
    const { name, code, city, address, managerId } = req.body;

    if (!name || !code || !city) {
      return res.status(400).json({
        success: false,
        message: 'Name, code, and city are required'
      });
    }

    const exists = await Branch.findOne({ code });
    if (exists) {
      return res.status(400).json({
        success: false,
        message: 'Branch with this code already exists'
      });
    }

    const branch = await Branch.create({
      name,
      code,
      city,
      address,
      manager: managerId || null
    });

    res.status(201).json({
      success: true,
      message: 'Branch created successfully',
      data: branch
    });
  } catch (error) {
    console.error('Error creating branch:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while creating branch',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getBranches = async (req, res) => {
  try {
    const branches = await Branch.find({})
      .populate('manager', 'fullName username email role')
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      message: 'Branches retrieved successfully',
      data: branches
    });
  } catch (error) {
    console.error('Error getting branches:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while getting branches',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.updateBranch = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, city, address, isActive, managerId } = req.body;

    const branch = await Branch.findById(id);
    if (!branch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found'
      });
    }

    if (code && code !== branch.code) {
      const exists = await Branch.findOne({ code });
      if (exists) {
        return res.status(400).json({
          success: false,
          message: 'Another branch with this code already exists'
        });
      }
    }

    if (typeof name !== 'undefined') branch.name = name;
    if (typeof code !== 'undefined') branch.code = code;
    if (typeof city !== 'undefined') branch.city = city;
    if (typeof address !== 'undefined') branch.address = address;
    if (typeof isActive !== 'undefined') branch.isActive = isActive;
    if (typeof managerId !== 'undefined') branch.manager = managerId || null;

    await branch.save();

    const populated = await Branch.findById(branch._id)
      .populate('manager', 'fullName username email role')
      .lean();

    res.status(200).json({
      success: true,
      message: 'Branch updated successfully',
      data: populated
    });
  } catch (error) {
    console.error('Error updating branch:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while updating branch',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.assignManager = async (req, res) => {
  try {
    const { id } = req.params;
    const { managerId } = req.body;

    const branch = await Branch.findById(id);
    if (!branch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found'
      });
    }

    branch.manager = managerId || null;
    await branch.save();

    const populated = await Branch.findById(branch._id)
      .populate('manager', 'fullName username email role')
      .lean();

    res.status(200).json({
      success: true,
      message: 'Branch manager assigned successfully',
      data: populated
    });
  } catch (error) {
    console.error('Error assigning branch manager:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while assigning manager',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getBranchPerformance = async (req, res) => {
  try {
    const { id } = req.params;
    const { dateFrom, dateTo } = req.query;

    const branch = await Branch.findById(id).lean();
    if (!branch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found'
      });
    }

    const { dateQuery, hasDateFilter } = buildDateFilter(dateFrom, dateTo);
    const cityFilter = buildCityFilter(branch);

    const bookingFilter = {
      ...cityFilter,
      ...(Object.keys(dateQuery).length > 0 && { date: dateQuery }),
      status: { $nin: ['cancelled'] }
    };

    const statusFilter = {
      ...cityFilter,
      ...(Object.keys(dateQuery).length > 0 && { bookingDate: dateQuery })
    };

    const [manualBookings, bookingStatuses] = await Promise.all([
      ManualBooking.find(bookingFilter).lean(),
      BookingStatus.find(statusFilter).lean()
    ]);

    const performance = {
      branchId: branch._id,
      branchName: branch.name,
      city: branch.city,
      totalShipments: manualBookings.length,
      byStatus: {
        pending: 0,
        'in-transit': 0,
        delivered: 0,
        returned: 0,
        cancelled: 0
      }
    };

    manualBookings.forEach((b) => {
      const status = b.status || 'pending';
      if (!performance.byStatus[status]) {
        performance.byStatus[status] = 0;
      }
      performance.byStatus[status] += 1;
    });

    bookingStatuses.forEach((bs) => {
      const status = bs.status || 'pending';
      if (!performance.byStatus[status]) {
        performance.byStatus[status] = 0;
      }
      performance.byStatus[status] += 1;
    });

    res.status(200).json({
      success: true,
      message: 'Branch performance retrieved successfully',
      data: {
        dateRange: {
          from: dateFrom && String(dateFrom).trim() ? dateFrom : null,
          to: dateTo && String(dateTo).trim() ? dateTo : null
        },
        dateFilterApplied: hasDateFilter,
        performance
      }
    });
  } catch (error) {
    console.error('Error getting branch performance:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while getting branch performance',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getBranchRevenue = async (req, res) => {
  try {
    const { id } = req.params;
    const { dateFrom, dateTo } = req.query;

    const branch = await Branch.findById(id).lean();
    if (!branch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found'
      });
    }

    const { dateQuery, hasDateFilter } = buildDateFilter(dateFrom, dateTo);
    const cityFilter = buildCityFilter(branch);

    const filter = {
      ...cityFilter,
      ...(Object.keys(dateQuery).length > 0 && { date: dateQuery }),
      status: { $nin: ['cancelled'] }
    };

    const bookings = await ManualBooking.find(filter).lean();

    const totals = {
      totalShipments: bookings.length,
      totalRevenue: 0,
      totalCodAmount: 0
    };

    const paymentBreakdown = {
      cod: {
        shipments: 0,
        codAmount: 0,
        revenueCharges: 0
      },
      nonCod: {
        shipments: 0,
        revenueCharges: 0
      }
    };

    bookings.forEach((b) => {
      const codAmount = b.codAmount || 0;
      const charges = b.deliveryCharges || 0;
      const isCod = codAmount > 0;

      totals.totalRevenue += charges;
      totals.totalCodAmount += codAmount;

      if (isCod) {
        paymentBreakdown.cod.shipments += 1;
        paymentBreakdown.cod.codAmount += codAmount;
        paymentBreakdown.cod.revenueCharges += charges;
      } else {
        paymentBreakdown.nonCod.shipments += 1;
        paymentBreakdown.nonCod.revenueCharges += charges;
      }
    });

    res.status(200).json({
      success: true,
      message: 'Branch revenue report retrieved successfully',
      data: {
        branch: {
          id: branch._id,
          name: branch.name,
          city: branch.city,
          code: branch.code
        },
        dateRange: {
          from: dateFrom && String(dateFrom).trim() ? dateFrom : null,
          to: dateTo && String(dateTo).trim() ? dateTo : null
        },
        dateFilterApplied: hasDateFilter,
        totals,
        paymentBreakdown
      }
    });
  } catch (error) {
    console.error('Error getting branch revenue:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while getting branch revenue',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Combined Branch Summary: performance + revenue in one payload
exports.getBranchSummary = async (req, res) => {
  try {
    const { id } = req.params;
    const { dateFrom, dateTo } = req.query;

    const branch = await Branch.findById(id).lean();
    if (!branch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found'
      });
    }

    const { dateQuery, hasDateFilter } = buildDateFilter(dateFrom, dateTo);
    const cityFilter = buildCityFilter(branch);

    const bookingFilter = {
      ...cityFilter,
      ...(Object.keys(dateQuery).length > 0 && { date: dateQuery }),
      status: { $nin: ['cancelled'] }
    };

    const statusFilter = {
      ...cityFilter,
      ...(Object.keys(dateQuery).length > 0 && { bookingDate: dateQuery })
    };

    const [manualBookings, bookingStatuses] = await Promise.all([
      ManualBooking.find(bookingFilter).lean(),
      BookingStatus.find(statusFilter).lean()
    ]);

    const performance = {
      branchId: branch._id,
      branchName: branch.name,
      city: branch.city,
      totalShipments: manualBookings.length,
      byStatus: {
        pending: 0,
        'in-transit': 0,
        delivered: 0,
        returned: 0,
        cancelled: 0
      }
    };

    manualBookings.forEach((b) => {
      const status = b.status || 'pending';
      if (!performance.byStatus[status]) {
        performance.byStatus[status] = 0;
      }
      performance.byStatus[status] += 1;
    });

    bookingStatuses.forEach((bs) => {
      const status = bs.status || 'pending';
      if (!performance.byStatus[status]) {
        performance.byStatus[status] = 0;
      }
      performance.byStatus[status] += 1;
    });

    const totals = {
      totalShipments: manualBookings.length,
      totalRevenue: 0,
      totalCodAmount: 0
    };

    const paymentBreakdown = {
      cod: {
        shipments: 0,
        codAmount: 0,
        revenueCharges: 0
      },
      nonCod: {
        shipments: 0,
        revenueCharges: 0
      }
    };

    manualBookings.forEach((b) => {
      const codAmount = b.codAmount || 0;
      const charges = b.deliveryCharges || 0;
      const isCod = codAmount > 0;

      totals.totalRevenue += charges;
      totals.totalCodAmount += codAmount;

      if (isCod) {
        paymentBreakdown.cod.shipments += 1;
        paymentBreakdown.cod.codAmount += codAmount;
        paymentBreakdown.cod.revenueCharges += charges;
      } else {
        paymentBreakdown.nonCod.shipments += 1;
        paymentBreakdown.nonCod.revenueCharges += charges;
      }
    });

    res.status(200).json({
      success: true,
      message: 'Branch summary retrieved successfully',
      data: {
        branch: {
          id: branch._id,
          name: branch.name,
          city: branch.city,
          code: branch.code
        },
        dateRange: {
          from: dateFrom && String(dateFrom).trim() ? dateFrom : null,
          to: dateTo && String(dateTo).trim() ? dateTo : null
        },
        dateFilterApplied: hasDateFilter,
        performance,
        totals,
        paymentBreakdown
      }
    });
  } catch (error) {
    console.error('Error getting branch summary:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while getting branch summary',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


