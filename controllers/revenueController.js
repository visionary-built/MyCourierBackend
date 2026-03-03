const ManualBooking = require('../models/ManualBooking');
const Customer = require('../models/Customer');
const Expense = require('../models/Expense');

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

  const filter = {
    ...(Object.keys(dateQuery).length > 0 && { date: dateQuery }),
    status: { $nin: ['cancelled'] }
  };

  return { filter, hasDateFilter };
}

function resolveClientLabel(booking, customersById) {
  const rawId = booking.customerId ? String(booking.customerId) : 'unknown';
  const customer =
    customersById.accountNo.get(rawId) ||
    customersById.username.get(rawId) ||
    null;

  if (customer) {
    return {
      clientKey: String(customer.accountNo || customer._id),
      name: customer.username || customer.brandName || customer.accountNo || 'Client',
      accountNo: customer.accountNo || null
    };
  }

  return {
    clientKey: rawId,
    name: rawId,
    accountNo: null
  };
}

exports.getRevenueSummary = async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    const { filter, hasDateFilter } = buildDateFilter(dateFrom, dateTo);

    const [bookings, expenses] = await Promise.all([
      ManualBooking.find(filter).lean(),
      Expense.find(filter).lean()
    ]);

    const totals = {
      totalShipments: bookings.length,
      totalRevenue: 0,
      totalCodAmount: 0,
      totalExpenses: 0,
      netRevenue: 0
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

    expenses.forEach((e) => {
      totals.totalExpenses += e.amount || 0;
    });

    totals.netRevenue = totals.totalRevenue - totals.totalExpenses;

    res.status(200).json({
      success: true,
      message: 'Revenue summary retrieved successfully',
      data: {
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
    console.error('Error getting revenue summary:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while getting revenue summary',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getClientRevenue = async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    const { filter, hasDateFilter } = buildDateFilter(dateFrom, dateTo);

    const [bookings, customers] = await Promise.all([
      ManualBooking.find(filter).lean(),
      Customer.find({})
        .select('accountNo username brandName')
        .lean()
    ]);

    const customersById = {
      accountNo: new Map(),
      username: new Map()
    };

    customers.forEach((c) => {
      if (c.accountNo) {
        customersById.accountNo.set(String(c.accountNo), c);
      }
      if (c.username) {
        customersById.username.set(String(c.username), c);
      }
    });

    const clientMap = new Map();

    bookings.forEach((b) => {
      const label = resolveClientLabel(b, customersById);
      const key = label.clientKey;

      if (!clientMap.has(key)) {
        clientMap.set(key, {
          clientKey: key,
          name: label.name,
          accountNo: label.accountNo,
          totalShipments: 0,
          totalRevenue: 0,
          totalCodAmount: 0
        });
      }

      const entry = clientMap.get(key);
      const codAmount = b.codAmount || 0;
      const charges = b.deliveryCharges || 0;

      entry.totalShipments += 1;
      entry.totalRevenue += charges;
      entry.totalCodAmount += codAmount;
    });

    const clients = Array.from(clientMap.values()).sort(
      (a, b) => b.totalRevenue - a.totalRevenue
    );

    res.status(200).json({
      success: true,
      message: 'Client-wise revenue retrieved successfully',
      data: {
        dateRange: {
          from: dateFrom && String(dateFrom).trim() ? dateFrom : null,
          to: dateTo && String(dateTo).trim() ? dateTo : null
        },
        dateFilterApplied: hasDateFilter,
        totalClients: clients.length,
        clients
      }
    });
  } catch (error) {
    console.error('Error getting client-wise revenue:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while getting client-wise revenue',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

exports.getRevenueTimeSeries = async (req, res) => {
  try {
    const {
      dateFrom,
      dateTo,
      granularity = 'daily'
    } = req.query;

    const { filter, hasDateFilter } = buildDateFilter(dateFrom, dateTo);

    const bookings = await ManualBooking.find(filter).lean();

    const bucketMap = new Map();

    bookings.forEach((b) => {
      const date = b.date ? new Date(b.date) : null;
      if (!date) return;

      let key;
      if (granularity === 'monthly') {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      } else if (granularity === 'weekly') {
        const temp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = temp.getUTCDay() || 7;
        temp.setUTCDate(temp.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(temp.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil(((temp - yearStart) / 86400000 + 1) / 7);
        key = `${temp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
      } else {
        key = date.toISOString().slice(0, 10);
      }

      if (!bucketMap.has(key)) {
        bucketMap.set(key, {
          bucket: key,
          totalRevenue: 0,
          totalCodAmount: 0,
          shipments: 0
        });
      }

      const bucket = bucketMap.get(key);
      const codAmount = b.codAmount || 0;
      const charges = b.deliveryCharges || 0;

      bucket.totalRevenue += charges;
      bucket.totalCodAmount += codAmount;
      bucket.shipments += 1;
    });

    const series = Array.from(bucketMap.values()).sort((a, b) =>
      a.bucket.localeCompare(b.bucket)
    );

    res.status(200).json({
      success: true,
      message: 'Revenue time series retrieved successfully',
      data: {
        dateRange: {
          from: dateFrom && String(dateFrom).trim() ? dateFrom : null,
          to: dateTo && String(dateTo).trim() ? dateTo : null
        },
        dateFilterApplied: hasDateFilter,
        granularity,
        points: series
      }
    });
  } catch (error) {
    console.error('Error getting revenue time series:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while getting revenue time series',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

