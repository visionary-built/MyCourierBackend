const mongoose = require("mongoose");

const cargoManifestSchema = new mongoose.Schema(
  {
    manifestNo: {
      type: String,
      unique: true,
      uppercase: true,
      trim: true
    },
    /** Barcode / scan value for labels and scanners; defaults to manifestNo if omitted on create. */
    scanBar: {
      type: String,
      trim: true,
      uppercase: true
    },
    bagIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "CargoBag"
      }
    ],
    bagNumbers: [
      {
        type: String,
        uppercase: true,
        trim: true
      }
    ],
    consignmentNumbers: [
      {
        type: String,
        uppercase: true,
        trim: true
      }
    ],
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
    status: {
      type: String,
      enum: ["pending", "in-transit", "completed", "cancelled"],
      default: "pending"
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
    completedAt: Date
  },
  {
    timestamps: true
  }
);

cargoManifestSchema.index({ manifestNo: 1 });
cargoManifestSchema.index({ scanBar: 1 }, { unique: true, sparse: true });
cargoManifestSchema.index({ status: 1 });
cargoManifestSchema.index({ createdAt: -1 });

cargoManifestSchema.pre("save", function saveHook(next) {
  if (!this.manifestNo) {
    const stamp = Date.now().toString().slice(-8);
    const random = Math.floor(100 + Math.random() * 900);
    this.manifestNo = `MAN${stamp}${random}`;
  }
  const rawBar = this.scanBar != null ? String(this.scanBar).trim() : "";
  this.scanBar = rawBar ? rawBar.toUpperCase() : this.manifestNo;
  next();
});

module.exports = mongoose.model("CargoManifest", cargoManifestSchema);
