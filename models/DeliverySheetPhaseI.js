const mongoose = require('mongoose');

const deliverySheetPhaseISchema = new mongoose.Schema({
  riderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Rider',
    required: [true, 'Rider is required']
  },
  riderName: {
    type: String,
    required: [true, 'Rider name is required']
  },
  riderCode: {
    type: String,
    required: [true, 'Rider code is required']
  },
  consignmentNumbers: [{
    type: String,
    required: [true, 'Consignment number is required'],
    trim: true,
    uppercase: true
  }],
  count: {
    type: Number,
    default: 0,
    min: [0, 'Count cannot be negative']
  },
  status: {
    type: String,
    enum: ['active', 'pending', 'in-transit', 'delivered', 'cancelled', 'completed'],
    default: 'active'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  completedAt: {
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
deliverySheetPhaseISchema.index({ riderId: 1 });
deliverySheetPhaseISchema.index({ riderCode: 1 });
deliverySheetPhaseISchema.index({ consignmentNumbers: 1 });
deliverySheetPhaseISchema.index({ status: 1 });
deliverySheetPhaseISchema.index({ createdAt: -1 });

// Virtual for getting rider details
deliverySheetPhaseISchema.virtual('rider', {
  ref: 'Rider',
  localField: 'riderId',
  foreignField: '_id',
  justOne: true
});

// Pre-save middleware to update count
deliverySheetPhaseISchema.pre('save', function(next) {
  this.count = this.consignmentNumbers.length;
  next();
});

// Static method to find active sheet by rider
deliverySheetPhaseISchema.statics.findActiveByRider = function(riderId) {
  return this.findOne({ riderId, status: 'active' });
};

// Static method to find sheet by consignment number
deliverySheetPhaseISchema.statics.findByConsignmentNumber = function(consignmentNumber) {
  return this.findOne({ consignmentNumbers: consignmentNumber });
};

module.exports = mongoose.model('DeliverySheetPhaseI', deliverySheetPhaseISchema);
