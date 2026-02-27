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