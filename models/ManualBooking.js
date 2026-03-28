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
  // Sender details (auto-filled from customer profile when available)
  senderName: { type: String },
  senderAddress: { type: String },
  senderPhone: { type: String },
  
  // Overnight Service Additions
  isOvernight: { type: Boolean, default: false },
  priorityHandling: { type: Boolean, default: false },
  estimatedDeliveryDays: { type: Number, default: 3 }, // 1 for overnight, 3-5 standard
  
  // Gift Service Additions
  isGift: { type: Boolean, default: false },
  giftOptions: {
    specialPackaging: { type: Boolean, default: false },
    handlingInstructions: { type: String },
    messageCard: {
      enabled: { type: Boolean, default: false },
      message: { type: String }
    }
  },

  // International Service Additions
  isInternational: { type: Boolean, default: false },
  internationalDetails: {
    destinationCountry: { type: String },
    countryCode: { type: String },
    currency: { type: String, default: 'PKR' },
    customsDeclaration: {
      itemDescription: { type: String },
      declaredValue: { type: Number },
      hsCode: { type: String }
    }
  },
  
  consignmentNo: { type: String, unique: true },
  // Human‑friendly numeric order identifier for UI (auto-generated)
  orderId: { type: String, unique: true },
  status: {
    type: String,
    required: true,
    enum: [
      'pending',
      'pending-pickup',
      'at-origin-facility',
      'at-destination-facility',
      'in-transit',
      'delivered',
      'returned',
      'cancelled'
    ],
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
  /** Set when COD is recorded as collected at office (Last Mail — pending cash). */
  cashCollectedAt: { type: Date },
}, { timestamps: true });

ManualBookingSchema.pre("save", function (next) {
  // Generate consignment number if missing
  if (!this.consignmentNo) {
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.floor(1000 + Math.random() * 9000);
    this.consignmentNo = "CN" + timestamp + random;
  }

  // Generate numeric order ID if missing
  if (!this.orderId) {
    const ts = Date.now().toString().slice(-6);
    const rand = Math.floor(1000 + Math.random() * 9000);
    this.orderId = ts + rand.toString();
  }

  next();
});

module.exports = mongoose.model("ManualBooking", ManualBookingSchema);
