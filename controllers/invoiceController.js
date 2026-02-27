const BookingStatus = require('../models/bookingStatus');
const ManualBooking = require('../models/ManualBooking');
const Customer = require('../models/Customer');
const Rider = require('../models/Rider');
const DeliverySheetPhaseI = require('../models/DeliverySheetPhaseI');
const ReturnSheet = require('../models/ReturnSheet');
const ArrivalScan = require('../models/arrivalScan');
const PDFDocument = require('pdfkit');

// Generate Invoice API
exports.generateInvoice = async (req, res) => {
    try {
        const { agent, dateFrom, dateTo, format = 'pdf' } = req.query;

        if (!agent) {
            return res.status(400).json({
                success: false,
                message: 'Please select agent.'
            });
        }

        if (!dateFrom || !dateTo) {
            return res.status(400).json({
                success: false,
                message: 'Date From and Date To are required.'
            });
        }

        const startDate = new Date(dateFrom);
        const endDate = new Date(dateTo);
        endDate.setDate(endDate.getDate() + 1);

        const customer = await Customer.findOne({
            $or: [
                { accountNo: agent },
                { username: agent },
                { email: agent }
            ]
        });

        if (!customer) {
            return res.status(404).json({
                success: false,
                message: 'Agent not found.'
            });
        }

        const dateQuery = {
            $gte: startDate,
            $lt: endDate
        };

        const accountNoRegex = new RegExp(escapeRegex(String(customer.accountNo)), 'i');
        const agentName = customer.username || customer.brandName || '';
        const agentNameRegex = new RegExp(escapeRegex(String(agentName)), 'i');

        const [bookingStatuses, manualBookings] = await Promise.all([
            BookingStatus.find({
                $and: [
                    { status: { $nin: ['cancelled'] } },
                    { $or: [{ bookingDate: dateQuery }, { deliveryDate: dateQuery }] },
                    { $or: [{ accountNo: accountNoRegex }, { agentName: agentNameRegex }] }
                ]
            }).lean(),

            ManualBooking.find({
                $and: [
                    { status: { $nin: ['cancelled'] } },
                    { $or: [{ date: dateQuery }, { deliveryDate: dateQuery }] },
                    {
                        $or: [
                            { customerId: String(customer._id) },
                            { customerId: customer.accountNo },
                            { customerId: agentName }
                        ]
                    }
                ]
            }).lean()
        ]);

        const billableConsignments = [];

        bookingStatuses.forEach(booking => {
            billableConsignments.push({
                consignmentNumber: booking.consignmentNumber,
                source: 'booking_status',
                bookingDate: booking.bookingDate,
                deliveryDate: booking.deliveryDate,
                destinationCity: booking.destinationCity,
                originCity: booking.originCity,
                consigneeName: booking.consigneeName,
                consigneeAddress: booking.consigneeAddress,
                pieces: booking.pieces || 1,
                weight: booking.weight || 0,
                codAmount: booking.codAmount || 0,
                status: booking.status,
                referenceNo: booking.referenceNo,
                deliveryCharges: calculateDeliveryCharges(booking.weight || 0, booking.destinationCity),
                remarks: booking.remarks
            });
        });
        manualBookings.forEach(booking => {
            billableConsignments.push({
                consignmentNumber: booking.consignmentNo,
                source: 'manual_booking',
                bookingDate: booking.date,
                deliveryDate: booking.deliveryDate,
                destinationCity: booking.destinationCity,
                originCity: booking.originCity,
                consigneeName: booking.consigneeName,
                consigneeAddress: booking.consigneeAddress,
                pieces: booking.pieces || 1,
                weight: booking.weight || 0,
                codAmount: booking.codAmount || 0,
                status: booking.status,
                referenceNo: booking.customerReferenceNo,
                deliveryCharges: calculateDeliveryCharges(booking.weight || 0, booking.destinationCity),
                remarks: booking.remarks
            });
        });

        billableConsignments.sort((a, b) => new Date(a.bookingDate) - new Date(b.bookingDate));

        const totals = calculateInvoiceTotals(billableConsignments);

        const invoiceNumber = generateInvoiceNumber(customer.accountNo, startDate);

        const invoiceData = {
            invoiceNumber,
            agent: {
                accountNo: customer.accountNo,
                name: customer.username || customer.brandName,
                address: customer.address,
                contactNo: customer.contactNo,
                email: customer.email
            },
            dateRange: {
                from: startDate,
                to: new Date(dateTo)
            },
            generatedDate: new Date(),
            consignments: billableConsignments,
            totals,
            summary: {
                totalConsignments: billableConsignments.length,
                totalPieces: totals.totalPieces,
                totalWeight: totals.totalWeight,
                totalCodAmount: totals.totalCodAmount,
                totalDeliveryCharges: totals.totalDeliveryCharges,
                grandTotal: totals.grandTotal
            }
        };

        if (format === 'json') {
            return res.status(200).json({
                success: true,
                message: 'Invoice generated successfully',
                data: invoiceData
            });
        } else if (format === 'pdf') {
            return generatePDFInvoice(res, invoiceData);
        } else {
            return res.status(400).json({
                success: false,
                message: 'Unsupported format. Use "pdf" or "json".'
            });
        }

    } catch (error) {
        console.error('Error generating invoice:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while generating invoice',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Generate Invoice for Rider - Shows ALL consignments assigned to rider regardless of status or date
exports.generateRiderInvoice = async (req, res) => {
    try {
        const { riderId, dateFrom, dateTo, format = 'pdf' } = req.query;

        if (!riderId) {
            return res.status(400).json({
                success: false,
                message: 'Please select rider.'
            });
        }

        if (!dateFrom || !dateTo) {
            return res.status(400).json({
                success: false,
                message: 'Date From and Date To are required.'
            });
        }

        const startDate = new Date(dateFrom);
        const endDate = new Date(dateTo);
        endDate.setDate(endDate.getDate() + 1);

        const rider = await Rider.findById(riderId);
        if (!rider) {
            return res.status(404).json({
                success: false,
                message: 'Rider not found.'
            });
        }

        const [deliverySheets, returnSheets, arrivalScans] = await Promise.all([
            DeliverySheetPhaseI.find({ riderId: rider._id }).lean(),
            ReturnSheet.find({ riderId: rider._id }).lean(),
            ArrivalScan.find({ rider: { $regex: `${rider.riderCode}|${rider.riderName}`, $options: 'i' } }).lean()
        ]);

        const deliverySheetCNs = new Set();
        deliverySheets.forEach(sheet => {
            (sheet.consignmentNumbers || []).forEach(cn => deliverySheetCNs.add(String(cn).toUpperCase()));
        });

        const returnSheetCNs = new Set();
        returnSheets.forEach(sheet => {
            (sheet.consignmentNumbers || []).forEach(cn => returnSheetCNs.add(String(cn).toUpperCase()));
        });

        const arrivalScanCNs = new Set();
        arrivalScans.forEach(scan => {
            arrivalScanCNs.add(String(scan.consignmentNumber).toUpperCase());
        });

        const allAssignedCNs = new Set([
            ...deliverySheetCNs,
            ...returnSheetCNs,
            ...arrivalScanCNs
        ]);

        console.log(`Rider ${rider.riderCode} (${rider.riderName}):`);
        console.log(`- Delivery sheets found: ${deliverySheets.length}`);
        console.log(`- Return sheets found: ${returnSheets.length}`);
        console.log(`- Arrival scans found: ${arrivalScans.length}`);
        console.log(`- Total unique assigned CNs: ${allAssignedCNs.size}`);

        let allBookingStatuses = [];
        if (allAssignedCNs.size > 0) {
            allBookingStatuses = await BookingStatus.find({
                consignmentNumber: { $in: Array.from(allAssignedCNs) },
                status: { $nin: ['cancelled'] }
            }).lean();
        }

        const additionalRiderBookings = await BookingStatus.find({
            $and: [
                { status: { $nin: ['cancelled'] } },
                {
                    $or: [
                        { remarks: { $regex: `Assigned to rider: ${rider.riderName} \\(${rider.riderCode}\\)`, $options: 'i' } },
                        { remarks: { $regex: `Assigned to rider: ${rider.riderName}.*\\(${rider.riderCode}\\)`, $options: 'i' } },
                        { remarks: { $regex: `rider.*${rider.riderName}.*\\(${rider.riderCode}\\)`, $options: 'i' } },
                        { remarks: { $regex: `assigned.*${rider.riderName}.*\\(${rider.riderCode}\\)`, $options: 'i' } },
                        { remarks: { $regex: `${rider.riderName}.*\\(${rider.riderCode}\\)`, $options: 'i' } },
                        { remarks: { $regex: `\\(${rider.riderCode}\\)`, $options: 'i' } },
                        { remarks: { $regex: `${rider.riderName}.*${rider.riderCode}`, $options: 'i' } },
                        { assignedRider: rider._id },
                        { riderId: rider._id },
                        { consigneeName: { $regex: rider.riderName, $options: 'i' } },
                        { consigneeAddress: { $regex: rider.riderName, $options: 'i' } },
                        { referenceNo: { $regex: rider.riderCode, $options: 'i' } },
                        {
                            $or: [
                                { consigneeName: { $regex: `${rider.riderName}.*${rider.riderCode}`, $options: 'i' } },
                                { consigneeAddress: { $regex: `${rider.riderName}.*${rider.riderCode}`, $options: 'i' } },
                                { referenceNo: { $regex: `${rider.riderName}.*${rider.riderCode}`, $options: 'i' } }
                            ]
                        }
                    ]
                }
            ]
        }).lean();
        const manualBookings = await ManualBooking.find({
            $and: [
                { status: { $nin: ['cancelled'] } },
                {
                    $or: [
                        { remarks: { $regex: `Assigned to rider: ${rider.riderName} \\(${rider.riderCode}\\)`, $options: 'i' } },
                        { remarks: { $regex: `${rider.riderName}.*\\(${rider.riderCode}\\)`, $options: 'i' } },
                        { remarks: { $regex: `\\(${rider.riderCode}\\)`, $options: 'i' } },
                        { remarks: { $regex: `${rider.riderName}.*${rider.riderCode}`, $options: 'i' } },
                        { assignedRider: rider._id },
                        { riderId: rider._id }
                    ]
                }
            ]
        }).lean();

        const broaderRiderSearch = await BookingStatus.find({
            $and: [
                { status: { $nin: ['cancelled'] } },
                {
                    $or: [
                        { consigneeName: { $regex: rider.riderName, $options: 'i' } },
                        { consigneeAddress: { $regex: rider.riderName, $options: 'i' } },
                        { referenceNo: { $regex: rider.riderCode, $options: 'i' } },
                        { remarks: { $regex: rider.riderName, $options: 'i' } },
                        { remarks: { $regex: rider.riderCode, $options: 'i' } },
                        { remarks: { $regex: 'rider.*assigned', $options: 'i' } },
                        { remarks: { $regex: 'assigned.*rider', $options: 'i' } },
                        { remarks: { $regex: 'delivery.*rider', $options: 'i' } },
                        { remarks: { $regex: 'rider.*delivery', $options: 'i' } }
                    ]
                }
            ]
        }).lean();

        const filteredBroaderResults = broaderRiderSearch.filter(booking => {
            const hasRiderName = booking.consigneeName &&
                new RegExp(rider.riderName, 'i').test(booking.consigneeName);
            const hasRiderCode = booking.referenceNo &&
                new RegExp(rider.riderCode, 'i').test(booking.referenceNo);
            const hasRiderInRemarks = booking.remarks &&
                (new RegExp(rider.riderName, 'i').test(booking.remarks) ||
                    new RegExp(rider.riderCode, 'i').test(booking.remarks));

            return hasRiderName || hasRiderCode || hasRiderInRemarks;
        });

        const allFoundConsignments = [
            ...allBookingStatuses,
            ...additionalRiderBookings,
            ...manualBookings,
            ...filteredBroaderResults
        ];

        const uniqueConsignments = new Map();

        allFoundConsignments.forEach(booking => {
            const cn = booking.consignmentNumber || booking.consignmentNo;
            if (cn && !uniqueConsignments.has(cn)) {
                uniqueConsignments.set(cn, booking);
            }
        });

        deliverySheets.forEach(sheet => {
            (sheet.consignmentNumbers || []).forEach(cn => {
                const up = String(cn).toUpperCase();
                if (!uniqueConsignments.has(up)) {
                    uniqueConsignments.set(up, {
                        consignmentNumber: up,
                        source: 'delivery_sheet_only',
                        status: sheet.status || 'in-transit',
                        remarks: `Assigned via delivery sheet - ${sheet.remarks || ''}`,
                        pieces: sheet.count || 1,
                        weight: 0,
                        codAmount: 0,
                        destinationCity: sheet.destinationCity || 'N/A',
                        originCity: sheet.originCity || 'N/A',
                        consigneeName: 'N/A',
                        consigneeAddress: 'N/A',
                        referenceNo: sheet.referenceNo || '',
                        bookingDate: sheet.createdAt,
                        deliveryDate: sheet.completedAt || null
                    });
                }
            });
        });

        const validatedConsignments = new Map();
        for (const [cn, booking] of uniqueConsignments) {
            let isValidAssignment = false;
            let validationMethod = '';

            if (deliverySheetCNs.has(cn) || returnSheetCNs.has(cn) || arrivalScanCNs.has(cn)) {
                isValidAssignment = true;
                validationMethod = 'delivery/return sheets';
                console.log(`✓ CN ${cn}: Validated via delivery/return sheets`);
            }

            else if (booking.remarks) {
                const patterns = [
                    new RegExp(`Assigned to rider: ${rider.riderName} \\(${rider.riderCode}\\)`, 'i'),
                    new RegExp(`Assigned to rider: ${rider.riderName}.*\\(${rider.riderCode}\\)`, 'i'),
                    new RegExp(`rider.*${rider.riderName}.*\\(${rider.riderCode}\\)`, 'i'),
                    new RegExp(`${rider.riderName}.*${rider.riderCode}`, 'i'),
                    new RegExp(`\\(${rider.riderCode}\\)`, 'i'),
                    new RegExp(`${rider.riderName}.*${rider.riderCode}`, 'i')
                ];

                for (const pattern of patterns) {
                    if (pattern.test(booking.remarks)) {
                        isValidAssignment = true;
                        validationMethod = 'remarks pattern';
                        console.log(`✓ CN ${cn}: Validated via remarks pattern`);
                        break;
                    }
                }
            }

            else if (booking.assignedRider === String(rider._id) || booking.riderId === String(rider._id)) {
                isValidAssignment = true;
                validationMethod = 'direct rider assignment';
                console.log(`✓ CN ${cn}: Validated via direct rider assignment`);
            }

            else if (booking.consigneeName && new RegExp(rider.riderName, 'i').test(booking.consigneeName)) {
                isValidAssignment = true;
                validationMethod = 'consignee name match';
                console.log(`✓ CN ${cn}: Validated via consignee name match`);
            }
            else if (booking.referenceNo && new RegExp(rider.riderCode, 'i').test(booking.referenceNo)) {
                isValidAssignment = true;
                validationMethod = 'reference number match';
                console.log(`✓ CN ${cn}: Validated via reference number match`);
            }

            else if (allAssignedCNs.size === 0 && uniqueConsignments.size < 5) {
                console.log(`⚠ CN ${cn}: Including as fallback (few consignments, no clear assignments)`);
                isValidAssignment = true;
                validationMethod = 'fallback inclusion';
            }

            if (isValidAssignment) {
                validatedConsignments.set(cn, {
                    ...booking,
                    validationMethod: validationMethod
                });
            } else {
                console.log(`✗ CN ${cn}: Excluded - not properly assigned to rider ${rider.riderCode}`);
                if (booking.remarks) {
                    console.log(`  Remarks: "${booking.remarks}"`);
                }
                if (booking.consigneeName) {
                    console.log(`  Consignee: "${booking.consigneeName}"`);
                }
                if (booking.referenceNo) {
                    console.log(`  Reference: "${booking.referenceNo}"`);
                }
            }
        }

        // After collecting all validated consignments, filter to include only the allowed statuses
        const allowedStatuses = ['active', 'pending', 'in-transit', 'delivered'];
        const bookingStatuses = Array.from(validatedConsignments.values()).filter(booking => allowedStatuses.includes(booking.status));

        console.log(`- All booking statuses: ${allBookingStatuses.length}`);
        console.log(`- Additional rider bookings: ${additionalRiderBookings.length}`);
        console.log(`- Manual bookings: ${manualBookings.length}`);
        console.log(`- Broader search results: ${filteredBroaderResults.length}`);
        console.log(`- Unique consignments: ${uniqueConsignments.size}`);
        console.log(`- Validated consignments: ${validatedConsignments.size}`);
        console.log(`- All rider consignments: ${bookingStatuses.length}`);
        console.log(`- Date range: ${startDate.toISOString()} to ${endDate.toISOString()} (for reporting purposes)`);

        if (allBookingStatuses.length > 0) {
            console.log(`- Sample assigned consignments:`, allBookingStatuses.slice(0, 3).map(b => ({
                cn: b.consignmentNumber,
                status: b.status,
                remarks: b.remarks
            })));
        }

        if (additionalRiderBookings.length > 0) {
            console.log(`- Sample additional rider bookings:`, additionalRiderBookings.slice(0, 3).map(b => ({
                cn: b.consignmentNumber,
                status: b.status,
                remarks: b.remarks
            })));
        }

        if (manualBookings.length > 0) {
            console.log(`- Sample manual bookings:`, manualBookings.slice(0, 3).map(b => ({
                cn: b.consignmentNo,
                status: b.status,
                remarks: b.remarks
            })));
        }

        if (filteredBroaderResults.length > 0) {
            console.log(`- Sample broader search results:`, filteredBroaderResults.slice(0, 3).map(b => ({
                cn: b.consignmentNumber,
                status: b.status,
                remarks: b.remarks,
                consigneeName: b.consigneeName,
                referenceNo: b.referenceNo
            })));
        }

        console.log(`- All unique consignment numbers:`, Array.from(uniqueConsignments.keys()));
        console.log(`- Validated consignment numbers:`, Array.from(validatedConsignments.keys()));
        console.log(`- Delivery sheet CNs:`, Array.from(deliverySheetCNs));
        console.log(`- Return sheet CNs:`, Array.from(returnSheetCNs));
        console.log(`- Arrival scan CNs:`, Array.from(arrivalScanCNs));

        // Debug: Show which consignments were validated and why
        console.log(`\n=== VALIDATION DEBUG ===`);
        for (const [cn, booking] of uniqueConsignments) {
            const isInSheets = deliverySheetCNs.has(cn) || returnSheetCNs.has(cn) || arrivalScanCNs.has(cn);
            const hasValidRemarks = validatedConsignments.has(cn);
            console.log(`- CN: ${cn} | In Sheets: ${isInSheets} | Valid Remarks: ${hasValidRemarks} | Status: ${booking.status}`);
            if (booking.remarks) {
                console.log(`  Remarks: "${booking.remarks}"`);
            }
        }
        console.log(`=== END VALIDATION DEBUG ===\n`);

        // Show validation method summary
        console.log(`\n=== VALIDATION METHOD SUMMARY ===`);
        const validationMethods = {};
        for (const [cn, booking] of validatedConsignments) {
            const method = booking.validationMethod || 'unknown';
            validationMethods[method] = (validationMethods[method] || 0) + 1;
        }
        Object.entries(validationMethods).forEach(([method, count]) => {
            console.log(`- ${method}: ${count} consignments`);
        });
        console.log(`=== END VALIDATION METHOD SUMMARY ===\n`);

        const riderConsignments = bookingStatuses.map(booking => ({
            consignmentNumber: booking.consignmentNumber || booking.consignmentNo,
            source: booking.source || 'booking_status',
            bookingDate: booking.bookingDate || booking.date || booking.createdAt,
            deliveryDate: booking.deliveryDate || booking.completedAt,
            destinationCity: booking.destinationCity || 'N/A',
            originCity: booking.originCity || 'N/A',
            consigneeName: booking.consigneeName || 'N/A',
            consigneeAddress: booking.consigneeAddress || 'N/A',
            pieces: booking.pieces || 1,
            weight: booking.weight || 0,
            codAmount: booking.codAmount || 0,
            status: booking.status || 'in-transit',
            referenceNo: booking.referenceNo || booking.customerReferenceNo || '',
            deliveryCharges: calculateDeliveryCharges(booking.weight || 0, booking.destinationCity),
            remarks: booking.remarks || ''
        }));

        riderConsignments.sort((a, b) => {
            const dateA = a.deliveryDate || a.bookingDate;
            const dateB = b.deliveryDate || b.bookingDate;
            return new Date(dateA) - new Date(dateB);
        });

        const totals = calculateInvoiceTotals(riderConsignments);
        const invoiceNumber = generateInvoiceNumber(rider.riderCode, startDate);
        const invoiceData = {
            invoiceNumber,
            rider: {
                riderCode: rider.riderCode,
                name: rider.riderName,
                mobileNo: rider.mobileNo,
                address: rider.address
            },
            dateRange: {
                from: startDate,
                to: new Date(dateTo)
            },
            generatedDate: new Date(),
            consignments: riderConsignments,
            totals,
            summary: {
                totalDeliveries: riderConsignments.length,
                totalPieces: totals.totalPieces,
                totalWeight: totals.totalWeight,
                totalCodAmount: totals.totalCodAmount,
                totalDeliveryCharges: totals.totalDeliveryCharges,
                grandTotal: totals.grandTotal
            }
        };

        // TODO: Uncomment when Invoice model is created
        try {
            await Invoice.create({
                invoiceNumber,
                type: 'rider',
                rider: {
                    riderId: rider._id,
                    riderCode: rider.riderCode,
                    name: rider.riderName,
                    mobileNo: rider.mobileNo,
                    address: rider.address
                },
                dateRange: invoiceData.dateRange,
                generatedDate: invoiceData.generatedDate,
                consignments: invoiceData.consignments,
                totals: invoiceData.totals,
                summary: {
                    totalDeliveries: invoiceData.summary.totalDeliveries,
                    totalPieces: invoiceData.summary.totalPieces,
                    totalWeight: invoiceData.summary.totalWeight,
                    totalCodAmount: invoiceData.summary.totalCodAmount,
                    totalDeliveryCharges: invoiceData.summary.totalDeliveryCharges,
                    grandTotal: invoiceData.summary.grandTotal
                }
            });
        } catch (persistError) {
            console.error('Warning: failed to persist rider invoice:', persistError.message);
        }

        if (format === 'json') {
            return res.status(200).json({
                success: true,
                message: 'Rider invoice generated successfully',
                data: invoiceData
            });
        } else if (format === 'pdf') {
            return generatePDFInvoice(res, invoiceData, 'rider');
        } else {
            return res.status(400).json({
                success: false,
                message: 'Unsupported format. Use "pdf" or "json".'
            });
        }

    } catch (error) {
        console.error('Error generating rider invoice:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while generating rider invoice',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Helper function to calculate delivery charges
function calculateDeliveryCharges(weight, destinationCity) {
    // Base rate per kg
    let baseRate = 50; // Default rate

    if (destinationCity) {
        const city = destinationCity.toLowerCase();
        if (city.includes('karachi')) {
            baseRate = 40;
        } else if (city.includes('lahore') || city.includes('islamabad')) {
            baseRate = 60;
        } else if (city.includes('peshawar') || city.includes('quetta')) {
            baseRate = 80;
        }
    }

    const minWeight = 1; // Minimum 1 kg
    const actualWeight = Math.max(weight, minWeight);

    return Math.round(baseRate * actualWeight);
}

// Helper function to calculate invoice totals
function calculateInvoiceTotals(consignments) {
    const totals = {
        totalPieces: 0,
        totalWeight: 0,
        totalCodAmount: 0,
        totalDeliveryCharges: 0,
        grandTotal: 0
    };

    consignments.forEach(consignment => {
        totals.totalPieces += consignment.pieces || 0;
        totals.totalWeight += consignment.weight || 0;
        totals.totalCodAmount += consignment.codAmount || 0;
        totals.totalDeliveryCharges += consignment.deliveryCharges || 0;
    });

    totals.grandTotal = totals.totalDeliveryCharges;

    return totals;
}

// Safe regex builder from user-provided strings
function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Helper function to generate invoice number
function generateInvoiceNumber(identifier, date) {
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `INV-${identifier}-${dateStr}-${random}`;
}

// Helper function to generate PDF invoice
function generatePDFInvoice(res, invoiceData, type = 'agent') {
    const doc = new PDFDocument({ margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice-${invoiceData.invoiceNumber}.pdf`);
    doc.pipe(res);
    doc.fontSize(20).font('Helvetica-Bold').text('TEZLIFT COURIER SERVICE', { align: 'center' });
    doc.fontSize(12).font('Helvetica').text('123 Shipping St, City, Country', { align: 'center' });
    doc.fontSize(10).text('Phone: +92-XXX-XXXXXXX | Email: info@tezlift.com', { align: 'center' });
    doc.moveDown(1);

    doc.fontSize(16).font('Helvetica-Bold').text('INVOICE', { align: 'center' });
    doc.moveDown(0.5);

    doc.fontSize(10).font('Helvetica');
    doc.text(`Invoice Number: ${invoiceData.invoiceNumber}`, 50, doc.y);
    doc.text(`Generated Date: ${invoiceData.generatedDate.toLocaleDateString()}`, 300, doc.y);
    doc.moveDown(0.5);

    if (type === 'agent') {
        doc.text(`Agent: ${invoiceData.agent.name}`, 50, doc.y);
        doc.text(`Account No: ${invoiceData.agent.accountNo}`, 300, doc.y);
        doc.moveDown(0.5);
        doc.text(`Address: ${invoiceData.agent.address || 'N/A'}`, 50, doc.y);
        doc.moveDown(0.5);
        doc.text(`Contact: ${invoiceData.agent.contactNo || 'N/A'}`, 50, doc.y);
        doc.text(`Email: ${invoiceData.agent.email || 'N/A'}`, 300, doc.y);
    } else {
        doc.text(`Rider: ${invoiceData.rider.name}`, 50, doc.y);
        doc.text(`Rider Code: ${invoiceData.rider.riderCode}`, 300, doc.y);
        doc.moveDown(0.5);
        doc.text(`Mobile: ${invoiceData.rider.mobileNo}`, 50, doc.y);
        doc.moveDown(0.5);
        doc.text(`Address: ${invoiceData.rider.address || 'N/A'}`, 50, doc.y);
    }

    doc.moveDown(1);

    doc.text(`Period: ${invoiceData.dateRange.from.toLocaleDateString()} to ${invoiceData.dateRange.to.toLocaleDateString()}`, 50, doc.y);
    doc.moveDown(1);

    const tableTop = doc.y;
    doc.font('Helvetica-Bold').fontSize(9);
    doc.text('Sr#', 50, tableTop);
    doc.text('Consignment', 80, tableTop);
    doc.text('Date', 180, tableTop);
    doc.text('Destination', 250, tableTop);
    doc.text('Pieces', 320, tableTop);
    doc.text('Weight', 370, tableTop);
    doc.text('COD', 420, tableTop);
    doc.text('Charges', 470, tableTop);

    doc.moveTo(50, tableTop - 5).lineTo(520, tableTop - 5).stroke();
    doc.moveTo(50, tableTop + 15).lineTo(520, tableTop + 15).stroke();

    let currentY = tableTop + 20;
    doc.font('Helvetica').fontSize(8);

    invoiceData.consignments.forEach((consignment, index) => {
        if (currentY > 700) {
            doc.addPage();
            currentY = 50;
        }

        doc.text((index + 1).toString(), 50, currentY);
        doc.text(consignment.consignmentNumber, 80, currentY);
        doc.text(consignment.bookingDate.toLocaleDateString(), 180, currentY);
        doc.text(consignment.destinationCity, 250, currentY);
        doc.text(consignment.pieces.toString(), 320, currentY);
        doc.text(consignment.weight.toString(), 370, currentY);
        doc.text(consignment.codAmount.toString(), 420, currentY);
        doc.text(consignment.deliveryCharges.toString(), 470, currentY);

        currentY += 15;
    });

    doc.moveTo(50, currentY).lineTo(520, currentY).stroke();

    doc.moveDown(1);
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('Summary:', 50, doc.y);
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(9);
    doc.text(`Total Consignments: ${invoiceData.summary.totalConsignments}`, 50, doc.y);
    doc.text(`Total Pieces: ${invoiceData.summary.totalPieces}`, 300, doc.y);
    doc.moveDown(0.5);
    doc.text(`Total Weight: ${invoiceData.summary.totalWeight} kg`, 50, doc.y);
    doc.text(`Total COD Amount: Rs. ${invoiceData.summary.totalCodAmount}`, 300, doc.y);
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text(`Total Delivery Charges: Rs. ${invoiceData.summary.totalDeliveryCharges}`, 50, doc.y);
    doc.moveDown(1);
    doc.fontSize(12);
    doc.text(`Grand Total: Rs. ${invoiceData.summary.grandTotal}`, 50, doc.y);

    doc.moveDown(2);
    doc.font('Helvetica-Oblique').fontSize(8).text('Thank you for choosing TEZLIFT COURIER SERVICE', { align: 'center' });
    doc.text('This is a computer generated invoice', { align: 'center' });

    doc.end();
}

// Get available agents for invoice generation
exports.getAvailableAgents = async (req, res) => {
    try {
        const customers = await Customer.find({ isActive: true })
            .select('accountNo username brandName email contactNo')
            .sort({ username: 1 });

        const agents = customers.map(customer => ({
            accountNo: customer.accountNo,
            name: customer.username || customer.brandName,
            email: customer.email,
            contactNo: customer.contactNo
        }));

        res.status(200).json({
            success: true,
            message: 'Available agents retrieved successfully',
            data: agents
        });

    } catch (error) {
        console.error('Error getting available agents:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while retrieving agents',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get available riders for invoice generation
exports.getAvailableRiders = async (req, res) => {
    try {
        const riders = await Rider.find({ active: true })
            .select('riderCode riderName mobileNo address')
            .sort({ riderName: 1 });

        const riderList = riders.map(rider => ({
            riderId: rider._id,
            riderCode: rider.riderCode,
            name: rider.riderName,
            mobileNo: rider.mobileNo,
            address: rider.address
        }));

        res.status(200).json({
            success: true,
            message: 'Available riders retrieved successfully',
            data: riderList
        });

    } catch (error) {
        console.error('Error getting available riders:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while retrieving riders',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get all invoices (paginated, filterable)
exports.getAllInvoices = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            type,
            accountNo,
            riderCode,
            dateFrom,
            dateTo,
            invoiceNumber
        } = req.query;

        const query = {};
        if (type) query.type = type;
        if (invoiceNumber) query.invoiceNumber = { $regex: invoiceNumber, $options: 'i' };
        if (accountNo) query['agent.accountNo'] = { $regex: accountNo, $options: 'i' };
        if (riderCode) query['rider.riderCode'] = { $regex: riderCode, $options: 'i' };

        if (dateFrom || dateTo) {
            query.generatedDate = {};
            if (dateFrom) query.generatedDate.$gte = new Date(dateFrom);
            if (dateTo) {
                const end = new Date(dateTo);
                end.setDate(end.getDate() + 1);
                query.generatedDate.$lt = end;
            }
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        // TODO: Uncomment when Invoice model is created
        // const [invoices, total] = await Promise.all([
        //     Invoice.find(query)
        //         .sort({ generatedDate: -1 })
        //         .skip(skip)
        //         .limit(parseInt(limit))
        //         .lean(),
        //     Invoice.countDocuments(query)
        // ]);

        // Temporary response until Invoice model is created
        const invoices = [];
        const total = 0;

        res.status(200).json({
            success: true,
            message: 'Invoices retrieved successfully',
            data: {
                invoices,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(total / parseInt(limit)),
                    totalItems: total,
                    itemsPerPage: parseInt(limit)
                },
                filters: { type: type || null, accountNo: accountNo || null, riderCode: riderCode || null, dateFrom: dateFrom || null, dateTo: dateTo || null, invoiceNumber: invoiceNumber || null }
            }
        });

    } catch (error) {
        console.error('Error getting invoices:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while retrieving invoices',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};