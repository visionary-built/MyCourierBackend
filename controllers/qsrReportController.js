const dotenv = require('dotenv');
dotenv.config();
const BookingStatus = require('../models/bookingStatus');
const ManualBooking = require('../models/ManualBooking');
const DeliverySheetPhaseI = require('../models/DeliverySheetPhaseI');
const ReturnSheet = require('../models/ReturnSheet');
const Rider = require('../models/Rider');
const Customer = require('../models/Customer');


// Internal: build report data (pure function)
async function buildQSRReportData({ destinationCity, dateFrom, dateTo, status, page = 1, limit = 20 }) {
    const baseQuery = {};
    const dateQuery = {};

    if (destinationCity) {
        baseQuery.destinationCity = { $regex: destinationCity, $options: 'i' };
    }

    if (status && status !== 'all') {
        baseQuery.status = status;
    }

    if (dateFrom || dateTo) {
        if (dateFrom) {
            dateQuery.$gte = new Date(dateFrom);
        }
        if (dateTo) {
            const endDate = new Date(dateTo);
            endDate.setDate(endDate.getDate() + 1);
            dateQuery.$lt = endDate;
        }
    }

    const [bookingStatuses, manualBookings, deliverySheets, returnSheets] = await Promise.all([
        BookingStatus.find({
            ...baseQuery,
            ...(Object.keys(dateQuery).length > 0 && { bookingDate: dateQuery })
        })
        .lean(),

        ManualBooking.find({
            ...baseQuery,
            ...(Object.keys(dateQuery).length > 0 && { date: dateQuery })
        })
        .lean(),

        DeliverySheetPhaseI.find({
            ...(Object.keys(dateQuery).length > 0 && { createdAt: dateQuery })
        })
        .populate('riderId', 'riderName riderCode')
        .lean(),

        ReturnSheet.find({
            ...(Object.keys(dateQuery).length > 0 && { createdAt: dateQuery })
        })
        .populate('riderId', 'riderName riderCode')
        .lean()
    ]);

    const combinedData = [];

    bookingStatuses.forEach(booking => {
        combinedData.push({
            accountNo: booking.accountNo || 'N/A',
            consignmentNo: booking.consignmentNumber,
            userName: booking.agentName || 'N/A',
            bookingDate: booking.bookingDate,
            consigneeName: booking.consigneeName || 'N/A',
            consigneeAddress: booking.consigneeAddress || 'N/A',
            refNo: booking.referenceNo || '',
            destinationCity: booking.destinationCity || 'N/A',
            originCity: booking.originCity || 'N/A',
            fragile: booking.fragile ? 'Yes' : 'No',
            pieces: booking.pieces || 1,
            weight: booking.weight || 'N/A',
            codAmount: booking.codAmount || 0,
            status: booking.status || 'pending',
            code: booking.riderId?.riderCode || '',
            riderName: booking.riderId?.riderName || 'N/A',
            invoice: `INV${booking.consignmentNumber?.slice(-8) || 'N/A'}`,
            source: 'booking_status',
            deliveryDate: booking.deliveryDate,
            remarks: booking.remarks
        });
    });

    manualBookings.forEach(booking => {
        combinedData.push({
            accountNo: booking.customerId?.accountNo || 'N/A',
            consignmentNo: booking.consignmentNo,
            userName: booking.customerId?.username || 'N/A',
            bookingDate: booking.date,
            consigneeName: booking.consigneeName || 'N/A',
            consigneeAddress: booking.consigneeAddress || 'N/A',
            refNo: booking.customerReferenceNo || '',
            destinationCity: booking.destinationCity || 'N/A',
            originCity: booking.originCity || 'N/A',
            fragile: booking.fragile ? 'Yes' : 'No',
            pieces: booking.pieces || 1,
            weight: booking.weight || 'N/A',
            codAmount: booking.codAmount || 0,
            status: booking.status || 'pending',
            code: '',
            riderName: 'N/A',
            invoice: `INV${booking.consignmentNo?.slice(-8) || 'N/A'}`,
            source: 'manual_booking',
            deliveryDate: booking.deliveryDate,
            remarks: booking.remarks
        });
    });

    deliverySheets.forEach(sheet => {
        sheet.consignmentNumbers.forEach((consignmentNumber) => {
            combinedData.push({
                accountNo: 'N/A',
                consignmentNo: consignmentNumber,
                userName: 'N/A',
                bookingDate: sheet.createdAt,
                consigneeName: 'N/A',
                consigneeAddress: 'N/A',
                refNo: '',
                destinationCity: sheet.destinationCity || 'N/A',
                originCity: sheet.originCity || 'N/A',
                fragile: 'N/A',
                pieces: sheet.pieces || 1,
                weight: sheet.weight || 'N/A',
                codAmount: sheet.codAmount || 0,
                status: sheet.status || 'in-transit',
                code: sheet.riderId?.riderCode || '',
                riderName: sheet.riderId?.riderName || 'N/A',
                invoice: `INV${consignmentNumber?.slice(-8) || 'N/A'}`,
                source: 'delivery_sheet',
                deliveryDate: sheet.deliveryDate,
                remarks: sheet.remarks
            });
        });
    });

    returnSheets.forEach(sheet => {
        sheet.consignmentNumbers.forEach((consignmentNumber) => {
            combinedData.push({
                accountNo: 'N/A',
                consignmentNo: consignmentNumber,
                userName: 'N/A',
                bookingDate: sheet.createdAt,
                consigneeName: 'N/A',
                consigneeAddress: 'N/A',
                refNo: '',
                destinationCity: 'N/A',
                originCity: 'N/A',
                fragile: 'N/A',
                pieces: 1,
                weight: 'N/A',
                codAmount: 0,
                status: 'returned',
                code: sheet.riderId?.riderCode || '',
                riderName: sheet.riderId?.riderName || 'N/A',
                invoice: `INV${consignmentNumber?.slice(-8) || 'N/A'}`,
                source: 'return_sheet',
                deliveryDate: null,
                remarks: sheet.remarks
            });
        });
    });

    let filteredData = combinedData;
    if (status && status !== 'all') {
        filteredData = combinedData.filter(item => 
            item.status.toLowerCase() === status.toLowerCase()
        );
    }

    filteredData.sort((a, b) => new Date(b.bookingDate) - new Date(a.bookingDate));

    const totalItems = filteredData.length;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const paginatedData = filteredData.slice(skip, skip + parseInt(limit));
    const startSr = skip + 1;
    const paginatedWithSr = paginatedData.map((item, idx) => ({ ...item, srNo: startSr + idx }));

    const summary = {
        total: totalItems,
        byStatus: {},
        byDestinationCity: {},
        bySource: {}
    };

    filteredData.forEach(item => {
        summary.byStatus[item.status] = (summary.byStatus[item.status] || 0) + 1;
        summary.byDestinationCity[item.destinationCity] = (summary.byDestinationCity[item.destinationCity] || 0) + 1;
        summary.bySource[item.source] = (summary.bySource[item.source] || 0) + 1;
    });

    return {
        report: paginatedWithSr,
        summary,
        pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(totalItems / parseInt(limit)),
            totalItems,
            itemsPerPage: parseInt(limit)
        },
        filters: {
            destinationCity: destinationCity || null,
            dateFrom: dateFrom || null,
            dateTo: dateTo || null,
            status: status || null
        }
    };
}

// Get QSR Report with filters
exports.getQSRReport = async (req, res) => {
    try {
        const data = await buildQSRReportData(req.query || {});
        res.status(200).json({
            success: true,
            message: 'QSR Report generated successfully',
            data
        });
    } catch (error) {
        console.error('Error generating QSR Report:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while generating QSR Report',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get QSR Report by specific consignment number
exports.getQSRByConsignment = async (req, res) => {
    try {
        const { consignmentNumber } = req.params;

        if (!consignmentNumber) {
            return res.status(400).json({
                success: false,
                message: 'Consignment number is required'
            });
        }

        const cn = consignmentNumber.toUpperCase();

        const [bookingStatus, manualBooking, deliverySheet, returnSheet] = await Promise.all([
            BookingStatus.findOne({ consignmentNumber: cn }).lean(),
            ManualBooking.findOne({ consignmentNo: cn }).lean(),
            DeliverySheetPhaseI.findOne({ consignmentNumbers: cn }).populate('riderId', 'riderName riderCode').lean(),
            ReturnSheet.findOne({ consignmentNumbers: cn }).populate('riderId', 'riderName riderCode').lean()
        ]);

        let reportData = null;
        let source = '';

        if (bookingStatus) {
            reportData = {
                srNo: 1,
                accountNo: bookingStatus.accountNo || 'N/A',
                consignmentNo: bookingStatus.consignmentNumber,
                userName: bookingStatus.agentName || 'N/A',
                bookingDate: bookingStatus.bookingDate,
                consigneeName: bookingStatus.consigneeName || 'N/A',
                consigneeAddress: bookingStatus.consigneeAddress || 'N/A',
                refNo: bookingStatus.referenceNo || '',
                destinationCity: bookingStatus.destinationCity || 'N/A',
                originCity: bookingStatus.originCity || 'N/A',
                fragile: bookingStatus.fragile ? 'Yes' : 'No',
                pieces: bookingStatus.pieces || 1,
                weight: bookingStatus.weight || 'N/A',
                codAmount: bookingStatus.codAmount || 0,
                status: bookingStatus.status || 'pending',
                code: bookingStatus.riderId?.riderCode || '',
                riderName: bookingStatus.riderId?.riderName || 'N/A',
                invoice: `INV${bookingStatus.consignmentNumber?.slice(-8) || 'N/A'}`,
                source: 'booking_status',
                deliveryDate: bookingStatus.deliveryDate,
                remarks: bookingStatus.remarks
            };
            source = 'Booking Status';
        } else if (manualBooking) {
            reportData = {
                srNo: 1,
                accountNo: manualBooking.customerId?.accountNo || 'N/A',
                consignmentNo: manualBooking.consignmentNo,
                userName: manualBooking.customerId?.username || 'N/A',
                bookingDate: manualBooking.date,
                consigneeName: manualBooking.consigneeName || 'N/A',
                consigneeAddress: manualBooking.consigneeAddress || 'N/A',
                refNo: manualBooking.customerReferenceNo || '',
                destinationCity: manualBooking.destinationCity || 'N/A',
                originCity: manualBooking.originCity || 'N/A',
                fragile: manualBooking.fragile ? 'Yes' : 'No',
                pieces: manualBooking.pieces || 1,
                weight: manualBooking.weight || 'N/A',
                codAmount: manualBooking.codAmount || 0,
                status: manualBooking.status || 'pending',
                code: '',
                riderName: 'N/A',
                invoice: `INV${manualBooking.consignmentNo?.slice(-8) || 'N/A'}`,
                source: 'manual_booking',
                deliveryDate: manualBooking.deliveryDate,
                remarks: manualBooking.remarks
            };
            source = 'Manual Booking';
        } else if (deliverySheet) {
            reportData = {
                srNo: 1,
                accountNo: 'N/A',
                consignmentNo: cn,
                userName: 'N/A',
                bookingDate: deliverySheet.createdAt,
                consigneeName: 'N/A',
                consigneeAddress: 'N/A',
                refNo: '',
                destinationCity: deliverySheet.destinationCity || 'N/A',
                originCity: deliverySheet.originCity || 'N/A',
                fragile: 'N/A',
                pieces: deliverySheet.pieces || 1,
                weight: deliverySheet.weight || 'N/A',
                codAmount: deliverySheet.codAmount || 0,
                status: deliverySheet.status || 'in-transit',
                code: deliverySheet.riderId?.riderCode || '',
                riderName: deliverySheet.riderId?.riderName || 'N/A',
                invoice: `INV${cn?.slice(-8) || 'N/A'}`,
                source: 'delivery_sheet',
                deliveryDate: deliverySheet.deliveryDate,
                remarks: deliverySheet.remarks
            };
            source = 'Delivery Sheet';
        } else if (returnSheet) {
            reportData = {
                srNo: 1,
                accountNo: 'N/A',
                consignmentNo: cn,
                userName: 'N/A',
                bookingDate: returnSheet.createdAt,
                consigneeName: 'N/A',
                consigneeAddress: 'N/A',
                refNo: '',
                destinationCity: 'N/A',
                originCity: 'N/A',
                fragile: 'N/A',
                pieces: 1,
                weight: 'N/A',
                codAmount: 0,
                status: 'returned',
                code: returnSheet.riderId?.riderCode || '',
                riderName: returnSheet.riderId?.riderName || 'N/A',
                invoice: `INV${cn?.slice(-8) || 'N/A'}`,
                source: 'return_sheet',
                deliveryDate: null,
                remarks: returnSheet.remarks
            };
            source = 'Return Sheet';
        }

        if (!reportData) {
            return res.status(404).json({
                success: false,
                message: `No consignment found with number: ${consignmentNumber}`
            });
        }

        res.status(200).json({
            success: true,
            message: `QSR Report for consignment ${consignmentNumber} retrieved successfully`,
            data: {
                report: reportData,
                source,
                consignmentNumber: cn
            }
        });

    } catch (error) {
        console.error('Error getting QSR by consignment:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while getting QSR by consignment',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};


// Get QSR Report Summary (for dashboard)
exports.getQSRSummary = async (req, res) => {
    try {
        const { dateFrom, dateTo } = req.query;

        const dateQuery = {};
        if (dateFrom || dateTo) {
            if (dateFrom) {
                dateQuery.$gte = new Date(dateFrom);
            }
            if (dateTo) {
                const endDate = new Date(dateTo);
                endDate.setDate(endDate.getDate() + 1);
                dateQuery.$lt = endDate;
            }
        }

        const [totalBookings, totalDeliveries, totalReturns, totalPending] = await Promise.all([
            BookingStatus.countDocuments({
                ...(Object.keys(dateQuery).length > 0 && { bookingDate: dateQuery })
            }),
            BookingStatus.countDocuments({
                status: 'delivered',
                ...(Object.keys(dateQuery).length > 0 && { deliveryDate: dateQuery })
            }),
            ReturnSheet.countDocuments({
                ...(Object.keys(dateQuery).length > 0 && { createdAt: dateQuery })
            }),
            BookingStatus.countDocuments({
                status: 'pending',
                ...(Object.keys(dateQuery).length > 0 && { bookingDate: dateQuery })
            })
        ]);

        const topDestinations = await BookingStatus.aggregate([
            ...(Object.keys(dateQuery).length > 0 ? [{ $match: { bookingDate: dateQuery } }] : []),
            { $group: { _id: '$destinationCity', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 }
        ]);

        const topRiders = await DeliverySheetPhaseI.aggregate([
            ...(Object.keys(dateQuery).length > 0 ? [{ $match: { createdAt: dateQuery } }] : []),
            { $group: { _id: '$riderId', riderName: { $first: '$riderName' }, count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 }
        ]);

        res.status(200).json({
            success: true,
            message: 'QSR Summary retrieved successfully',
            data: {
                summary: {
                    totalBookings,
                    totalDeliveries,
                    totalReturns,
                    totalPending,
                    deliveryRate: totalBookings > 0 ? ((totalDeliveries / totalBookings) * 100).toFixed(2) : 0
                },
                topDestinations,
                topRiders,
                dateRange: {
                    from: dateFrom || null,
                    to: dateTo || null
                }
            }
        });

    } catch (error) {
        console.error('Error getting QSR Summary:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while getting QSR Summary',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Export QSR Report to CSV/Excel format
exports.exportQSRReport = async (req, res) => {
    try {
        const { destinationCity, dateFrom, dateTo, status, format = 'csv' } = req.query;

        const reportData = await buildQSRReportData({ destinationCity, dateFrom, dateTo, status, page: 1, limit: 10000 });

        if (format === 'csv') {
            // Set headers for CSV download
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=qsr-report-${new Date().toISOString().split('T')[0]}.csv`);

            const csvData = reportData.report.map(item => [
                item.srNo,
                item.accountNo,
                item.consignmentNo,
                item.userName,
                item.bookingDate,
                item.consigneeName,
                item.consigneeAddress,
                item.refNo,
                item.destinationCity,
                item.originCity,
                item.fragile,
                item.pieces,
                item.weight,
                item.codAmount,
                item.status,
                item.code,
                item.riderName,
                item.invoice
            ].join(','));

            const csvHeader = [
                'Sr. #',
                'Account No',
                'Consignment No',
                'User Name',
                'Booking Date',
                'Consignee Name',
                'Consignee Address',
                'Ref.#',
                'Destination City/Country',
                'Origin City',
                'Fragile',
                'Pieces',
                'Weight',
                'COD Amount',
                'Status',
                'Code',
                'Rider Name',
                'Invoice'
            ].join(',');

            res.send(csvHeader + '\n' + csvData.join('\n'));
        } else {
            res.status(400).json({
                success: false,
                message: 'Unsupported export format. Use CSV.'
            });
        }

    } catch (error) {
        console.error('Error exporting QSR Report:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while exporting QSR Report',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

