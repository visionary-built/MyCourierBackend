// models/arrivalScan.js
const mongoose = require('mongoose');

const arivalScanSchema = new mongoose.Schema({
  consignmentNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true
  },
  rider: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'in-transit', 'delivered', 'returned', 'cancelled'],
    default: 'pending'
  },
  senderName: {
    type: String,
    required: true,
    trim: true
  },
  senderAddress: {
    type: String,
    required: true
  },
  recipientName: {
    type: String,
    required: true,
    trim: true
  },
  recipientAddress: {
    type: String,
    required: true
  },
  recipientPhone: {
    type: String,
    required: true
  },
  weight: {
    type: Number,
    required: true,
    min: 0
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  pickupDate: {
    type: Date,
    default: Date.now
  },
  deliveryDate: {
    type: Date
  },
  arrivalDate: {
    type: Date
  },
  remarks: {
    type: String,
    trim: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Index for better search performance
arivalScanSchema.index({ consignmentNumber: 1 });
arivalScanSchema.index({ rider: 1 });
arivalScanSchema.index({ status: 1 });
arivalScanSchema.index({ createdAt: -1 });

// Virtual for days in transit
arivalScanSchema.virtual('daysInTransit').get(function() {
  if (this.deliveryDate) {
    return Math.ceil((this.deliveryDate - this.pickupDate) / (1000 * 60 * 60 * 24));
  }
  return Math.ceil((new Date() - this.pickupDate) / (1000 * 60 * 60 * 24));
});



module.exports = mongoose.model('arivalScan', arivalScanSchema);