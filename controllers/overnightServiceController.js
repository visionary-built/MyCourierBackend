// Simple in-memory configuration for Overnight Service
const overnightConfig = {
  name: 'Overnight Service',
  baseRateMultiplier: 1.5, // 50% extra
  priorityHandling: true,
  estimatedDeliveryDays: 1, // Next day delivery
  features: [
    'Fast delivery (next day)',
    'Priority handling',
    'Higher rate'
  ]
};

// GET /admin/services/overnight/config
// Returns the configuration used for overnight service
exports.getOvernightConfig = (req, res) => {
  try {
    res.status(200).json({
      success: true,
      data: overnightConfig
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server Error processing overnight service configuration',
      error: error.message
    });
  }
};

// POST /admin/services/overnight/calculate
// Calculates the estimated rate for an overnight service prior to booking
exports.calculateOvernightRate = (req, res) => {
  try {
    const { baseDeliveryCharges } = req.body;

    let estimatedRate = Number(baseDeliveryCharges) || 0;
    const breakdown = { baseCharges: estimatedRate };

    // Apply overnight multiplier
    estimatedRate = estimatedRate * overnightConfig.baseRateMultiplier;
    breakdown.priorityMarkup = `${(overnightConfig.baseRateMultiplier - 1) * 100}%`;

    res.status(200).json({
      success: true,
      data: {
        serviceType: 'overnight',
        estimatedRate,
        breakdown,
        features: overnightConfig.features
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server Error calculating overnight rate',
      error: error.message
    });
  }
};

