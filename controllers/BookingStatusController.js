const BookingStatus = require('../models/bookingStatus');
const ManualBooking = require('../models/ManualBooking');
const DeliverySheetPhaseI = require('../models/DeliverySheetPhaseI');

// Get all bookings
exports.getAllBookings = async (req, res) => {
    try {
        const { page = 1, limit = 10 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const riderScope = req.userType === 'rider';
        let baseQuery = {};
        if (riderScope) {
            // Get both active and recent delivery sheets for the rider
            const deliverySheets = await DeliverySheetPhaseI.find({ 
                riderId: req.user.id,
                status: { $in: ['active', 'delivered', 'completed'] }
            }).sort({ createdAt: -1 }).limit(5); // Get last 5 sheets
            
            const assignedConsignments = deliverySheets.reduce((acc, sheet) => {
                return acc.concat(sheet.consignmentNumbers);
            }, []);
            
            if (assignedConsignments.length === 0) {
                return res.status(200).json({
                    success: true,
                    message: 'Bookings retrieved successfully',
                    data: {
                        bookings: [],
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
            baseQuery.consignmentNumber = { $in: assignedConsignments };
        }

        // Get bookings from both BookingStatus and ManualBooking models
        const [bookingStatusData, manualBookingData] = await Promise.all([
            BookingStatus.find(baseQuery)
                .sort({ bookingDate: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            ManualBooking.find({})
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
        ]);

        // Get total counts from both models
        const [bookingStatusCount, manualBookingCount] = await Promise.all([
            BookingStatus.countDocuments(baseQuery),
            ManualBooking.countDocuments({})
        ]);

        // Normalize manual bookings to match BookingStatus format
        const normalizedManualBookings = manualBookingData.map(booking => ({
            _id: booking._id,
            consignmentNumber: booking.consignmentNo,
            consigneeName: booking.consigneeName,
            consigneeAddress: booking.consigneeAddress,
            consigneeMobile: booking.consigneeMobile,
            pieces: booking.pieces,
            weight: booking.weight,
            codAmount: booking.codAmount,
            destinationCity: booking.destinationCity,
            accountNo: 'MANUAL',
            agentName: booking.createdBy || 'Manual Entry',
            status: booking.status,
            bookingDate: booking.date || booking.createdAt,
            createdAt: booking.createdAt,
            updatedAt: booking.updatedAt,
            remarks: booking.remarks || 'Manual Booking',
            deliveryDate: booking.updatedAt,
            id: booking._id,
            source: 'manual_booking',
            serviceType: booking.serviceType,
            originCity: booking.originCity,
            productDetail: booking.productDetail
        }));

        // Combine both booking types
        const allBookings = [...bookingStatusData, ...normalizedManualBookings];
        
        // Sort combined results by date
        allBookings.sort((a, b) => new Date(b.bookingDate || b.createdAt) - new Date(a.bookingDate || a.createdAt));
        
        // Apply pagination to combined results
        const paginatedBookings = allBookings.slice(0, parseInt(limit));

        // Get delivery sheet information for each booking
        const bookingsWithDeliveryInfo = await Promise.all(
            paginatedBookings.map(async (booking) => {
                const deliverySheet = await DeliverySheetPhaseI.findOne({
                    consignmentNumbers: booking.consignmentNumber
                }).populate('rider', 'riderName riderCode mobileNo');

                const bookingObj = booking.toObject ? booking.toObject() : booking;
                
                if (deliverySheet) {
                    bookingObj.deliverySheet = {
                        _id: deliverySheet._id,
                        riderId: deliverySheet.riderId,
                        riderName: deliverySheet.riderName,
                        riderCode: deliverySheet.riderCode,
                        status: deliverySheet.status,
                        createdAt: deliverySheet.createdAt,
                        completedAt: deliverySheet.completedAt,
                        rider: deliverySheet.rider
                    };
                } else {
                    bookingObj.deliverySheet = null;
                }

                return bookingObj;
            })
        );

        const totalCount = bookingStatusCount + manualBookingCount;

        res.status(200).json({
            success: true,
            message: 'All bookings retrieved successfully',
            data: {
                bookings: bookingsWithDeliveryInfo,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / parseInt(limit)),
                    totalCount,
                    hasNextPage: parseInt(page) < Math.ceil(totalCount / parseInt(limit)),
                    hasPreviousPage: parseInt(page) > 1,
                    limit: parseInt(limit)
                }
            }
        });

    } catch (error) {
        console.error('Error getting all bookings:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while retrieving bookings',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Search bookings with filters
exports.searchBookings = async (req, res) => {
    try {
        const {
            destinationCity,
            accountNo,
            agentName,
            consignmentNumber,
            dateFrom,
            dateTo,
            page = 1,
            limit = 10
        } = req.query;

        // Build BookingStatus query
        const query = {};
        let riderAssigned = [];
        if (req.userType === 'rider') {
            // Get both active and recent delivery sheets for the rider
            const deliverySheets = await DeliverySheetPhaseI.find({ 
                riderId: req.user.id,
                status: { $in: ['active', 'delivered', 'completed'] }
            }).sort({ createdAt: -1 }).limit(5);
            
            riderAssigned = deliverySheets.reduce((acc, sheet) => {
                return acc.concat(sheet.consignmentNumbers);
            }, []);
            
            if (riderAssigned.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: 'No bookings found with the specified criteria',
                    data: {
                        bookings: [],
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
            query.consignmentNumber = { $in: riderAssigned };
        }

        if (destinationCity) query.destinationCity = { $regex: destinationCity.trim(), $options: 'i' };
        if (accountNo) query.accountNo = { $regex: accountNo.trim(), $options: 'i' };
        if (agentName) query.agentName = { $regex: agentName.trim(), $options: 'i' };

        let manualQuery = {};
        if (req.userType === 'rider') {
            manualQuery.consignmentNo = { $in: riderAssigned };
        }
        if (destinationCity) manualQuery.destinationCity = { $regex: destinationCity.trim(), $options: 'i' };
        if (consignmentNumber) {
            const cn = consignmentNumber.toUpperCase().trim();
            // Restrict to rider assignment if applicable
            if (req.userType === 'rider' && riderAssigned.length && !riderAssigned.includes(cn)) {
                return res.status(404).json({
                    success: false,
                    message: 'No bookings found with the specified criteria',
                    data: {
                        bookings: [],
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
            query.consignmentNumber = cn;
            manualQuery.consignmentNo = cn;
        }
        // Date filters apply to bookingDate (BookingStatus) and date (ManualBooking)
        let dateFilter = null;
        if (dateFrom || dateTo) {
            dateFilter = { $gte: dateFrom ? new Date(dateFrom) : undefined, $lt: undefined };
            if (dateTo) {
                const endDate = new Date(dateTo);
                endDate.setDate(endDate.getDate() + 1);
                dateFilter.$lt = endDate;
            }
            if (dateFilter.$gte) query.bookingDate = { ...(query.bookingDate || {}), $gte: dateFilter.$gte };
            if (dateFilter.$lt) query.bookingDate = { ...(query.bookingDate || {}), $lt: dateFilter.$lt };
            // Apply to ManualBooking 'date' field as well
            if (dateFilter.$gte) manualQuery.date = { ...(manualQuery.date || {}), $gte: dateFilter.$gte };
            if (dateFilter.$lt) manualQuery.date = { ...(manualQuery.date || {}), $lt: dateFilter.$lt };
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [bsDocs, mbDocs, bsCount, mbCount] = await Promise.all([
            BookingStatus.find(query).sort({ bookingDate: -1 }),
            ManualBooking.find(manualQuery).sort({ date: -1 }),
            BookingStatus.countDocuments(query),
            ManualBooking.countDocuments(manualQuery)
        ]);

        // Normalize manual bookings
        const normalizedManualBookings = mbDocs.map(booking => ({
            _id: booking._id,
            consignmentNumber: booking.consignmentNo,
            consigneeName: booking.consigneeName,
            consigneeAddress: booking.consigneeAddress,
            consigneeMobile: booking.consigneeMobile,
            pieces: booking.pieces,
            weight: booking.weight,
            codAmount: booking.codAmount,
            destinationCity: booking.destinationCity,
            accountNo: 'MANUAL',
            agentName: booking.createdBy || 'Manual Entry',
            status: booking.status,
            bookingDate: booking.date || booking.createdAt,
            createdAt: booking.createdAt,
            updatedAt: booking.updatedAt,
            remarks: booking.remarks || 'Manual Booking',
            deliveryDate: booking.updatedAt,
            id: booking._id,
            source: 'manual_booking',
            serviceType: booking.serviceType,
            originCity: booking.originCity,
            productDetail: booking.productDetail
        }));

        // Combine and paginate in-memory (consistent with getAllBookings)
        const combined = [...bsDocs, ...normalizedManualBookings];
        combined.sort((a, b) => new Date(b.bookingDate || b.createdAt) - new Date(a.bookingDate || a.createdAt));
        const paginated = combined.slice(skip, skip + parseInt(limit));

        // Attach delivery info
        const withDelivery = await Promise.all(
            paginated.map(async (booking) => {
                const deliverySheet = await DeliverySheetPhaseI.findOne({
                    consignmentNumbers: booking.consignmentNumber
                }).populate('rider', 'riderName riderCode mobileNo');
                const bookingObj = booking.toObject ? booking.toObject() : booking;
                bookingObj.deliverySheet = deliverySheet ? {
                    _id: deliverySheet._id,
                    riderId: deliverySheet.riderId,
                    riderName: deliverySheet.riderName,
                    riderCode: deliverySheet.riderCode,
                    status: deliverySheet.status,
                    createdAt: deliverySheet.createdAt,
                    completedAt: deliverySheet.completedAt,
                    rider: deliverySheet.rider
                } : null;
                return bookingObj;
            })
        );

        const totalCount = bsCount + mbCount;
        if (withDelivery.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No bookings found with the specified criteria',
                data: {
                    bookings: [],
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
            message: 'Bookings retrieved successfully',
            data: {
                bookings: withDelivery,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalCount / parseInt(limit)),
                    totalCount,
                    hasNextPage: parseInt(page) < Math.ceil(totalCount / parseInt(limit)),
                    hasPreviousPage: parseInt(page) > 1,
                    limit: parseInt(limit)
                }
            },
            searchCriteria: {
                destinationCity: destinationCity || null,
                accountNo: accountNo || null,
                agentName: agentName || null,
                consignmentNumber: consignmentNumber || null,
                dateFrom: dateFrom || null,
                dateTo: dateTo || null
            }
        });

    } catch (error) {
        console.error('Error searching bookings:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while searching bookings',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get booking by consignment number
exports.getBookingByConsignmentNumber = async (req, res) => {
    try {
        const { consignmentNumber } = req.params;

        if (req.userType === 'rider') {
            // Check if rider has access to this consignment in any of their recent delivery sheets
            const deliverySheets = await DeliverySheetPhaseI.find({ 
                riderId: req.user.id,
                status: { $in: ['active', 'delivered', 'completed'] },
                consignmentNumbers: consignmentNumber.toUpperCase()
            }).limit(1);
            
            if (deliverySheets.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: `No booking found with consignment number: ${consignmentNumber}`
                });
            }
        }

        let booking = await BookingStatus.findOne({
            consignmentNumber: consignmentNumber.toUpperCase()
        });

        let isManual = false;
        if (!booking) {
            const manual = await ManualBooking.findOne({ consignmentNo: consignmentNumber.toUpperCase() });
            if (!manual) {
                return res.status(404).json({
                    success: false,
                    message: `No booking found with consignment number: ${consignmentNumber}`
                });
            }
            // Normalize manual booking
            booking = {
                _id: manual._id,
                consignmentNumber: manual.consignmentNo,
                consigneeName: manual.consigneeName,
                consigneeAddress: manual.consigneeAddress,
                consigneeMobile: manual.consigneeMobile,
                pieces: manual.pieces,
                weight: manual.weight,
                codAmount: manual.codAmount,
                destinationCity: manual.destinationCity,
                accountNo: 'MANUAL',
                agentName: manual.createdBy || 'Manual Entry',
                status: manual.status,
                bookingDate: manual.date || manual.createdAt,
                createdAt: manual.createdAt,
                updatedAt: manual.updatedAt,
                remarks: manual.remarks || 'Manual Booking',
                deliveryDate: manual.updatedAt,
                id: manual._id,
                source: 'manual_booking',
                serviceType: manual.serviceType,
                originCity: manual.originCity,
                productDetail: manual.productDetail,
                toObject: function () { return this; }
            };
            isManual = true;
        }

        // Get delivery sheet information for this booking
        const deliverySheet = await DeliverySheetPhaseI.findOne({
            consignmentNumbers: booking.consignmentNumber
        }).populate('rider', 'riderName riderCode mobileNo');

        const bookingObj = booking.toObject ? booking.toObject() : booking;
        
        if (deliverySheet) {
            bookingObj.deliverySheet = {
                _id: deliverySheet._id,
                riderId: deliverySheet.riderId,
                riderName: deliverySheet.riderName,
                riderCode: deliverySheet.riderCode,
                status: deliverySheet.status,
                createdAt: deliverySheet.createdAt,
                completedAt: deliverySheet.completedAt,
                rider: deliverySheet.rider
            };
        } else {
            bookingObj.deliverySheet = null;
        }

        res.status(200).json({
            success: true,
            message: 'Booking retrieved successfully',
            data: bookingObj
        });

    } catch (error) {
        console.error('Error getting booking:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while retrieving booking',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Update booking status
exports.updateBookingStatus = async (req, res) => {
    try {
        const { consignmentNumber } = req.params;
        const { status, remarks } = req.body;

        if (!status) {
            return res.status(400).json({
                success: false,
                message: 'Status is required for update'
            });
        }

        const updateFields = { status };

        if (remarks) updateFields.remarks = remarks;
        if (status === 'delivered') updateFields.deliveryDate = new Date();

        if (req.userType === 'rider') {
            // Check if rider has access to this consignment in any of their recent delivery sheets
            const deliverySheets = await DeliverySheetPhaseI.find({ 
                riderId: req.user.id,
                status: { $in: ['active', 'delivered', 'completed'] },
                consignmentNumbers: consignmentNumber.toUpperCase()
            }).limit(1);
            
            if (deliverySheets.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: `No booking found with consignment number: ${consignmentNumber}`
                });
            }
        }

        // Try primary BookingStatus first
        let booking = await BookingStatus.findOneAndUpdate(
            { consignmentNumber: consignmentNumber.toUpperCase() },
            {
                $set: updateFields,
                $push: {
                    statusHistory: {
                        status,
                        timestamp: new Date(),
                        remarks: remarks || undefined,
                        updatedBy: req.user?.id || 'system'
                    }
                }
            },
            { new: true }
        );

        // If not found, attempt ManualBooking
        let manualUpdated = null;
        if (!booking) {
            manualUpdated = await ManualBooking.findOneAndUpdate(
                { consignmentNo: consignmentNumber.toUpperCase() },
                {
                    $set: { status: status.toLowerCase() },
                    $push: {
                        statusHistory: {
                            status: status.toLowerCase(),
                            timestamp: new Date(),
                            remarks: remarks || undefined,
                            updatedBy: req.user?.id || 'system'
                        }
                    }
                },
                { new: true }
            );
        }

        if (!booking && !manualUpdated) {
            return res.status(404).json({
                success: false,
                message: `No booking found with consignment number: ${consignmentNumber}`
            });
        }

        try {
            if (status === 'delivered') {
                await DeliverySheetPhaseI.findOneAndUpdate(
                    { consignmentNumbers: consignmentNumber.toUpperCase() },
                    { status: 'delivered' }
                );
            }
        } catch (deliverySheetError) {
            console.error("Error updating delivery sheet status:", deliverySheetError);
        }

        res.status(200).json({
            success: true,
            message: 'Booking status updated successfully',
            data: booking || {
                _id: manualUpdated._id,
                consignmentNumber: manualUpdated.consignmentNo,
                status: manualUpdated.status,
                remarks: manualUpdated.remarks,
                updatedAt: manualUpdated.updatedAt
            }
        });

    } catch (error) {
        console.error('Error updating booking status:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while updating booking status',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Create a new booking
exports.createBooking = async (req, res) => {
    try {
        const bookingData = req.body;

        if (bookingData.consignmentNumber) {
            bookingData.consignmentNumber = bookingData.consignmentNumber.toUpperCase();
        }

        if (req.userType === 'customer' && req.customer) {
            const customer = req.customer;
            if (!bookingData.accountNo) bookingData.accountNo = customer.accountNo;
            if (!bookingData.agentName) bookingData.agentName = customer.username || customer.brandName || 'Customer';
        }

        const criticalFlags = [];
        const moderateFlags = [];

        if (bookingData.consignmentNumber) {
            const existing = await BookingStatus.findOne({ consignmentNumber: bookingData.consignmentNumber });
            if (existing) {
                criticalFlags.push('duplicate_cn');
            }
        } else {
            criticalFlags.push('duplicate_cn');
        }
        if (!bookingData.destinationCity) criticalFlags.push('missing_destination_city');
        if (!bookingData.accountNo) criticalFlags.push('missing_customer');
        if (bookingData.serviceType !== undefined && !bookingData.serviceType) criticalFlags.push('missing_service_type');
        if (bookingData.codAmount !== undefined && (bookingData.codAmount === 0 || bookingData.codAmount === null)) criticalFlags.push('missing_cod_amount');
        if ((bookingData.weight !== undefined && Number(bookingData.weight) <= 0) ||
            (bookingData.pieces !== undefined && Number(bookingData.pieces) <= 0)) {
            criticalFlags.push('invalid_weight_or_pieces');
        }
        if (bookingData.remarks && /(test|demo|trial)/i.test(String(bookingData.remarks))) {
            moderateFlags.push('test_booking_keyword');
        }
        if (bookingData.codAmount !== undefined && Number(bookingData.codAmount) < 1 && Number(bookingData.weight) > 10) {
            moderateFlags.push('low_cod_high_weight');
        }

        if (criticalFlags.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Booking validation failed',
                flags: {
                    critical: criticalFlags,
                    moderate: moderateFlags
                }
            });
        }

        const booking = new BookingStatus(bookingData);
        await booking.save();

        res.status(201).json({
            success: true,
            message: 'Booking created successfully',
            data: booking,
            flags: {
                critical: criticalFlags,
                moderate: moderateFlags
            }
        });

    } catch (error) {
        console.error('Error creating booking:', error);

        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: 'A booking with this consignment number already exists',
                error: 'Duplicate consignment number'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Internal server error while creating booking',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};