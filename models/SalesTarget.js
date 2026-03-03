const mongoose = require('mongoose');

const salesTargetSchema = new mongoose.Schema({
  entityType: {
    type: String,
    enum: ['branch', 'employee', 'overall'],
    required: true
  },
  entityId: {
    type: String, // e.g., 'Karachi', 'admin_123', or 'overall'
    required: true
  },
  period: {
    type: String, // Format expected: 'YYYY-MM'
    required: true
  },
  targetBookings: {
    type: Number,
    default: 0
  },
  targetRevenue: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

// Ensure we have only one target per entity per period
salesTargetSchema.index({ entityType: 1, entityId: 1, period: 1 }, { unique: true });

module.exports = mongoose.model('SalesTarget', salesTargetSchema);
