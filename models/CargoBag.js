const mongoose = require("mongoose");

const cargoBagSchema = new mongoose.Schema(
  {
    bagNo: {
      type: String,
      unique: true,
      uppercase: true,
      trim: true
    },
    originCity: {
      type: String,
      required: true,
      trim: true
    },
    destinationCity: {
      type: String,
      required: true,
      trim: true
    },
    consignmentNumbers: [
      {
        type: String,
        required: true,
        uppercase: true,
        trim: true
      }
    ],
    count: {
      type: Number,
      default: 0
    },
    status: {
      type: String,
      enum: ["created", "in-transit", "completed", "cancelled"],
      default: "created"
    },
    remarks: {
      type: String,
      trim: true
    },
    createdByRole: {
      type: String,
      trim: true
    },
    createdById: {
      type: String,
      trim: true
    },
    inTransitAt: Date,
    completedAt: Date
  },
  {
    timestamps: true
  }
);

cargoBagSchema.index({ bagNo: 1 });
cargoBagSchema.index({ status: 1 });
cargoBagSchema.index({ createdAt: -1 });

cargoBagSchema.pre("save", function saveHook(next) {
  if (!this.bagNo) {
    const stamp = Date.now().toString().slice(-8);
    const random = Math.floor(100 + Math.random() * 900);
    this.bagNo = `BAG${stamp}${random}`;
  }
  this.count = Array.isArray(this.consignmentNumbers) ? this.consignmentNumbers.length : 0;
  next();
});

module.exports = mongoose.model("CargoBag", cargoBagSchema);
