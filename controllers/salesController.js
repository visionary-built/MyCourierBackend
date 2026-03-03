const BookingStatus = require('../models/bookingStatus');
const ManualBooking = require('../models/ManualBooking');
const Customer = require('../models/Customer');
const Rider = require('../models/Rider');
const PDFDocument = require('pdfkit');


async function buildSalesAggregates({ dateFrom, dateTo }) {
  const dateQuery = {};
  const hasDateFilter = [dateFrom, dateTo].some(v => v != null && String(v).trim() !== '');

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

  // Total bookings & COD/non-COD from ManualBooking (includes deliveryCharges)
  const manualFilter = {
    ...(Object.keys(dateQuery).length > 0 && { date: dateQuery }),
    status: { $nin: ['cancelled'] }
  };

  const [manualBookings, bookingStatuses] = await Promise.all([
    ManualBooking.find(manualFilter).lean(),
    BookingStatus.find({
      ...(Object.keys(dateQuery).length > 0 && { bookingDate: dateQuery }),
      status: { $nin: ['cancelled'] }
    }).lean()
  ]);

  const totals = {
    totalBookings: manualBookings.length + bookingStatuses.length,
    cod: {
      totalCodAmount: 0,
      totalDeliveryCharges: 0,
      count: 0
    },
    nonCod: {
      totalAmount: 0,
      totalDeliveryCharges: 0,
      count: 0
    }
  };

  manualBookings.forEach(b => {
    const hasCod = (b.codAmount || 0) > 0;
    if (hasCod) {
      totals.cod.totalCodAmount += b.codAmount || 0;
      totals.cod.totalDeliveryCharges += b.deliveryCharges || 0;
      totals.cod.count += 1;
    } else {
      totals.nonCod.totalAmount += b.deliveryCharges || 0;
      totals.nonCod.totalDeliveryCharges += b.deliveryCharges || 0;
      totals.nonCod.count += 1;
    }
  });

  // Sales by branch (use Customer.city via accountNo / customerId when possible, else originCity)
  const customers = await Customer.find({}).select('accountNo city username brandName').lean();
  const customerByAccountNo = new Map();
  customers.forEach(c => {
    customerByAccountNo.set(String(c.accountNo), c);
  });

  const branchSales = {};
  const employeeSales = {};

  const recordSale = ({ branchKey, employeeKey, amount }) => {
    if (branchKey) {
      if (!branchSales[branchKey]) {
        branchSales[branchKey] = { totalAmount: 0, totalBookings: 0 };
      }
      branchSales[branchKey].totalAmount += amount;
      branchSales[branchKey].totalBookings += 1;
    }
    if (employeeKey) {
      if (!employeeSales[employeeKey]) {
        employeeSales[employeeKey] = { totalAmount: 0, totalBookings: 0 };
      }
      employeeSales[employeeKey].totalAmount += amount;
      employeeSales[employeeKey].totalBookings += 1;
    }
  };

  manualBookings.forEach(b => {
    let branchKey = null;
    let employeeKey = null;

    // Branch: try to infer from customer account / city
    const customer = customers.find(c =>
      String(c.accountNo) === String(b.customerId) ||
      c.username === b.customerId
    ) || customerByAccountNo.get(String(b.customerId));

    if (customer && customer.city) {
      branchKey = customer.city;
    } else if (b.originCity) {
      branchKey = b.originCity;
    }

    // Employee: for now, treat createdBy/remarks as the source
    if (b.createdBy) {
      employeeKey = b.createdBy;
    }

    const saleAmount = (b.codAmount || 0) > 0 ? (b.codAmount || 0) : (b.deliveryCharges || 0);
    recordSale({ branchKey, employeeKey, amount: saleAmount });
  });

  return {
    totals,
    branchSales,
    employeeSales,
    hasDateFilter
  };
}

/**
 * GET /admin/sales/summary
 * SuperAdmin-only high-level sales dashboard:
 * - total bookings
 * - sales by branch
 * - sales by employee
 * - COD vs Non-COD breakdown
 */
exports.getSalesSummary = async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;

    const { totals, branchSales, employeeSales, hasDateFilter } = await buildSalesAggregates({ dateFrom, dateTo });

    res.status(200).json({
      success: true,
      message: 'Sales summary retrieved successfully',
      data: {
        dateRange: {
          from: dateFrom && String(dateFrom).trim() ? dateFrom : null,
          to: dateTo && String(dateTo).trim() ? dateTo : null
        },
        dateFilterApplied: hasDateFilter,
        totals,
        branchSales,
        employeeSales
      }
    });
  } catch (error) {
    console.error('Error getting sales summary:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while getting sales summary',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * GET /admin/sales/report
 * Detailed sales report list (for table view)
 */
exports.getSalesReport = async (req, res) => {
  try {
    const {
      dateFrom,
      dateTo,
      page = 1,
      limit = 50
    } = req.query;

    const dateQuery = {};
    const hasDateFilter = [dateFrom, dateTo].some(v => v != null && String(v).trim() !== '');
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

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const [total, bookings] = await Promise.all([
      ManualBooking.countDocuments(filter),
      ManualBooking.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10))
        .lean()
    ]);

    const report = bookings.map(b => {
      const isCod = (b.codAmount || 0) > 0;
      const saleAmount = isCod ? (b.codAmount || 0) : (b.deliveryCharges || 0);
      return {
        consignmentNo: b.consignmentNo,
        date: b.date,
        originCity: b.originCity,
        destinationCity: b.destinationCity,
        serviceType: b.serviceType,
        codAmount: b.codAmount || 0,
        deliveryCharges: b.deliveryCharges || 0,
        isCod,
        saleAmount,
        status: b.status,
        createdBy: b.createdBy
      };
    });

    res.status(200).json({
      success: true,
      message: 'Sales report retrieved successfully',
      data: {
        report,
        pagination: {
          currentPage: parseInt(page, 10),
          totalPages: Math.ceil(total / parseInt(limit, 10)),
          totalItems: total,
          itemsPerPage: parseInt(limit, 10)
        },
        filters: {
          dateFrom: dateFrom && String(dateFrom).trim() ? dateFrom : null,
          dateTo: dateTo && String(dateTo).trim() ? dateTo : null,
          dateFilterApplied: hasDateFilter
        }
      }
    });
  } catch (error) {
    console.error('Error getting sales report:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while getting sales report',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * GET /admin/sales/export
 * Export sales report to CSV (Excel-friendly)
 * Optional: format=pdf to generate a basic PDF summary
 */
exports.exportSalesReport = async (req, res) => {
  try {
    const { dateFrom, dateTo, format = 'csv' } = req.query;

    const dateQuery = {};
    const hasDateFilter = [dateFrom, dateTo].some(v => v != null && String(v).trim() !== '');
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

    const bookings = await ManualBooking.find(filter).sort({ createdAt: -1 }).lean();

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=sales-report-${new Date().toISOString().split('T')[0]}.csv`
      );

      const header = [
        'Consignment No',
        'Date',
        'Origin City',
        'Destination City',
        'Service Type',
        'COD Amount',
        'Delivery Charges',
        'Is COD',
        'Sale Amount',
        'Status',
        'Created By'
      ].join(',');

      const rows = bookings.map(b => {
        const isCod = (b.codAmount || 0) > 0;
        const saleAmount = isCod ? (b.codAmount || 0) : (b.deliveryCharges || 0);
        return [
          b.consignmentNo,
          b.date ? new Date(b.date).toISOString() : '',
          b.originCity,
          b.destinationCity,
          b.serviceType,
          b.codAmount || 0,
          b.deliveryCharges || 0,
          isCod ? 'Yes' : 'No',
          saleAmount,
          b.status,
          b.createdBy
        ].join(',');
      });

      res.send(header + '\n' + rows.join('\n'));
      return;
    }

    if (format === 'pdf') {
      const { totals } = await buildSalesAggregates({ dateFrom, dateTo });

      const doc = new PDFDocument({ margin: 50 });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=sales-summary-${new Date().toISOString().split('T')[0]}.pdf`
      );
      doc.pipe(res);

      doc.fontSize(18).text('Sales Report Summary', { align: 'center' });
      doc.moveDown();
      doc.fontSize(10).text(`Date Range: ${dateFrom && String(dateFrom).trim() ? dateFrom : 'All time'} to ${dateTo && String(dateTo).trim() ? dateTo : 'All time'}`);
      doc.moveDown();

      doc.fontSize(12).text('Totals:');
      doc.fontSize(10);
      doc.text(`Total Bookings: ${totals.totalBookings}`);
      doc.text(`COD - Bookings: ${totals.cod.count}, COD Amount: ${totals.cod.totalCodAmount}, Delivery Charges: ${totals.cod.totalDeliveryCharges}`);
      doc.text(`Non-COD - Bookings: ${totals.nonCod.count}, Amount: ${totals.nonCod.totalAmount}, Delivery Charges: ${totals.nonCod.totalDeliveryCharges}`);

      doc.moveDown(2);
      doc.fontSize(8).text('Generated by Tezlift Sales Module', { align: 'center' });
      doc.end();
      return;
    }

    res.status(400).json({
      success: false,
      message: 'Unsupported export format. Use csv or pdf.'
    });
  } catch (error) {
    console.error('Error exporting sales report:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error while exporting sales report',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

