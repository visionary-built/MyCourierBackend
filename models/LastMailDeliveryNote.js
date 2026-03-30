const mongoose = require("mongoose");

const scanEntrySchema = new mongoose.Schema(
  {
    consignmentNumber: { type: String, required: true, trim: true, uppercase: true },
    scannedAt: { type: Date, default: Date.now },
    scannedByRole: { type: String, trim: true },
    scannedById: { type: String, trim: true },
    consigneeName: { type: String, trim: true },
    destinationCity: { type: String, trim: true },
    codAmount: { type: Number, default: 0 },
    weight: { type: Number },
    source: { type: String, enum: ["booking_status", "manual_booking"], required: true }
  },
  { _id: true }
);

const lastMailDeliveryNoteSchema = new mongoose.Schema(
  {
    noteNo: { type: String, unique: true, uppercase: true, trim: true },
    /** When set, each scan assigns the consignment to this rider (delivery sheet + in-transit) without using Booking Status separately. */
    riderId: { type: mongoose.Schema.Types.ObjectId, ref: "Rider" },
    entries: [scanEntrySchema],
    shipmentCount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["open", "submitted", "closed"],
      default: "open"
    },
    remarks: { type: String, trim: true },
    /** Set when user submits the note (handoff from scanning — not final archive). */
    submittedAt: { type: Date },
    closedAt: { type: Date },
    createdByRole: { type: String, trim: true },
    createdById: { type: String, trim: true }
  },
  { timestamps: true }
);

lastMailDeliveryNoteSchema.index({ status: 1, createdAt: -1 });
lastMailDeliveryNoteSchema.index({ riderId: 1 });
lastMailDeliveryNoteSchema.index({ noteNo: 1 });

lastMailDeliveryNoteSchema.pre("save", function preSave(next) {
  if (!this.noteNo) {
    const stamp = Date.now().toString().slice(-8);
    const random = Math.floor(100 + Math.random() * 900);
    this.noteNo = `DN${stamp}${random}`;
  }
  this.shipmentCount = Array.isArray(this.entries) ? this.entries.length : 0;
  next();
});

module.exports = mongoose.model("LastMailDeliveryNote", lastMailDeliveryNoteSchema);
