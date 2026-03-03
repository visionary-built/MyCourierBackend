const mongoose = require('mongoose');

const ExpenseCategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true
    },
    code: {
      type: String,
      required: true,
      trim: true,
      unique: true
    },
    description: {
      type: String,
      trim: true
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

ExpenseCategorySchema.index({ code: 1 });

module.exports = mongoose.model('ExpenseCategory', ExpenseCategorySchema);

