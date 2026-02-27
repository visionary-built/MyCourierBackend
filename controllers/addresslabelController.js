const BookingStatus = require('../models/bookingStatus');
const ManualBooking = require('../models/ManualBooking');
const DeliverySheetPhaseI = require('../models/DeliverySheetPhaseI');
const { validationResult } = require('express-validator');
const PDFDocument = require('pdfkit');

// Get all bookings with optional pagination and filters
exports.getAllBookings = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            status,
            destinationCity,
            originCity,
            sortBy = 'bookingDate',
            sortOrder = 'desc'
        } = req.query;

        let bookingStatusQuery = {};
        if (status) {
            bookingStatusQuery.status = status;
        }
        if (destinationCity) {
            bookingStatusQuery.destinationCity = { $regex: destinationCity, $options: 'i' };
        }
        if (originCity) {
            bookingStatusQuery.originCity = { $regex: originCity, $options: 'i' };
        }
        let DeliverySheetPhaseIQuery = {};
        if (status) {
            DeliverySheetPhaseIQuery.status = status;
        }
        if (destinationCity) {
            DeliverySheetPhaseIQuery.destinationCity = { $regex: destinationCity, $options: 'i' };
        }
        if (originCity) {
            DeliverySheetPhaseIQuery.originCity = { $regex: originCity, $options: 'i' };
        }

        let manualBookingQuery = {};
        if (status) {
            manualBookingQuery.status = status;
        }
        if (destinationCity) {
            manualBookingQuery.destinationCity = { $regex: destinationCity, $options: 'i' };
        }
        if (originCity) {
            manualBookingQuery.originCity = { $regex: originCity, $options: 'i' };
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [bookingStatuses, manualBookings, deliverySheets] = await Promise.all([
            BookingStatus.find(bookingStatusQuery)
                .select('consignmentNumber status bookingDate deliveryDate destinationCity originCity accountNo agentName senderName senderAddress senderPhone consigneeName consigneeAddress consigneeMobile pieces weight referenceNo codAmount riderId assignedTo remarks')
                .lean(),
            ManualBooking.find(manualBookingQuery)
                .select('consignmentNo status date deliveryDate destinationCity originCity senderName senderAddress senderPhone consigneeName consigneeAddress consigneeMobile pieces weight customerReferenceNo codAmount riderId assignedTo remarks')
                .lean(),
            DeliverySheetPhaseI.find(DeliverySheetPhaseIQuery)
                .populate('rider', 'riderName riderCode')
                .lean()
        ]);

        const combinedBookings = [
            ...bookingStatuses.map(booking => ({
                _id: booking._id,
                consignmentNumber: booking.consignmentNumber,
                source: 'booking_status',
                status: booking.status,
                bookingDate: booking.bookingDate,
                deliveryDate: booking.deliveryDate,
                destinationCity: booking.destinationCity,
                originCity: booking.originCity,
                accountNo: booking.accountNo,
                agentName: booking.agentName,
                consigneeName: booking.consigneeName,
                consigneeMobile: booking.consigneeMobile,
                consigneeAddress: booking.consigneeAddress,
                pieces: booking.pieces || 1,
                weight: booking.weight || 'N/A',
                codAmount: booking.codAmount || 0,
                referenceNo: booking.referenceNo,
                remarks: booking.remarks,
                sender: {
                    name: booking.senderName,
                    address: booking.senderAddress,
                    phone: booking.senderPhone
                },
                recipient: {
                    name: booking.consigneeName,
                    address: booking.consigneeAddress,
                    phone: booking.consigneeMobile,
                    mobileNo: booking.consigneeMobile
                },
                assignedTo: booking.assignedTo || booking.riderId || 'Not Assigned',
                packageInfo: {
                    pieces: booking.pieces || 1,
                    weight: booking.weight || 'N/A',
                    referenceNo: booking.referenceNo,
                    codAmount: booking.codAmount || 0,
                    assignedTo: booking.assignedTo || booking.riderId || 'Not Assigned'
                }
            })),
            ...manualBookings.map(booking => ({
                _id: booking._id,
                consignmentNumber: booking.consignmentNo,
                source: 'manual_booking',
                status: booking.status,
                bookingDate: booking.date,
                deliveryDate: booking.deliveryDate,
                destinationCity: booking.destinationCity,
                originCity: booking.originCity,
                consigneeName: booking.consigneeName,
                consigneeMobile: booking.consigneeMobile,
                consigneeAddress: booking.consigneeAddress,
                pieces: booking.pieces || 1,
                weight: booking.weight || 'N/A',
                codAmount: booking.codAmount || 0,
                referenceNo: booking.customerReferenceNo,
                remarks: booking.remarks,
                sender: {
                    name: booking.senderName,
                    address: booking.senderAddress,
                    phone: booking.senderPhone
                },
                recipient: {
                    name: booking.consigneeName,
                    address: booking.consigneeAddress,
                    phone: booking.consigneeMobile,
                    mobileNo: booking.consigneeMobile
                },
                assignedTo: booking.assignedTo || booking.riderId || 'Not Assigned',
                packageInfo: {
                    pieces: booking.pieces || 1,
                    weight: booking.weight || 'N/A',
                    referenceNo: booking.customerReferenceNo,
                    codAmount: booking.codAmount || 0,
                    assignedTo: booking.assignedTo || booking.riderId || 'Not Assigned'
                }
            })),
            ...deliverySheets.flatMap(sheet => 
                sheet.consignmentNumbers.map(consignmentNumber => ({
                    _id: sheet._id,
                    consignmentNumber: consignmentNumber,
                    source: 'delivery_sheet',
                    status: sheet.status || 'On the Way',
                    bookingDate: sheet.createdAt,
                    deliveryDate: sheet.deliveryDate,
                    destinationCity: sheet.destinationCity,
                    originCity: sheet.originCity,
                    consigneeName: sheet.consigneeName || 'N/A',
                    consigneeMobile: sheet.consigneeMobile || 'N/A',
                    consigneeAddress: sheet.consigneeAddress || 'N/A',
                    pieces: sheet.pieces || 1,
                    weight: sheet.weight || 'N/A',
                    codAmount: sheet.codAmount || 0,
                    referenceNo: sheet.referenceNo || 'N/A',
                    remarks: sheet.remarks || '',
                    rider: sheet.rider ? {
                        name: sheet.rider.riderName,
                        code: sheet.rider.riderCode,
                        id: sheet.rider._id
                    } : null,
                    assignedTo: sheet.rider ? `${sheet.rider.riderName} (${sheet.rider.riderCode})` : 'Not Assigned',
                    packageInfo: {
                        pieces: sheet.pieces || 1,
                        weight: sheet.weight || 'N/A',
                        referenceNo: sheet.referenceNo || 'N/A',
                        codAmount: sheet.codAmount || 0,
                        assignedTo: sheet.rider ? `${sheet.rider.riderName} (${sheet.rider.riderCode})` : 'Not Assigned'
                    }
                }))
            )
        ];

        const sortMultiplier = sortOrder === 'desc' ? -1 : 1;
        combinedBookings.sort((a, b) => {
            const aValue = a[sortBy] || '';
            const bValue = b[sortBy] || '';
            return (aValue > bValue ? 1 : -1) * sortMultiplier;
        });

        const totalItems = combinedBookings.length;
        const paginatedBookings = combinedBookings.slice(skip, skip + parseInt(limit));

        res.status(200).json({
            success: true,
            message: 'All bookings retrieved successfully',
            data: {
                bookings: paginatedBookings,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalItems / parseInt(limit)),
                    totalItems,
                    itemsPerPage: parseInt(limit)
                },
                filters: {
                    status: status || '',
                    destinationCity: destinationCity || '',
                    originCity: originCity || '',
                    sortBy,
                    sortOrder
                }
            }
        });

    } catch (error) {
        console.error('Error getting all bookings:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving bookings',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

exports.searchBookings = async (req, res) => {
    try {
        const {
            consignmentNumber,
            status,
            dateFrom,
            dateTo,
            destinationCity,
            originCity,
            page = 1,
            limit = 20
        } = req.query;

        const query = {};

        if (consignmentNumber) {
            query.consignmentNumber = { $regex: consignmentNumber.toUpperCase(), $options: 'i' };
        }

        if (status) {
            query.status = status;
        }

        if (dateFrom || dateTo) {
            query.bookingDate = {};
            if (dateFrom) {
                query.bookingDate.$gte = new Date(dateFrom);
            }
            if (dateTo) {
                const endDate = new Date(dateTo);
                endDate.setDate(endDate.getDate() + 1);
                query.bookingDate.$lt = endDate;
            }
        }

        if (destinationCity) {
            query.destinationCity = { $regex: destinationCity, $options: 'i' };
        }

        if (originCity) {
            query.originCity = { $regex: originCity, $options: 'i' };
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const total = await BookingStatus.countDocuments(query);

        const bookings = await BookingStatus.find(query)
            .sort({ bookingDate: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        res.status(200).json({
            success: true,
            message: 'Bookings retrieved successfully',
            data: {
                bookings,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / parseInt(limit)),
                    totalItems: total,
                    itemsPerPage: parseInt(limit)
                },
                filters: {
                    consignmentNumber: consignmentNumber || '',
                    status: status || '',
                    dateFrom: dateFrom || '',
                    dateTo: dateTo || '',
                    destinationCity: destinationCity || '',
                    originCity: originCity || ''
                }
            }
        });

    } catch (error) {
        console.error('Error searching bookings:', error);
        res.status(500).json({
            success: false,
            message: 'Error searching bookings',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get booking by consignment number
exports.getBookingByNumber = async (req, res) => {
    try {
        const { consignmentNumber } = req.params;

        if (!consignmentNumber) {
            return res.status(400).json({
                success: false,
                message: 'Consignment number is required'
            });
        }

        let booking = await BookingStatus.findOne({
            consignmentNumber: consignmentNumber.toUpperCase()
        });

        if (!booking) {
            booking = await ManualBooking.findOne({
                consignmentNo: consignmentNumber.toUpperCase()
            });

            if (!booking) {
                return res.status(404).json({
                    success: false,
                    message: `No booking found with consignment number: ${consignmentNumber}`
                });
            }
        }

        res.status(200).json({
            success: true,
            message: 'Booking retrieved successfully',
            data: booking
        });

    } catch (error) {
        console.error('Error getting booking:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving booking',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Generate address label PDF
exports.generateAddressLabel = async (req, res) => {
    try {
        const { consignmentNumber } = req.params;

        if (!consignmentNumber) {
            return res.status(400).json({
                success: false,
                message: 'Consignment number is required'
            });
        }

        let booking = await BookingStatus.findOne({
            consignmentNumber: consignmentNumber.toUpperCase()
        });

        if (!booking) {
            booking = await ManualBooking.findOne({
                consignmentNo: consignmentNumber.toUpperCase()
            });

            if (!booking) {
                return res.status(404).json({
                    success: false,
                    message: `No booking found with consignment number: ${consignmentNumber}`
                });
            }
        }

        const doc = new PDFDocument({
            size: [300, 400], 
            margin: 10
        });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=label-${consignmentNumber}.pdf`);
        doc.pipe(res);
        doc.rect(5, 5, 290, 390).stroke();
        doc.fontSize(12).text('TEZLIFT COURIER SERVICE', { align: 'center' });
        doc.fontSize(10).text('123 Shipping St, City, Country', { align: 'center' });
        doc.moveDown(0.5);
        doc.moveTo(10, 60).lineTo(290, 60).stroke();
        doc.moveDown(1);
        doc.font('Helvetica-Bold').fontSize(16).text('ADDRESS LABEL', { align: 'center' });
        doc.moveDown(0.5);
        doc.rect(50, 100, 200, 60).stroke();
        doc.font('Helvetica').fontSize(10).text('CONSIGNMENT #', 50, 170);
        doc.font('Helvetica-Bold').fontSize(16).text(booking.consignmentNumber || booking.consignmentNo, 50, 185);
        doc.moveTo(10, 220).lineTo(290, 220).stroke();
        doc.font('Helvetica-Bold').fontSize(12).text('FROM:', 15, 230);
        doc.font('Helvetica').fontSize(10)
            .text(booking.senderName || 'Sender Name', 15, 250)
            .text(booking.senderAddress || '123 Sender St, City, Country', 15, 265)
            .text(`Contact: ${booking.senderPhone || 'N/A'}`, 15, 280);
        doc.moveTo(10, 300).lineTo(290, 300).stroke();
        doc.font('Helvetica-Bold').fontSize(12).text('TO:', 15, 310);
        doc.font('Helvetica').fontSize(10)
            .text(booking.consigneeName || 'Recipient Name', 15, 330)
            .text(booking.consigneeAddress || '456 Recipient St, City, Country', 15, 345)
            .text(`Contact: ${booking.consigneeMobile || 'N/A'}`, 15, 360);
        doc.moveTo(10, 380).lineTo(290, 380).stroke();
        doc.font('Helvetica-Oblique').fontSize(8)
            .text('Thank you for choosing TEZLIFT COURIER SERVICE', { align: 'center' });
        doc.end();

    } catch (error) {
        console.error('Error generating address label:', error);
        res.status(500).json({
            success: false,
            message: 'Error generating address label',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get label data (for API usage)
exports.getLabelData = async (req, res) => {
    try {
        const { consignmentNumber } = req.params;

        if (!consignmentNumber) {
            return res.status(400).json({
                success: false,
                message: 'Consignment number is required'
            });
        }

        let booking = await BookingStatus.findOne({
            consignmentNumber: consignmentNumber.toUpperCase()
        });

        if (!booking) {
            booking = await ManualBooking.findOne({
                consignmentNo: consignmentNumber.toUpperCase()
            });

            if (!booking) {
                return res.status(404).json({
                    success: false,
                    message: `No booking found with consignment number: ${consignmentNumber}`
                });
            }
        }

        const labelData = {
            consignmentNumber: booking.consignmentNumber || booking.consignmentNo,
            sender: {
                name: booking.senderName || 'Sender Name',
                address: booking.senderAddress || '123 Sender St, City, Country',
                phone: booking.senderPhone || 'N/A'
            },
            recipient: {
                name: booking.consigneeName || 'Recipient Name',
                address: booking.consigneeAddress || '456 Recipient St, City, Country',
                phone: booking.consigneeMobile || 'N/A',
                mobileNo: booking.consigneeMobile || 'N/A'
            },
            packageInfo: {
                pieces: booking.pieces || 1,
                weight: booking.weight || 'N/A',
                codAmount: booking.codAmount || 0,
                referenceNo: booking.referenceNo || 'N/A',
                assignedTo: booking.assignedTo || booking.riderId || 'Not Assigned'
            },
            pieces: booking.pieces || 1,
            weight: booking.weight || 'N/A',
            codAmount: booking.codAmount || 0,
            referenceNo: booking.referenceNo || 'N/A',
            assignedTo: booking.assignedTo || booking.riderId || 'Not Assigned',
            timestamp: new Date().toISOString()
        };

        res.status(200).json({
            success: true,
            message: 'Label data retrieved successfully',
            data: labelData
        });

    } catch (error) {
        console.error('Error getting label data:', error);
        res.status(500).json({
            success: false,
            message: 'Error retrieving label data',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};