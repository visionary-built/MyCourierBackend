const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const customerController = require('../controllers/customerController');
const riderController = require('../controllers/riderController');
const { authenticateAdmin } = require('../middleware/auth');
const { validateRider, handleValidationErrors } = require('../middleware/validation');
const arrivalScanController = require('../controllers/arrivalScanController');
const bookingStatusController = require('../controllers/BookingStatusController');
const deliverySheetPhaseIController = require('../controllers/DeliverySheetPhaseI');
const returnSheetController = require('../controllers/returnSheetController');
const manualBookingController = require('../controllers/ManualbookingController');
const voidConsignmentController = require('../controllers/voidConsignmentController');
const auth = require('../controllers/auth');
const { getTrackingById, getTrackingByConsignmentNumber, getAllConsignments } = require('../controllers/trackingController');
const addresslabelController = require('../controllers/addresslabelController');
const qsrReportController = require('../controllers/qsrReportController');
const invoiceController = require('../controllers/invoiceController');

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




const adminController = require('../controllers/adminController');
const { adminAuth, superAdminAuth } = require('../middleware/auth');

router.post('/admin-login', auth.adminLogin);
router.post('/logout', auth.logout);

// User Management Routes
router.post('/manage/create-user', adminAuth, adminController.createUser);
router.post('/manage/create-operation-portal', adminAuth, adminController.createOperationPortal);
router.post('/manage/create-cod-portal', adminAuth, adminController.createCodPortal);
router.get('/manage/users', adminAuth, adminController.getAllUsers);
router.delete('/manage/user/:id', superAdminAuth, adminController.deleteUser);

// All subsequent admin routes should be protected by adminAuth
router.use(adminAuth);

// Admin Routes
router.post('/customers', customerController.createCustomer);
router.get('/customers', customerController.getAllCustomers);
router.get('/customers/:id', customerController.getCustomerById);
router.put('/customers/:id', customerController.updateCustomer);
router.delete('/customers/:id', customerController.deleteCustomer);

// rider
router.post('/riders', validateRider, handleValidationErrors, riderController.createRider);
router.get('/riders', riderController.getAllRiders);
router.get('/riders/:id', riderController.getRider);
router.put('/riders/:id', validateRider, handleValidationErrors, riderController.updateRider);
router.delete('/riders/:id', riderController.deleteRider);
router.put('/riders/:id/toggle-status', riderController.toggleRiderStatus);
router.put('/riders/:id/reset-password', riderController.resetRiderPassword);


// Arrival Scan
router.get('/parcels/search', arrivalScanController.searchParcels);
router.get('/arrival/riders', arrivalScanController.getAllArrivalScanRider);
router.get('/parcels/:consignmentNumber', arrivalScanController.getParcelById);
router.put('/parcels/:consignmentNumber/status', arrivalScanController.updateParcelStatus);

// Booking Status
router.get('/bookings/search', bookingStatusController.searchBookings);
router.get('/bookings', bookingStatusController.getAllBookings);
router.get('/bookings/:consignmentNumber', bookingStatusController.getBookingByConsignmentNumber);
router.put('/bookings/:consignmentNumber/status', bookingStatusController.updateBookingStatus);
router.post('/bookings', bookingStatusController.createBooking);


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

// Manual Booking - Full CRUD Operations
router.post("/manual-booking", manualBookingController.createBooking);
router.get("/manual-booking", manualBookingController.getAllBookings);
router.get("/manual-booking/search", manualBookingController.getBookingsWithFilters);
router.get("/manual-booking/:id", manualBookingController.getBookingById);
router.get("/manual-booking/consignment/:consignmentNo", manualBookingController.getBookingByConsignmentNo);
router.put("/manual-booking/:id", manualBookingController.updateBooking);
router.delete("/manual-booking/:id", manualBookingController.deleteBooking);

// Manual Booking - Bulk Import
router.post("/manual-booking/bulk-import", upload.single('excelFile'), handleUploadError, manualBookingController.bulkImportBookings);

    
// Void Consignments
router.get('/void-consignments', voidConsignmentController.getVoidConsignments);
router.post('/void-consignments/void', voidConsignmentController.voidConsignment);


// Tracking Consignment
router.get('/track/id/:id', getTrackingById);
router.get('/track/number/:consignmentNumber', getTrackingByConsignmentNumber);
router.get('/track', getAllConsignments);

// Address Label Routes
router.get('/address-lable', addresslabelController.getAllBookings);
router.get('/address-lable/search', addresslabelController.searchBookings);
router.get('/address-lable/:consignmentNumber', addresslabelController.getBookingByNumber);
router.get('/address-lable/:consignmentNumber/pdf', addresslabelController.generateAddressLabel);
router.get('/address-lable/:consignmentNumber/data', addresslabelController.getLabelData);


// QSR Report Routes
router.get('/report', qsrReportController.getQSRReport);
router.get('/consignment/:consignmentNumber', qsrReportController.getQSRByConsignment);
router.get('/summary', qsrReportController.getQSRSummary);
router.get('/export', qsrReportController.exportQSRReport);

// Invoice Routes
router.get('/invoice/customers', invoiceController.getAvailableAgents);
router.get('/invoice/riders', invoiceController.getAvailableRiders);
router.get('/invoice/generate', invoiceController.generateInvoice);
router.get('/invoice/generate-rider', invoiceController.generateRiderInvoice);
router.get('/invoice', invoiceController.getAllInvoices);



module.exports = router;
