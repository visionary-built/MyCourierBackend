const mongoose = require('mongoose');

const EmployeePayrollSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UserAuth',
      required: true,
      unique: true
    },
    branch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      default: null
    },
    baseSalary: {
      type: Number,
      required: true,
      min: 0
    },
    defaultBonus: {
      type: Number,
      default: 0,
      min: 0
    },
    defaultDeductions: {
      type: Number,
      default: 0,
      min: 0
    },
    isActive: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true
  }
);

EmployeePayrollSchema.index({ user: 1 });

module.exports = mongoose.model('EmployeePayroll', EmployeePayrollSchema);

