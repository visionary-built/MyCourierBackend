const RateCard = require('../models/RateCard');

// Create new rate rule
exports.createRateCard = async (req, res) => {
    try {
        const { serviceType, originCity, destinationCity, baseWeight, baseRate, additionalWeightUnit, additionalRate, isActive } = req.body;

        if (!serviceType || !originCity || !destinationCity || !baseWeight || !baseRate || !additionalWeightUnit || !additionalRate) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const newRate = new RateCard({
            serviceType: serviceType.toLowerCase(),
            originCity: originCity.toLowerCase(),
            destinationCity: destinationCity.toLowerCase(),
            baseWeight,
            baseRate,
            additionalWeightUnit,
            additionalRate,
            isActive
        });

        await newRate.save();
        res.status(201).json({ success: true, message: 'Rate rule created successfully', data: newRate });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ success: false, message: 'Rate rule for this combination already exists' });
        }
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// Get all rate rules with filters
exports.getAllRateCards = async (req, res) => {
    try {
        const { serviceType, originCity, destinationCity } = req.query;
        let query = {};

        if (serviceType) query.serviceType = serviceType.toLowerCase();
        if (originCity) query.originCity = originCity.toLowerCase();
        if (destinationCity) query.destinationCity = destinationCity.toLowerCase();

        const rates = await RateCard.find(query).sort({ updatedAt: -1 });
        res.status(200).json({ success: true, count: rates.length, data: rates });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// Update rate rule
exports.updateRateCard = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        // Ensure these are lowercase if provided
        if (updates.serviceType) updates.serviceType = updates.serviceType.toLowerCase();
        if (updates.originCity) updates.originCity = updates.originCity.toLowerCase();
        if (updates.destinationCity) updates.destinationCity = updates.destinationCity.toLowerCase();

        const updatedRate = await RateCard.findByIdAndUpdate(id, updates, { new: true, runValidators: true });

        if (!updatedRate) {
            return res.status(404).json({ success: false, message: 'Rate rule not found' });
        }

        res.status(200).json({ success: true, message: 'Rate rule updated successfully', data: updatedRate });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ success: false, message: 'Rate rule for this combination already exists' });
        }
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// Delete rate rule
exports.deleteRateCard = async (req, res) => {
    try {
        const { id } = req.params;
        const deletedRate = await RateCard.findByIdAndDelete(id);

        if (!deletedRate) {
            return res.status(404).json({ success: false, message: 'Rate rule not found' });
        }

        res.status(200).json({ success: true, message: 'Rate rule deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
};

// Pricing Engine function (exported for use in controllers)
exports.calculateCharges = (params) => {
    const { weight, baseWeight, baseRate, additionalWeightUnit, additionalRate } = params;
    
    // Minimum 1 base weight charge
    if (weight <= baseWeight) {
        return baseRate;
    }

    // Additional weight charge logic
    const extraWeight = weight - baseWeight;
    const additionalSteps = Math.ceil(extraWeight / additionalWeightUnit);
    const totalAdditionalRate = additionalSteps * additionalRate;

    return baseRate + totalAdditionalRate;
};
