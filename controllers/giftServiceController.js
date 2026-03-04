const GiftConfig = require("../models/GiftConfig");
const ManualBooking = require("../models/ManualBooking");

// Helper to get or create configuration
const getOrCreateConfig = async () => {
  let config = await GiftConfig.findOne();
  if (!config) {
    config = await GiftConfig.create({
      name: 'Gift Service',
      enabled: true,
      features: {
        specialPackaging: { available: true, price: 50 },
        handlingInstructions: { available: true },
        messageCard: { available: true, price: 20 }
      }
    });
  }
  return config;
};

// GET /admin/services/gift/config
exports.getGiftConfig = async (req, res) => {
  try {
    const config = await getOrCreateConfig();
    res.status(200).json({
      success: true,
      data: config
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server Error processing gift service configuration',
      error: error.message
    });
  }
};

// PUT /admin/services/gift/config
exports.updateGiftConfig = async (req, res) => {
  try {
    const { enabled, features } = req.body;
    let config = await getOrCreateConfig();

    if (enabled !== undefined) config.enabled = enabled;
    
    if (features) {
      if (features.specialPackaging) {
        config.features.specialPackaging = { ...config.features.specialPackaging, ...features.specialPackaging };
      }
      if (features.handlingInstructions) {
        config.features.handlingInstructions = { ...config.features.handlingInstructions, ...features.handlingInstructions };
      }
      if (features.messageCard) {
        config.features.messageCard = { ...config.features.messageCard, ...features.messageCard };
      }
    }

    await config.save();

    res.status(200).json({
      success: true,
      message: 'Gift Service configuration updated successfully',
      data: config
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server Error updating gift service configuration',
      error: error.message
    });
  }
};

// GET /admin/services/gift/bookings
exports.getGiftBookings = async (req, res) => {
  try {
    const bookings = await ManualBooking.find({ isGift: true })
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: bookings.length,
      data: bookings
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server Error fetching gift service bookings',
      error: error.message
    });
  }
};
