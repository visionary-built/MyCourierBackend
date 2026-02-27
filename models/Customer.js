const mongoose = require('mongoose');

const InvoiceSchema = new mongoose.Schema({
  productService: {
    type: String,
    required: true,
    default: 'Select Service'
  },
  destination: {
    type: String,
    required: true
  },
  weight: {
    type: Number,
    default: 0
  },
  rate: {
    type: Number,
    default: 0
  },
  additionalWeight: {
    type: Number,
    default: 0
  },
  additionalRate: {
    type: Number,
    default: 0
  },
  gst: {
    type: Number,
    default: 0
  },
  fuel: {
    type: Number,
    default: 0
  },
  pickupCharges: {
    type: Number,
    default: 0
  },
  handlingCharges: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['Yes', 'No'],
    default: 'Yes'
  }
});

const CustomerSchema = new mongoose.Schema({
  // Customer Info fields from the form
  city: {
    type: String,
    required: true,
    default: 'Default City'
  },
  serialNo: {
    type: String,
    required: true
  },
  accountNo: {
    type: String,
    required: true,
    unique: true
  },
  username: {
    type: String,
    required: true,
    unique: true
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true
  },
  confirmPassword: {
    type: String,
    required: true
  },
  contactNo: {
    type: String,
    required: false
  },
  cnicNo: {
    type: String,
    required: false
  },
  bankName: {
    type: String,
    required: false
  },
  bankAccountTitle: {
    type: String,
    required: false
  },
  bankAccountNo: {
    type: String,
    required: false
  },
  bankIBNNo: {
    type: String,
    required: false
  },
  address: {
    type: String,
    required: false
  },
  contactPerson: {
    type: String,
    required: false
  },
  brandName: {
    type: String,
    required: false
  },
  isActive: {
    type: Boolean,
    default: false
  },
  invoices: [InvoiceSchema]
}, { timestamps: true });

module.exports = mongoose.model('Customer', CustomerSchema);