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
const branchController = require('../controllers/branchController');
const expenseController = require('../controllers/expenseController');
const payrollController = require('../controllers/payrollController');
const voidConsignmentController = require('../controllers/voidConsignmentController');
const auth = require('../controllers/auth');
const { getTrackingById, getTrackingByConsignmentNumber, getAllConsignments } = require('../controllers/trackingController');
const addresslabelController = require('../controllers/addresslabelController');
const qsrReportController = require('../controllers/qsrReportController');
const revenueController = require('../controllers/revenueController');
const salesController = require('../controllers/salesController');
const invoiceController = require('../controllers/invoiceController');
const overnightServiceController = require('../controllers/overnightServiceController');
const giftServiceController = require('../controllers/giftServiceController');
const internationalServiceController = require('../controllers/internationalServiceController');
const monitoringController = require('../controllers/monitoringController');
const rateCardController = require('../controllers/rateCardController');
const cargoController = require('../controllers/cargoController');
const firstMailArrivalController = require('../controllers/firstMailArrivalController');
const firstMailController = require('../controllers/firstMailController');
const lastMailNotesController = require('../controllers/lastMailNotesController');
const statusController = require('../controllers/statusController');

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
router.put('/manage/user/:id', adminAuth, adminController.updateUser);
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
router.put('/delivery-sheet-phase-1/:id', deliverySheetPhaseIController.updateDeliverySheetById);
router.delete('/delivery-sheet-phase-1/remove-consignment', deliverySheetPhaseIController.removeConsignmentNumber);


// Return Sheet
router.post('/return-sheet/register', returnSheetController.registerReturn);
router.get('/return-sheet', returnSheetController.getAllReturnSheets);
router.put('/return-sheet/:id/complete', returnSheetController.completeReturnSheet);

// Manual Booking - Full CRUD Operations
router.post("/manual-booking", manualBookingController.createBooking);
router.post("/manual-booking/walk-in", manualBookingController.createWalkInBooking);
router.get("/manual-booking", manualBookingController.getAllBookings);
router.get("/manual-booking/stats", adminAuth, manualBookingController.getManualBookingStats);
router.get("/manual-booking/search", manualBookingController.getBookingsWithFilters);

// Manual Booking - Bulk Import
router.post("/manual-booking/bulk-import", upload.single('excelFile'), handleUploadError, manualBookingController.bulkImportBookings);

router.get("/manual-booking/:id", manualBookingController.getBookingById);
router.get("/manual-booking/consignment/:consignmentNo", manualBookingController.getBookingByConsignmentNo);
router.put("/manual-booking/:id", manualBookingController.updateBooking);
router.delete("/manual-booking/:id", manualBookingController.deleteBooking);

    
// Branch (Express Centre) Management - SuperAdmin only
router.post('/branches', superAdminAuth, branchController.createBranch);
router.get('/branches', superAdminAuth, branchController.getBranches);
router.put('/branches/:id', superAdminAuth, branchController.updateBranch);
router.put('/branches/:id/assign-manager', superAdminAuth, branchController.assignManager);
router.get('/branches/:id/summary', superAdminAuth, branchController.getBranchSummary);
router.get('/branches/:id/performance', superAdminAuth, branchController.getBranchPerformance);
router.get('/branches/:id/revenue', superAdminAuth, branchController.getBranchRevenue);

// Expenses Module (SuperAdmin only)
router.post('/expense-categories', superAdminAuth, expenseController.createCategory);
router.get('/expense-categories', superAdminAuth, expenseController.getCategories);
router.post('/expenses', superAdminAuth, expenseController.createExpense);
router.get('/expenses/report', superAdminAuth, expenseController.getExpenseReport);

// Salaries & Payroll (SuperAdmin only)
router.get('/payroll/employees', superAdminAuth, payrollController.getPayrollEmployees);
router.post('/payroll/employees', superAdminAuth, payrollController.upsertEmployeePayroll);
router.post('/payroll/generate', superAdminAuth, payrollController.generatePayroll);
router.get('/payroll/history', superAdminAuth, payrollController.getPayrollHistory);
router.put('/payroll/:id', superAdminAuth, payrollController.updatePayrollItem);
router.get('/payroll/:id/slip', superAdminAuth, payrollController.getPayrollSlip);

// Void Consignments
router.get('/void-consignments', voidConsignmentController.getVoidConsignments);
router.post('/void-consignments/void', voidConsignmentController.voidConsignment);


// Tracking Consignment
router.get('/track/id/:id', getTrackingById);
router.get('/track/number/:consignmentNumber', getTrackingByConsignmentNumber);
router.get('/track', getAllConsignments);

// Address Label / Load Sheet Routes
router.get('/address-lable', addresslabelController.getAllBookings);
router.get('/address-lable/search', addresslabelController.searchBookings);
router.get('/address-lable/:consignmentNumber', addresslabelController.getBookingByNumber);
router.get('/address-lable/:consignmentNumber/pdf', addresslabelController.generateAddressLabel);
router.get('/address-lable/:consignmentNumber/data', addresslabelController.getLabelData);

// Explicit Load Sheet aliases for admin
router.get('/load-sheet', addresslabelController.getAllBookings);
router.get('/load-sheet/:consignmentNumber', addresslabelController.getLabelData);
router.get('/load-sheet/:consignmentNumber/pdf', addresslabelController.generateAddressLabel);


// QSR Report Routes
router.get('/report', qsrReportController.getQSRReport);
router.get('/consignment/:consignmentNumber', qsrReportController.getQSRByConsignment);
router.get('/summary', qsrReportController.getQSRSummary);
router.get('/export', qsrReportController.exportQSRReport);

// Revenue Module Routes (SuperAdmin only)
router.get('/revenue/summary', revenueController.getRevenueSummary);
router.get('/revenue/clients', superAdminAuth, revenueController.getClientRevenue);
router.get('/revenue/timeseries', superAdminAuth, revenueController.getRevenueTimeSeries);

// Sales Management Routes
router.get('/sales/summary', adminAuth, salesController.getSalesSummary);
router.get('/sales/report', adminAuth, salesController.getSalesReport);
router.get('/sales/export', adminAuth, salesController.exportSalesReport);

// Invoice Routes
router.get('/invoice/customers', invoiceController.getAvailableAgents);
router.get('/invoice/riders', invoiceController.getAvailableRiders);
router.get('/invoice/generate', invoiceController.generateInvoice);
router.get('/invoice/generate-rider', invoiceController.generateRiderInvoice);
router.get('/invoice', invoiceController.getAllInvoices);

// Monitoring Routes (Operations & Sales)
router.post('/monitoring/targets', adminAuth, monitoringController.setSalesTarget);
router.get('/monitoring/targets', adminAuth, monitoringController.getSalesTargets);
router.get('/monitoring/target-vs-achieved', adminAuth, monitoringController.getTargetVsAchieved);
router.get('/monitoring/rider-performance', adminAuth, monitoringController.getRiderPerformance);

// Overnight Service Routes
router.get('/services/overnight/config', superAdminAuth, overnightServiceController.getOvernightConfig);
router.post('/services/overnight/calculate', superAdminAuth, overnightServiceController.calculateOvernightRate);

// Gift Service Routes
router.get('/services/gift/config', adminAuth, giftServiceController.getGiftConfig);
router.put('/services/gift/config', superAdminAuth, giftServiceController.updateGiftConfig);
router.get('/services/gift/bookings', adminAuth, giftServiceController.getGiftBookings);

// International Service Routes
router.get('/services/international/config', adminAuth, internationalServiceController.getInternationalConfig);
router.put('/services/international/config', superAdminAuth, internationalServiceController.updateInternationalConfig);
router.get('/services/international/bookings', adminAuth, internationalServiceController.getInternationalBookings);

// ─── Global Rate Card / Rates Adjustment ────────────────────────────────────
router.get('/rate-cards', rateCardController.getAllRateCards);
router.post('/rate-cards', superAdminAuth, rateCardController.createRateCard);
router.put('/rate-cards/:id', superAdminAuth, rateCardController.updateRateCard);
router.delete('/rate-cards/:id', superAdminAuth, rateCardController.deleteRateCard);

// Cargo Module
router.post('/cargo/bags', cargoController.createBag);
router.put('/cargo/bags/:id/in-transit', cargoController.markBagInTransit);
router.put('/cargo/bags/:id/receive', cargoController.receiveBag);
router.get('/cargo/bags/history', cargoController.getBagHistory);
router.post('/cargo/manifests', cargoController.createManifest);
router.put('/cargo/manifests/:id/receive', cargoController.receiveManifest);
router.get('/cargo/manifests/pending-report', cargoController.getPendingManifestReport);
router.get('/cargo/manifests/history', cargoController.getManifestHistory);

// First Mail — origin / destination arrival (explicit endpoints)
router.post('/first-mail/origin-arrival', firstMailArrivalController.recordOriginArrival);
router.post('/first-mail/destination-arrival', firstMailArrivalController.recordDestinationArrival);
router.get('/first-mail/pickup-history', firstMailController.getPickupHistory);

// Last Mail — delivery note (scan CN), pending cash, return note (scan CN)
router.post('/last-mail/delivery-notes', lastMailNotesController.createDeliveryNote);
router.post('/last-mail/delivery-notes/:id/scan', lastMailNotesController.scanDeliveryNote);
router.put('/last-mail/delivery-notes/:id', lastMailNotesController.updateDeliveryNote);
router.get('/last-mail/delivery-notes/:id', lastMailNotesController.getDeliveryNoteById);
router.get('/last-mail/delivery-notes', lastMailNotesController.listDeliveryNotes);
router.put('/last-mail/delivery-notes/:id/submit', lastMailNotesController.submitDeliveryNote);
router.put('/last-mail/delivery-notes/:id/close', lastMailNotesController.closeDeliveryNote);
router.delete('/last-mail/delivery-notes/:id', lastMailNotesController.deleteDeliveryNote);
router.get('/last-mail/receive-notes', lastMailNotesController.listReceiveNotes);
router.get('/last-mail/receive-notes/:id', lastMailNotesController.getReceiveNoteDetail);
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