const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { authenticateCustomer } = require('../middleware/auth');
const { validateConsignmentNumber } = require('../middleware/validation');
const customerController = require('../controllers/customerController');
const returnSheetController = require('../controllers/returnSheetController');
const bookingStatusController = require('../controllers/BookingStatusController');
const manualBookingController = require('../controllers/ManualbookingController');
const addressLabelController = require('../controllers/addresslabelController');
const invoiceController = require('../controllers/invoiceController');
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

// AUTHENTICATION ROUTES
router.post('/customer-login', customerController.customerLogin);
router.post('/logout', auth.logout);

// CUSTOMER PROFILE ROUTES
router.get('/profile', authenticateCustomer, customerController.getCustomerProfile);
router.put('/profile', authenticateCustomer, customerController.updateCustomerProfile);
router.get('/invoices', authenticateCustomer, customerController.getCustomerInvoices);

// RETURN SHEET ROUTES
router.get('/return-sheet', authenticateCustomer, returnSheetController.getAllReturnSheets);
// BOOKING STATUS ROUTES
router.post('/bookings', authenticateCustomer, bookingStatusController.createBooking);
router.get('/bookings/search', authenticateCustomer, bookingStatusController.searchBookings);
router.get('/bookings', authenticateCustomer, bookingStatusController.getAllBookings);
router.get('/bookings/:consignmentNumber', authenticateCustomer, validateConsignmentNumber, bookingStatusController.getBookingByConsignmentNumber);
router.put('/bookings/:consignmentNumber/status', authenticateCustomer, validateConsignmentNumber, bookingStatusController.updateBookingStatus);

// MANUAL BOOKING ROUTES - Customer CRUD Operations (Create Parcel)
router.post('/manual-booking', authenticateCustomer, manualBookingController.createBooking);
router.get('/manual-booking', authenticateCustomer, manualBookingController.getAllBookings);
router.get('/manual-booking/search', authenticateCustomer, manualBookingController.getBookingsWithFilters);
router.get('/manual-booking/:id', authenticateCustomer, manualBookingController.getBookingById);
router.get('/manual-booking/consignment/:consignmentNo', authenticateCustomer, validateConsignmentNumber, manualBookingController.getBookingByConsignmentNo);
router.put('/manual-booking/:id', authenticateCustomer, manualBookingController.updateBooking);
router.delete('/manual-booking/:id', authenticateCustomer, manualBookingController.deleteBooking);

// MANUAL BOOKING - Bulk Import
router.post('/manual-booking/bulk-import', authenticateCustomer, upload.single('excelFile'), handleUploadError, manualBookingController.bulkImportBookings);

// ADDRESS LABEL ROUTES
router.get('/labels/search', authenticateCustomer, addressLabelController.getAllBookings);
router.get('/labels/:consignmentNumber', authenticateCustomer, validateConsignmentNumber, addressLabelController.getBookingByNumber);
router.get('/labels/:consignmentNumber/generate', authenticateCustomer, validateConsignmentNumber, addressLabelController.generateAddressLabel);
router.get('/labels/:consignmentNumber/data', authenticateCustomer, validateConsignmentNumber, addressLabelController.getLabelData);

// INVOICE ROUTES
router.get('/invoices/generate', authenticateCustomer, invoiceController.generateInvoice);
router.get('/invoices/preview', authenticateCustomer, invoiceController.generateInvoice);

// TRACKING & SEARCH ROUTES
router.get('/track/:consignmentNumber', authenticateCustomer, validateConsignmentNumber, addressLabelController.getBookingByNumber);
router.get('/search/bookings', authenticateCustomer, addressLabelController.searchBookings);

module.exports = router;