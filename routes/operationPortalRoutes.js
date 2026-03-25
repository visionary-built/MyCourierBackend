const express = require('express');
const router = express.Router();

const arrivalScanController = require('../controllers/arrivalScanController');
const customerController = require('../controllers/customerController');
const riderController = require('../controllers/riderController');
const manualBookingController = require('../controllers/ManualbookingController');
const bookingStatusController = require('../controllers/BookingStatusController');
const giftServiceController = require('../controllers/giftServiceController');
const internationalServiceController = require('../controllers/internationalServiceController');
const { adminAuth, operationAuth } = require('../middleware/auth');
const { validateRider, handleValidationErrors } = require('../middleware/validation');
const deliverySheetPhaseIController = require('../controllers/DeliverySheetPhaseI');
const returnSheetController = require('../controllers/returnSheetController');
const addresslabelController = require('../controllers/addresslabelController');
const voidConsignmentController = require('../controllers/voidConsignmentController');
const overnightServiceController = require('../controllers/overnightServiceController');
const rateCardController = require('../controllers/rateCardController');
const { getTrackingById, getTrackingByConsignmentNumber, getAllConsignments } = require('../controllers/trackingController');
const invoiceController = require('../controllers/invoiceController');
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
router.get("/manual-booking/stats",  manualBookingController.getManualBookingStats);


// 4. Booking Status
router.post('/bookings', bookingStatusController.createBooking);
router.get('/bookings', bookingStatusController.getAllBookings);
router.get('/bookings/:consignmentNumber', bookingStatusController.getBookingByConsignmentNumber);
router.put('/bookings/:consignmentNumber/status', bookingStatusController.updateBookingStatus);

// 5. Gift & International Configs (View only for Estimates)
router.get('/services/gift/config', giftServiceController.getGiftConfig);
router.get('/services/international/config', internationalServiceController.getInternationalConfig);


    // Arrival Scan
    router.get('/parcels/search', arrivalScanController.searchParcels);
    router.get('/arrival/riders', arrivalScanController.getAllArrivalScanRider);
    router.get('/parcels/:consignmentNumber', arrivalScanController.getParcelById);
    router.put('/parcels/:consignmentNumber/status', arrivalScanController.updateParcelStatus);

// Delivery Sheet Phase 1 
router.post('/delivery-sheet-phase-1/create', deliverySheetPhaseIController.createOrGetDeliverySheet);
router.post('/delivery-sheet-phase-1/add-consignment', deliverySheetPhaseIController.addConsignmentNumber);
router.get('/delivery-sheet-phase-1/riders', deliverySheetPhaseIController.getActiveRiders);
router.get('/delivery-sheet-phase-1/rider/:riderId', deliverySheetPhaseIController.getDeliverySheetWithParcels);
router.get('/delivery-sheet-phase-1', deliverySheetPhaseIController.getAllDeliverySheets);
router.get('/delivery-sheet-phase-1/:id', deliverySheetPhaseIController.getDeliverySheetById);
router.put('/delivery-sheet-phase-1/rider/:riderId/complete', deliverySheetPhaseIController.completeDeliverySheet);
router.delete('/delivery-sheet-phase-1/remove-consignment', deliverySheetPhaseIController.removeConsignmentNumber);

// Return Sheet
router.post('/return-sheet/register', returnSheetController.registerReturn);
router.get('/return-sheet', returnSheetController.getAllReturnSheets);
router.put('/return-sheet/:id/complete', returnSheetController.completeReturnSheet);

// Explicit Load Sheet aliases for admin
router.get('/load-sheet', addresslabelController.getAllBookings);
router.get('/load-sheet/:consignmentNumber', addresslabelController.getLabelData);
router.get('/load-sheet/:consignmentNumber/pdf', addresslabelController.generateAddressLabel);

// Void Consignments
router.get('/void-consignments', voidConsignmentController.getVoidConsignments);
router.post('/void-consignments/void', voidConsignmentController.voidConsignment);

// Overnight Service Routes
router.get('/services/overnight/config', overnightServiceController.getOvernightConfig);
router.post('/services/overnight/calculate', overnightServiceController.calculateOvernightRate);

// ─── Global Rate Card / Rates Adjustment ────────────────────────────────────
router.get('/rate-cards', rateCardController.getAllRateCards);
router.post('/rate-cards',  rateCardController.createRateCard);
router.put('/rate-cards/:id',  rateCardController.updateRateCard);
router.delete('/rate-cards/:id',  rateCardController.deleteRateCard);


// Tracking Consignment
router.get('/track/id/:id', getTrackingById);
router.get('/track/number/:consignmentNumber', getTrackingByConsignmentNumber);
router.get('/track', getAllConsignments);


// Invoice Routes
router.get('/invoice/customers', invoiceController.getAvailableAgents);
router.get('/invoice/riders', invoiceController.getAvailableRiders);
router.get('/invoice/generate', invoiceController.generateInvoice);
router.get('/invoice/generate-rider', invoiceController.generateRiderInvoice);
router.get('/invoice', invoiceController.getAllInvoices);


module.exports = router;
