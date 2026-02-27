const mongoose = require('mongoose');

const UserAuthSchema = new mongoose.Schema({
    fullName: {
        type: String,
    },
    username: {
        type: String,
    },
    phoneNumber: {
        type: Number,
    },
    email: {
        type: String,
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
});

module.exports = mongoose.model('UserAuth', UserAuthSchema);