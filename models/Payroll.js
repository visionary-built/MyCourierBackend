const mongoose = require('mongoose');

const PayrollSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UserAuth',
      required: true
    },
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      default: null
    },
    year: {
      type: Number,
      required: true
    },
    month: {
      type: Number,
      required: true,
      min: 1,
      max: 12
    },
    baseSalary: {
      type: Number,
      required: true,
      min: 0
    },
    bonus: {
      type: Number,
      default: 0,
      min: 0
    },
    deductions: {
      type: Number,
      default: 0,
      min: 0
    },
    netPay: {
      type: Number,
      required: true,
      min: 0
    },
    status: {
      type: String,
      enum: ['paid', 'unpaid'],
      default: 'unpaid'
    },
    generatedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

PayrollSchema.index({ employee: 1, year: 1, month: 1 }, { unique: true });

module.exports = mongoose.model('Payroll', PayrollSchema);

