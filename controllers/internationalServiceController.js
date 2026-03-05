const InternationalConfig = require("../models/InternationalConfig");
const ManualBooking = require("../models/ManualBooking");

// Helper to get or create configuration
const getOrCreateConfig = async () => {
  let config = await InternationalConfig.findOne();
  if (!config) {
    config = await InternationalConfig.create({
      name: 'International Service',
      enabled: true,
      countries: [
        { countryName: 'United States', countryCode: 'US', baseRate: 5000, ratePerKg: 1500, estimatedDays: '7-10 Days' },
        { countryName: 'United Kingdom', countryCode: 'GB', baseRate: 4000, ratePerKg: 1200, estimatedDays: '5-7 Days' },
        { countryName: 'United Arab Emirates', countryCode: 'AE', baseRate: 2000, ratePerKg: 800, estimatedDays: '3-5 Days' }
      ]
    });
  }
  return config;
};

// GET /admin/services/international/config
exports.getInternationalConfig = async (req, res) => {
  try {
    const config = await getOrCreateConfig();
    res.status(200).json({
      success: true,
      data: config
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server Error fetching international configuration',
      error: error.message
    });
  }
};

// PUT /admin/services/international/config
exports.updateInternationalConfig = async (req, res) => {
  try {
    const { enabled, countries, customsConfigs } = req.body;
    let config = await getOrCreateConfig();

    if (enabled !== undefined) config.enabled = enabled;
    if (countries) config.countries = countries;
    if (customsConfigs) config.customsConfigs = { ...config.customsConfigs, ...customsConfigs };

    await config.save();
    res.status(200).json({
      success: true,
      message: 'International configuration updated successfully',
      data: config
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server Error updating international configuration',
      error: error.message
    });
  }
};

// GET /admin/services/international/bookings
exports.getInternationalBookings = async (req, res) => {
  try {
    const bookings = await ManualBooking.find({ isInternational: true })
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: bookings.length,
      data: bookings
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server Error fetching international bookings',
      error: error.message
    });
  }
};
