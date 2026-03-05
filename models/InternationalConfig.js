const mongoose = require('mongoose');

const InternationalConfigSchema = new mongoose.Schema({
  name: { type: String, default: 'International Service' },
  enabled: { type: Boolean, default: true },
  baseCurrency: { type: String, default: 'PKR' },
  countries: [
    {
      countryName: { type: String, required: true },
      countryCode: { type: String, required: true },
      baseRate: { type: Number, required: true },
      ratePerKg: { type: Number, required: true },
      estimatedDays: { type: String, default: '7-10 Days' },
      isActive: { type: Boolean, default: true }
    }
  ],
  customsConfigs: {
    insuranceRequired: { type: Boolean, default: true },
    maxDeclaredValue: { type: Number, default: 500000 }
  }
}, { timestamps: true });

module.exports = mongoose.model('InternationalConfig', InternationalConfigSchema);
