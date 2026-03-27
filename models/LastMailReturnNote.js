const mongoose = require("mongoose");

const returnScanEntrySchema = new mongoose.Schema(
  {
    consignmentNumber: { type: String, required: true, trim: true, uppercase: true },
    scannedAt: { type: Date, default: Date.now },
    scannedByRole: { type: String, trim: true },
    scannedById: { type: String, trim: true },
    consigneeName: { type: String, trim: true },
    destinationCity: { type: String, trim: true },
    bookingStatus: { type: String, trim: true },
    source: { type: String, enum: ["booking_status", "manual_booking"], required: true }
  },
  { _id: true }
);

const lastMailReturnNoteSchema = new mongoose.Schema(
  {
    returnNoteNo: { type: String, unique: true, uppercase: true, trim: true },
    entries: [returnScanEntrySchema],
    shipmentCount: { type: Number, default: 0 },
    status: { type: String, enum: ["open", "closed"], default: "open" },
    remarks: { type: String, trim: true },
    closedAt: { type: Date },
    createdByRole: { type: String, trim: true },
    createdById: { type: String, trim: true }
  },
  { timestamps: true }
);

lastMailReturnNoteSchema.index({ status: 1, createdAt: -1 });
lastMailReturnNoteSchema.index({ returnNoteNo: 1 });

lastMailReturnNoteSchema.pre("save", function preSave(next) {
  if (!this.returnNoteNo) {
    const stamp = Date.now().toString().slice(-8);
    const random = Math.floor(100 + Math.random() * 900);
    this.returnNoteNo = `RN${stamp}${random}`;
  }
  this.shipmentCount = Array.isArray(this.entries) ? this.entries.length : 0;
  next();
});

module.exports = mongoose.model("LastMailReturnNote", lastMailReturnNoteSchema);
