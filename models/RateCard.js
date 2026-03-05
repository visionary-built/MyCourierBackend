const mongoose = require('mongoose');

const RateCardSchema = new mongoose.Schema({
    serviceType: {
        type: String,
        required: true,
        enum: ['standard', 'express', 'overnight', 'economy']
    },
    originCity: {
        type: String,
        required: true,
        default: 'all' // 'all' means it applies to all origin cities
    },
    destinationCity: {
        type: String,
        required: true
    },
    baseWeight: {
        type: Number,
        default: 1, // in kg
        required: true
    },
    baseRate: {
        type: Number,
        required: true
    },
    additionalWeightUnit: {
        type: Number,
        default: 0.5, // per 0.5kg increments
        required: true
    },
    additionalRate: {
        type: Number,
        required: true
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

// Ensure unique combination of service, origin, and destination
RateCardSchema.index({ serviceType: 1, originCity: 1, destinationCity: 1 }, { unique: true });

module.exports = mongoose.model('RateCard', RateCardSchema);
