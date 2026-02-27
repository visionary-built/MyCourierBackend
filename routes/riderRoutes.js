const express = require('express');
const router = express.Router();
const riderController = require('../controllers/riderController');
const returnSheetController = require('../controllers/returnSheetController');
const bookingStatusController = require('../controllers/BookingStatusController');
const deliverySheetPhaseIController = require('../controllers/DeliverySheetPhaseI');
const arrivalScanController = require('../controllers/arrivalScanController');
const { authenticateRider } = require('../middleware/auth');
const auth = require('../controllers/auth');
const { validateRiderLogin, validateChangePassword, validateRiderProfileUpdate, handleValidationErrors, validateRider } = require('../middleware/validation');

router.post('/login', validateRiderLogin, handleValidationErrors, riderController.riderLogin);
router.post('/logout', auth.logout);

router.get('/profile', authenticateRider, riderController.getRiderProfile);
router.put('/profile', authenticateRider, validateRiderProfileUpdate, handleValidationErrors, riderController.updateRiderProfile);
router.put('/change-password', authenticateRider, validateChangePassword, handleValidationErrors, riderController.changePassword);


// Return Sheet
router.post('/return-sheet/register', authenticateRider, returnSheetController.registerReturn);
router.get('/return-sheet', authenticateRider, returnSheetController.getReturnSheet);


// Booking Status (Rider access)
router.get('/bookings/search', authenticateRider, bookingStatusController.searchBookings);
router.get('/bookings', authenticateRider, bookingStatusController.getAllBookings);
router.get('/bookings/:consignmentNumber', authenticateRider, bookingStatusController.getBookingByConsignmentNumber);
router.put('/bookings/:consignmentNumber/status', authenticateRider, bookingStatusController.updateBookingStatus);
router.post('/bookings', authenticateRider, bookingStatusController.createBooking);

// Delivery Sheet (Rider view)
router.get('/delivery-sheet/active', authenticateRider, deliverySheetPhaseIController.getMyActiveDeliverySheet);
router.post('/delivery-sheet/:consignmentNumber/accept', authenticateRider, deliverySheetPhaseIController.riderAcceptConsignment);
router.post('/delivery-sheet/:consignmentNumber/decline', authenticateRider, deliverySheetPhaseIController.riderDeclineConsignment);

// Parcels (Arrival Scan features for Rider)
router.get('/parcels/search', authenticateRider, arrivalScanController.searchParcels);
router.get('/parcels/:consignmentNumber', authenticateRider, arrivalScanController.getParcelById);
router.put('/parcels/:consignmentNumber/status', authenticateRider, arrivalScanController.updateParcelStatus);

// Rider statistics
router.get('/statistics/:rider', authenticateRider, arrivalScanController.getRiderStatistics);

module.exports = router;