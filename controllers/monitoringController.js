const SalesTarget = require('../models/SalesTarget');
const ManualBooking = require('../models/ManualBooking');
const Rider = require('../models/Rider');
const DeliverySheetPhaseI = require('../models/DeliverySheetPhaseI');
const ReturnSheet = require('../models/ReturnSheet');
const BookingStatus = require('../models/bookingStatus');

// --- 1. SET & GET TARGETS ---

// POST /monitoring/targets
exports.setSalesTarget = async (req, res) => {
    try {
        const { entityType, entityId, period, targetBookings, targetRevenue } = req.body;
        
        if (!entityType || !entityId || !period) {
            return res.status(400).json({ success: false, message: 'entityType, entityId, and period are required' });
        }

        const target = await SalesTarget.findOneAndUpdate(
            { entityType, entityId, period },
            { targetBookings: targetBookings || 0, targetRevenue: targetRevenue || 0 },
            { new: true, upsert: true }
        );

        res.status(200).json({ success: true, message: 'Target set successfully', data: target });
    } catch (error) {
        console.error('Error setting sales target:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// GET /monitoring/targets
exports.getSalesTargets = async (req, res) => {
    try {
        const { period, entityType } = req.query;
        let query = {};
        if (period) query.period = period;
        if (entityType) query.entityType = entityType;

        const targets = await SalesTarget.find(query).sort({ period: -1 });
        res.status(200).json({ success: true, message: 'Targets fetched successfully', data: targets });
    } catch (error) {
        console.error('Error getting sales targets:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// GET /monitoring/target-vs-achieved
exports.getTargetVsAchieved = async (req, res) => {
    try {
        let { period, entityType } = req.query; // period format YYYY-MM
        
        if (!period) {
            // default to current month if missing
            const now = new Date();
            period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        }
        
        let targetQuery = { period };
        if (entityType) targetQuery.entityType = entityType;

        const targets = await SalesTarget.find(targetQuery);

        // Calculate achieved by passing date filter to manual booking
        const [yearStr, monthStr] = period.split('-');
        const year = parseInt(yearStr, 10);
        const month = parseInt(monthStr, 10);
        
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 1);

        const bookings = await ManualBooking.find({
            date: { $gte: startDate, $lt: endDate },
            status: { $nin: ['cancelled'] }
        });

        // Tallying the achieved data
        const achievedMap = {}; // key format -> `${entityType}_${entityId}`

        bookings.forEach(b => {
            const branch = b.originCity || 'overall'; // Simplify branch mapping based on originCity
            const employee = b.createdBy || 'overall';
            const revenue = (b.codAmount || 0) > 0 ? (b.codAmount || 0) : (b.deliveryCharges || 0);

            // Accumulate branch achieved
            const branchKey = `branch_${branch}`;
            if (!achievedMap[branchKey]) achievedMap[branchKey] = { bookings: 0, revenue: 0 };
            achievedMap[branchKey].bookings += 1;
            achievedMap[branchKey].revenue += revenue;

            // Accumulate employee achieved
            const employeeKey = `employee_${employee}`;
            if (!achievedMap[employeeKey]) achievedMap[employeeKey] = { bookings: 0, revenue: 0 };
            achievedMap[employeeKey].bookings += 1;
            achievedMap[employeeKey].revenue += revenue;

            // Accumulate overall achieved
            const overallKey = `overall_overall`;
            if (!achievedMap[overallKey]) achievedMap[overallKey] = { bookings: 0, revenue: 0 };
            achievedMap[overallKey].bookings += 1;
            achievedMap[overallKey].revenue += revenue;
        });

        const report = targets.map(t => {
            const achieved = achievedMap[`${t.entityType}_${t.entityId}`] || { bookings: 0, revenue: 0 };
            return {
                _id: t._id,
                entityType: t.entityType,
                entityId: t.entityId,
                period: t.period,
                targetBookings: t.targetBookings,
                achievedBookings: achieved.bookings,
                bookingProgressPercent: t.targetBookings > 0 ? parseFloat(((achieved.bookings / t.targetBookings) * 100).toFixed(2)) : 0,
                targetRevenue: t.targetRevenue,
                achievedRevenue: achieved.revenue,
                revenueProgressPercent: t.targetRevenue > 0 ? parseFloat(((achieved.revenue / t.targetRevenue) * 100).toFixed(2)) : 0
            };
        });

        res.status(200).json({ 
            success: true, 
            message: 'Target vs Achieved fetched successfully', 
            data: {
                period,
                report 
            }
        });
    } catch (error) {
        console.error('Error fetching Target vs Achieved report:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// --- 2. RIDER DELIVERY PERFORMANCE ---

// GET /monitoring/rider-performance
exports.getRiderPerformance = async (req, res) => {
    try {
        const { dateFrom, dateTo, riderId } = req.query;

        const dateQuery = {};
        if (dateFrom || dateTo) {
            if (dateFrom) dateQuery.$gte = new Date(dateFrom);
            if (dateTo) {
                const end = new Date(dateTo);
                end.setDate(end.getDate() + 1);
                dateQuery.$lt = end;
            }
        }

        const matchQuery = {};
        if (Object.keys(dateQuery).length > 0) matchQuery.createdAt = dateQuery;

        // Fetch riders
        const riderFilter = riderId ? { _id: riderId } : {};
        const riders = await Rider.find(riderFilter).select('_id riderName riderCode branch');
        
        const [allDeliverySheets, allReturnSheets] = await Promise.all([
            DeliverySheetPhaseI.find(Object.keys(matchQuery).length > 0 ? matchQuery : {}).lean(),
            ReturnSheet.find(Object.keys(matchQuery).length > 0 ? matchQuery : {}).lean()
        ]);

        // We also need BookingStatus to check delivered ones
        let bookingStatusQuery = { status: 'delivered' };
        if (Object.keys(dateQuery).length > 0) bookingStatusQuery.deliveryDate = dateQuery;

        const deliveredBookings = await BookingStatus.find(bookingStatusQuery).select('riderId').lean();

        const performanceData = riders.map(rider => {
            const rIdStr = String(rider._id);
            
            // Total Dispatched (from Delivery Sheets assigned to rider)
            const riderSheets = allDeliverySheets.filter(s => String(s.riderId) === rIdStr);
            const totalAssigned = riderSheets.reduce((acc, sheet) => acc + (sheet.consignmentNumbers?.length || 0), 0);

            // Total Returned (from Return Sheets assigned to rider)
            const riderReturns = allReturnSheets.filter(s => String(s.riderId) === rIdStr);
            const totalReturned = riderReturns.reduce((acc, sheet) => acc + (sheet.consignmentNumbers?.length || 0), 0);

            // Total Delivered (from BookingStatus where status='delivered' and riderId=rider._id)
            const deliveredCount = deliveredBookings.filter(b => b.riderId && String(b.riderId) === rIdStr).length;

            let pending = totalAssigned - deliveredCount - totalReturned;
            if (pending < 0) pending = 0; // Prevent negative numbers if data out of sync

            const successRate = totalAssigned > 0 ? (deliveredCount / totalAssigned) * 100 : 0;
            const returnRate = totalAssigned > 0 ? (totalReturned / totalAssigned) * 100 : 0;

            return {
                riderId: rider._id,
                riderName: rider.riderName,
                riderCode: rider.riderCode,
                branch: rider.branch || 'Unknown',
                totalAssigned,
                totalDelivered: deliveredCount,
                totalReturned,
                totalPending: pending,
                successRate: parseFloat(successRate.toFixed(2)),
                returnRate: parseFloat(returnRate.toFixed(2))
            };
        });

        // Filter out strictly inactive/no-assignment riders unless requesting specific riderId
        const filteredData = riderId ? performanceData : performanceData.filter(d => d.totalAssigned > 0);
        
        filteredData.sort((a,b) => b.totalAssigned - a.totalAssigned);

        res.status(200).json({
            success: true,
            message: 'Rider performance fetched successfully',
            data: {
                dateRange: {
                    from: dateFrom || null,
                    to: dateTo || null
                },
                performance: filteredData
            }
        });
    } catch (error) {
        console.error('Error fetching Rider performance report:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};
