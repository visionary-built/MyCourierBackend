const mongoose = require('mongoose');

const UserAuthSchema = new mongoose.Schema({
    fullName: {
        type: String,
    },
    companyName: {
        type: String,
    },
    address: {
        type: String,
    },
    contactPerson: {
        type: String,
    },
    creditLimit: {
        type: Number,
        default: 0
    },
    paymentTerms: {
        type: String,
    },
    clientId: {
        type: String,
        unique: true,
        sparse: true // Only some users (like COD clients) will have this
    },
    username: {
        type: String,
    },
    phoneNumber: {
        type: Number,
    },
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true,
    },
    password: {
        type: String,
    },
    confirmPassword: {
        type: String,
    },
    isAdmin: {
        type: Boolean,
        default: false,
    },
    role: {
        type: String,
        enum: ['superAdmin', 'admin', 'operation', 'operationPortal', 'codClient', 'codClientPortal', 'customer', 'rider'],
        default: 'customer'
    },
    isFreeAccess: {
        type: Boolean,
        default: false,
    },
    isConfirmed: {
        type: Boolean,
        default: false,
    },
    resetPasswordOTP: {
        type: String,
    },
    resetPasswordOTPExpires: {
        type: Date,
    },
    specialRates: [{
        serviceType: { type: String, required: true },
        destinationCity: { type: String, required: true },
        baseWeight: { type: Number, default: 1 },
        baseRate: { type: Number, default: 0 },
        additionalWeightUnit: { type: Number, default: 0.5 },
        additionalRate: { type: Number, default: 0 },
        isActive: { type: Boolean, default: true }
    }]
});

module.exports = mongoose.model('UserAuth', UserAuthSchema);