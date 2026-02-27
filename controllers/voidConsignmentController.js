const BookingStatus = require('../models/bookingStatus');
const ManualBooking = require('../models/ManualBooking');
const mongoose = require('mongoose');

const autoVoidCriticalConsignments = async (req, res, next) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        // Find all consignments with critical validation issues that aren't already voided
        const consignments = await BookingStatus.find({
            status: { $ne: 'cancelled' },
            $or: [
                { 'validationFlags.criticalFlags': { $exists: true, $not: {$size: 0} } },
                { 'validationFlags': { $exists: false } } // Also check consignments without validation flags
            ]
        }).session(session);

        const voidedConsignments = [];
        
        // Process each consignment with critical issues
        for (const consignment of consignments) {
            // Run validation if not already done
            if (!consignment.validationFlags?.criticalFlags) {
                consignment.validationFlags = validateConsignment(consignment);
            }
            
            // Only auto-void if there are critical flags
            if (consignment.validationFlags.criticalFlags.length > 0) {
                const update = {
                    status: 'cancelled',
                    $push: {
                        statusHistory: {
                            status: 'cancelled',
                            timestamp: new Date(),
                            reason: 'Auto-voided due to critical validation issues',
                            remarks: `Automatically voided due to: ${consignment.validationFlags.criticalFlags.join(', ')}`,
                            updatedBy: 'system'
                        }
                    },
                    validationFlags: consignment.validationFlags // Save validation flags
                };

                await BookingStatus.findByIdAndUpdate(
                    consignment._id,
                    update,
                    { session }
                );

                // Also update ManualBooking if exists
                try {
                    await ManualBooking.findOneAndUpdate(
                        { consignmentNo: consignment.consignmentNumber },
                        {
                            status: 'cancelled',
                            $push: {
                                statusHistory: {
                                    status: 'cancelled',
                                    timestamp: new Date(),
                                    reason: 'Auto-voided due to critical validation issues',
                                    updatedBy: 'system'
                                }
                            }
                        },
                        { session }
                    );
                } catch (manualBookingError) {
                    console.error('Error updating manual booking during auto-void:', manualBookingError);
                    // Continue even if manual booking update fails
                }

                voidedConsignments.push({
                    consignmentNumber: consignment.consignmentNumber,
                    reason: 'Auto-voided due to critical validation issues',
                    flags: consignment.validationFlags.criticalFlags
                });
            }
        }

        await session.commitTransaction();
        session.endSession();
        
        if (voidedConsignments.length > 0) {
            console.log(`Auto-voided ${voidedConsignments.length} consignments with critical issues`);
        }
        
        next();
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error('Error in auto-void middleware:', error);
        next(error);
    }
};

const validateConsignment = (consignment) => {
    const criticalFlags = [];
    const moderateFlags = [];
    
    if (consignment.validationFlags) {
        return consignment.validationFlags;
    }

    if (!consignment.accountNo || !consignment.agentName) {
        criticalFlags.push('missing_customer');
    }

    if (consignment.consigneeMobile && !/^\d{11}$/.test(String(consignment.consigneeMobile))) {
        criticalFlags.push('invalid_mobile');
    }

    if (!consignment.destinationCity) {
        criticalFlags.push('missing_destination_city');
    }

    if (consignment.codAmount !== undefined && consignment.codAmount <= 0) {
        criticalFlags.push('missing_cod_amount');
    }

    if ((consignment.weight !== undefined && consignment.weight <= 0) || 
        (consignment.pieces !== undefined && consignment.pieces <= 0)) {
        criticalFlags.push('invalid_weight_or_pieces');
    }

    if (!consignment.serviceType) {
        criticalFlags.push('missing_service_type');
    }

    const remarks = String(consignment.remarks || '').toLowerCase();
    if (['test', 'demo', 'trial'].some(word => remarks.includes(word))) {
        moderateFlags.push('test_booking_keyword');
    }

    if (consignment.codAmount < 1 && consignment.weight > 10) {
        moderateFlags.push('low_cod_high_weight');
    }

    if (consignment.originCity && consignment.originCity !== consignment.branchCity) {
        moderateFlags.push('mismatch_origin_city');
    }

    if (consignment.destinationCity && !consignment.serviceableCities?.includes(consignment.destinationCity)) {
        moderateFlags.push('out_of_coverage_area');
    }

    return { criticalFlags, moderateFlags };
};

exports.getVoidConsignments = [
    autoVoidCriticalConsignments,
    async (req, res) => {
    try {
        const { 
            destinationCity, 
            originCity, 
            consignmentFrom, 
            consignmentTo, 
            dateFrom, 
            dateTo,
            page = 1,
            limit = 20
        } = req.query;

        const query = { status: 'cancelled' };
        
        if (destinationCity) {
            query.destinationCity = { $regex: destinationCity, $options: 'i' };
        }
        
        if (originCity) {
            query.originCity = { $regex: originCity, $options: 'i' };
        }
        
        if (consignmentFrom && consignmentTo) {
            query.consignmentNumber = { 
                $gte: consignmentFrom.toUpperCase(), 
                $lte: consignmentTo.toUpperCase() 
            };
        } else if (consignmentFrom) {
            query.consignmentNumber = { $regex: `^${consignmentFrom}`, $options: 'i' };
        }
        
        if (dateFrom || dateTo) {
            query.updatedAt = {};
            if (dateFrom) query.updatedAt.$gte = new Date(dateFrom);
            if (dateTo) {
                const endDate = new Date(dateTo);
                endDate.setDate(endDate.getDate() + 1);
                query.updatedAt.$lt = endDate;
            }
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const total = await BookingStatus.countDocuments(query);
        const consignments = await BookingStatus.find(query)
            .sort({ updatedAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const processedConsignments = consignments.map(consignment => {
            const flags = validateConsignment(consignment.toObject());
            return {
                ...consignment.toObject(),
                validationFlags: flags
            };
        });

        const invalidConsignments = processedConsignments.filter(
            c => c.validationFlags.criticalFlags.length > 0
        );
        
        const flaggedConsignments = processedConsignments.filter(
            c => c.validationFlags.criticalFlags.length === 0 && 
                 c.validationFlags.moderateFlags.length > 0
        );
        
        const validConsignments = processedConsignments.filter(
            c => c.validationFlags.criticalFlags.length === 0 && 
                 c.validationFlags.moderateFlags.length === 0
        );

        res.status(200).json({
            success: true,
            data: {
                consignments: processedConsignments,
                summary: {
                    total,
                    invalid: invalidConsignments.length,
                    flagged: flaggedConsignments.length,
                    valid: validConsignments.length
                },
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / parseInt(limit)),
                    totalItems: total,
                    itemsPerPage: parseInt(limit)
                }
            }
        });

    } catch (error) {
        console.error('Error fetching void consignments:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}];


exports.voidConsignment = [
    autoVoidCriticalConsignments,
    async (req, res) => {
    try {
        const { consignmentNumber, reason, remarks } = req.body;

        if (!consignmentNumber) {
            return res.status(400).json({
                success: false,
                message: 'Consignment number is required'
            });
        }

        const consignment = await BookingStatus.findOneAndUpdate(
            { 
                consignmentNumber: consignmentNumber.toUpperCase(),
                status: { $ne: 'cancelled' } 
            },
            { 
                status: 'cancelled',
                $push: { 
                    statusHistory: { 
                        status: 'cancelled',
                        timestamp: new Date(),
                        reason,
                        remarks,
                        updatedBy: req.user?.id || 'system'
                    } 
                }
            },
            { new: true }
        );

        if (!consignment) {
            return res.status(404).json({
                success: false,
                message: 'Consignment not found or already cancelled'
            });
        }

        try {
            await ManualBooking.findOneAndUpdate(
                { consignmentNo: consignmentNumber.toUpperCase() },
                { 
                    status: 'cancelled',
                    $push: { 
                        statusHistory: {
                            status: 'cancelled',
                            timestamp: new Date(),
                            reason,
                            updatedBy: req.user?.id || 'system'
                        }
                    }
                }
            );
        } catch (manualBookingError) {
            console.error('Error updating manual booking:', manualBookingError);
        }

        const flags = validateConsignment(consignment);
        const response = {
            ...consignment.toObject(),
            validationFlags: flags
        };

        res.status(200).json({
            success: true,
            message: 'Consignment voided successfully',
            data: response
        });

    } catch (error) {
        console.error('Error voiding consignment:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}];
