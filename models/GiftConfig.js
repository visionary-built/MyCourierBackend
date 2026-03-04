const mongoose = require('mongoose');

const GiftConfigSchema = new mongoose.Schema({
  name: { type: String, default: 'Gift Service' },
  enabled: { type: Boolean, default: true },
  features: {
    specialPackaging: {
      available: { type: Boolean, default: true },
      price: { type: Number, default: 50 }
    },
    handlingInstructions: {
      available: { type: Boolean, default: true }
    },
    messageCard: {
      available: { type: Boolean, default: true },
      price: { type: Number, default: 20 }
    }
  }
}, { timestamps: true });

module.exports = mongoose.model('GiftConfig', GiftConfigSchema);
