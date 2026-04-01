const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');

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
const cargoController = require('../controllers/cargoController');
const firstMailArrivalController = require('../controllers/firstMailArrivalController');
const firstMailController = require('../controllers/firstMailController');
const lastMailNotesController = require('../controllers/lastMailNotesController');
const statusController = require('../controllers/statusController');
const auth = require('../controllers/auth');



// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
      cb(null, Date.now() + '-' + file.originalname);
    }
  });
  
  const upload = multer({ 
    storage: storage,
    fileFilter: function (req, file, cb) {
      const allowedTypes = ['.xlsx', '.xls'];
      const fileExt = path.extname(file.originalname).toLowerCase();
      if (allowedTypes.includes(fileExt)) {
        cb(null, true);
      } else {
        cb(new Error('Only Excel files (.xlsx, .xls) are allowed'));
      }
    },
    limits: {
      fileSize: 10 * 1024 * 1024 // 10MB limit
    }
  });
  
  // Error handling middleware for multer
  const handleUploadError = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          message: 'File too large. Maximum size is 10MB'
        });
      }
    }
    if (err.message === 'Only Excel files (.xlsx, .xls) are allowed') {
      return res.status(400).json({
        success: false,
        message: err.message
      });
    }
    next(err);
  };




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
router.post('/manual-booking/walk-in', manualBookingController.createWalkInBooking);
router.get('/manual-booking', manualBookingController.getAllBookings);
router.get('/manual-booking/:id', manualBookingController.getBookingById);
router.get("/manual-booking/stats",  manualBookingController.getManualBookingStats);
// Manual Booking - Bulk Import
router.post("/manual-booking/bulk-import", upload.single('excelFile'), handleUploadError, manualBookingController.bulkImportBookings);

// 4. Booking Status
router.post('/bookings', bookingStatusController.createBooking);
router.get('/bookings/pending-shipment', bookingStatusController.getPendingShipmentBookings);
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
router.put('/delivery-sheet-phase-1/:id', deliverySheetPhaseIController.updateDeliverySheetById);
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

// Cargo Module
router.post('/cargo/bags', cargoController.createBag);
router.put('/cargo/bags/:id/in-transit', cargoController.markBagInTransit);
router.put('/cargo/bags/:id/receive', cargoController.receiveBag);
router.get('/cargo/bags/history', cargoController.getBagHistory);
router.get('/cargo/bags/:id/detail', cargoController.getBagDetail);
router.post('/cargo/bags/:id/check-consignments', cargoController.checkBagConsignments);
router.put('/cargo/bags/:id/received-consignments', cargoController.updateBagReceivedConsignments);
router.post('/cargo/manifests', cargoController.createManifest);
router.put('/cargo/manifests/:id/receive', cargoController.receiveManifest);
router.get('/cargo/manifests/pending-report', cargoController.getPendingManifestReport);
router.get('/cargo/manifests/history', cargoController.getManifestHistory);
router.get('/cargo/manifests/:id/detail', cargoController.getManifestDetail);
router.post('/cargo/manifests/:id/check-consignments', cargoController.checkManifestConsignments);
router.post('/cargo/manifests/:id/check-bags', cargoController.checkManifestBags);
router.put('/cargo/manifests/:id/received-bags', cargoController.updateManifestReceivedBags);

// First Mail — origin / destination arrival
router.post('/first-mail/origin-arrival', firstMailArrivalController.recordOriginArrival);
router.post('/first-mail/destination-arrival', firstMailArrivalController.recordDestinationArrival);
router.get('/first-mail/pickup-history', firstMailController.getPickupHistory);

// Last Mail — delivery note, pending cash, return note
router.post('/last-mail/delivery-notes', lastMailNotesController.createDeliveryNote);
router.post('/last-mail/delivery-notes/:id/scan', lastMailNotesController.scanDeliveryNote);
router.delete(
  '/last-mail/delivery-notes/:id/entries/:consignmentNumber',
  lastMailNotesController.removeDeliveryNoteEntry
);
router.put('/last-mail/delivery-notes/:id', lastMailNotesController.updateDeliveryNote);
router.get('/last-mail/delivery-notes/:id', lastMailNotesController.getDeliveryNoteById);
router.get('/last-mail/delivery-notes', lastMailNotesController.listDeliveryNotes);
router.put('/last-mail/delivery-notes/:id/submit', lastMailNotesController.submitDeliveryNote);
router.put('/last-mail/delivery-notes/:id/close', lastMailNotesController.closeDeliveryNote);
router.delete('/last-mail/delivery-notes/:id', lastMailNotesController.deleteDeliveryNote);
router.get('/last-mail/receive-notes', lastMailNotesController.listReceiveNotes);
router.get('/last-mail/receive-notes/:id', lastMailNotesController.getReceiveNoteDetail);
router.put('/last-mail/receive-notes/:id', lastMailNotesController.updateReceiveNote);
/** Same as POST /last-mail/delivery-notes/:id/scan — receive view uses delivery notes under the hood. */
router.post('/last-mail/receive-notes/:id/scan', lastMailNotesController.scanDeliveryNote);
router.delete(
  '/last-mail/receive-notes/:id/entries/:consignmentNumber',
  lastMailNotesController.removeDeliveryNoteEntry
);
router.put(
  '/last-mail/receive-notes/:id/entries/bulk-status',
  lastMailNotesController.bulkUpdateReceiveNoteConsignmentStatuses
);
router.put(
  '/last-mail/receive-notes/:id/entries/:consignmentNumber/status',
  lastMailNotesController.updateReceiveNoteConsignmentStatus
);
router.get('/last-mail/pending-cash-collection', lastMailNotesController.getPendingCashCollection);
router.post(
  '/last-mail/pending-cash-collection/collect',
  lastMailNotesController.uploadCodBankSlip,
  lastMailNotesController.recordCashCollection
);
router.get('/last-mail/cash-collection/complete', lastMailNotesController.listCompletedCashCollection);
router.post('/last-mail/return-notes', lastMailNotesController.createReturnNote);
router.post('/last-mail/return-notes/:id/scan', lastMailNotesController.scanReturnNote);
router.get('/last-mail/return-notes/:id', lastMailNotesController.getReturnNoteById);
router.get('/last-mail/return-notes', lastMailNotesController.listReturnNotes);
router.put('/last-mail/return-notes/:id/close', lastMailNotesController.closeReturnNote);

// Status — quick scan & scanning history
router.get('/status/quick-scan/:consignmentNumber', statusController.quickScan);
router.get('/status/scanning-history', statusController.getScanningHistory);

module.exports = router;
