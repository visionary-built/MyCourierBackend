const express = require('express');
const router = express.Router();

const customerController = require('../controllers/customerController');
const riderController = require('../controllers/riderController');
const manualBookingController = require('../controllers/ManualbookingController');
const bookingStatusController = require('../controllers/BookingStatusController');
const giftServiceController = require('../controllers/giftServiceController');
const internationalServiceController = require('../controllers/internationalServiceController');
const { adminAuth, operationAuth } = require('../middleware/auth');
const { validateRider, handleValidationErrors } = require('../middleware/validation');
const auth = require('../controllers/auth');

// Public login route for Operation Portal
router.post('/operation-login', auth.operationPortalLogin);

// Protected routes - Use the operationAuth middleware
router.use(operationAuth);

// 1. Create Rider
router.post('/riders', validateRider, handleValidationErrors, riderController.createRider);
router.get('/riders', riderController.getAllRiders);

// 2. Create Customer
router.post('/customers', customerController.createCustomer);
router.get('/customers', customerController.getAllCustomers);

// 3. Create Booking/Manual Booking
router.post('/manual-booking', manualBookingController.createBooking);
router.get('/manual-booking', manualBookingController.getAllBookings);
router.get('/manual-booking/:id', manualBookingController.getBookingById);

// 4. Booking Status
router.post('/bookings', bookingStatusController.createBooking);
router.get('/bookings', bookingStatusController.getAllBookings);
router.get('/bookings/:consignmentNumber', bookingStatusController.getBookingByConsignmentNumber);
router.put('/bookings/:consignmentNumber/status', bookingStatusController.updateBookingStatus);

// 5. Gift & International Configs (View only for Estimates)
router.get('/services/gift/config', giftServiceController.getGiftConfig);
router.get('/services/international/config', internationalServiceController.getInternationalConfig);

module.exports = router;
