const mongoose = require("mongoose");

const ManualBookingSchema = new mongoose.Schema({
  customerId: { type: String, required: true }, // Changed from ObjectId to String for testing
  createdBy: { type: String, enum: ["admin", "customer"], required: true },
  serviceType: { type: String, required: true },
  originCity: { type: String, required: true },
  destinationCity: { type: String, required: true },
  consigneeName: { type: String, required: true },
  consigneeMobile: { type: String, required: true },
  consigneeEmail: { type: String },
  consigneeAddress: { type: String, required: true },
  date: { type: Date, default: Date.now },
  weight: { type: Number, required: true },
  codAmount: { type: Number, default: 0 },
  customerReferenceNo: { type: String },
  pieces: { type: Number, default: 1 },
  fragile: { type: Boolean, default: false },
  deliveryCharges: { type: Number, default: 0 },
  productDetail: { type: String },
  remarks: { type: String },
  consignmentNo: { type: String, unique: true },
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
}, { timestamps: true });

ManualBookingSchema.pre("save", function (next) {
  if (!this.consignmentNo) {
    const uniquePart = Date.now().toString().slice(-6);
    this.consignmentNo = "CN" + Math.floor(100000 + Math.random() * 900000) + uniquePart;
  }
  next();
});

module.exports = mongoose.model("ManualBooking", ManualBookingSchema);
