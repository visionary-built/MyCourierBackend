const mongoose = require('mongoose');

const bookingStatusSchema = new mongoose.Schema({
    consignmentNumber: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        uppercase: true
    },
    consigneeName: {
        type: String,
        required: true,
        trim: true
    },
    consigneeAddress: {
        type: String,
        required: true,
        trim: true
    },
    consigneeMobile: {
        type: String,
        required: true,
        trim: true
    },
    pieces: {
        type: Number,
        required: true,
        min: 1
    },
    weight: {
        type: Number,
        required: true,
        min: 0.1
    },
    codAmount: {
        type: Number,
        required: true,
        min: 0,
        default: 0
    },
    referenceNo: {
        type: String,
        trim: true
    },
    destinationCity: {
        type: String,
        required: true,
        trim: true
    },
    originCity: {
        type: String,
        trim: true
    },
    accountNo: {
        type: String,
        required: true,
        trim: true
    },
    agentName: {
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
    statusHistory: [
        {
            status: { type: String },
            timestamp: { type: Date, default: Date.now },
            reason: { type: String },
            remarks: { type: String },
            updatedBy: { type: String }
        }
    ],
    bookingDate: {
        type: Date,
        default: Date.now
    },
    deliveryDate: {
        type: Date
    },
    remarks: {
        type: String,
        trim: true
    },
    validationFlags: {
        criticalFlags: { type: [String], default: [] },
        moderateFlags: { type: [String], default: [] }
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Index for better search performance
bookingStatusSchema.index({ consignmentNumber: 1 });
bookingStatusSchema.index({ destinationCity: 1 });
bookingStatusSchema.index({ accountNo: 1 });
bookingStatusSchema.index({ agentName: 1 });
bookingStatusSchema.index({ bookingDate: -1 });

module.exports = mongoose.model('BookingStatus', bookingStatusSchema);