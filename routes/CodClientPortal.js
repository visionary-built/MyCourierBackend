const express = require('express');
const router = express.Router();
const manualBookingController = require('../controllers/ManualbookingController');
const addresslabelController = require('../controllers/addresslabelController');
const { authenticateCodClient } = require('../middleware/auth');
const ManualBooking = require('../models/ManualBooking');

const authController = require('../controllers/auth');

// COD Client Login
router.post('/cod-client-login', authController.codClientLogin);

router.use(authenticateCodClient);

const verifyBookingOwnership = async (req, res, next) => {
    try {
        const { consignmentNumber } = req.params;
        
        if (!consignmentNumber) {
            return res.status(400).json({
                success: false,
                message: 'Consignment number is required'
            });
        }

        const booking = await ManualBooking.findOne({ 
            consignmentNo: consignmentNumber.toUpperCase(),
            customerId: req.user._id 
        });

        if (!booking) {
            return res.status(403).json({
                success: false,
                message: 'Access denied: You do not own this booking or it does not exist'
            });
        }

        next();
    } catch (error) {
        console.error('Ownership verification error:', error);
        res.status(500).json({ success: false, message: 'Server error during verification' });
    }
};

// ----- Booking Routes -----
router.get('/bookings', manualBookingController.getBookingsWithFilters);
router.get('/booking/:consignmentNo', manualBookingController.getBookingByConsignmentNo);

// ----- Load Sheet Generate Routes -----
router.get('/load-sheet/:consignmentNumber', verifyBookingOwnership, addresslabelController.getLabelData);
router.get('/load-sheet/:consignmentNumber/pdf', verifyBookingOwnership, addresslabelController.generateAddressLabel);

// ----- Invoice View Routes -----
const invoiceController = require('../controllers/invoiceController');
router.get('/invoice', invoiceController.generateCodClientInvoice);

module.exports = router;
