const mongoose = require('mongoose');

const returnSheetSchema = new mongoose.Schema({
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
  orderStatuses: [{
    type: String,
    required: true
  }],
  outcome: {
    type: String,
    enum: ['to_be_sent_back', 'received_at_office', 'other'],
    default: 'received_at_office'
  },
  createdAt: {
    type: Date,
    default: Date.now
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

// Indexes for search performance
returnSheetSchema.index({ riderId: 1 });
returnSheetSchema.index({ riderCode: 1 });
returnSheetSchema.index({ consignmentNumbers: 1 });
returnSheetSchema.index({ createdAt: -1 });

// Pre-save middleware to update count
returnSheetSchema.pre('save', function(next) {
  this.count = this.consignmentNumbers.length;
  next();
});

module.exports = mongoose.model('ReturnSheet', returnSheetSchema);
