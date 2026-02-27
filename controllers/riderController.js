const Rider = require('../models/Rider');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'your-secret-key', {
    expiresIn: process.env.JWT_EXPIRE || '30d'
  });
};

const sendTokenResponse = (rider, statusCode, res, message = 'Success') => {
  const token = generateToken(rider._id);

  res.status(statusCode).json({
    success: true,
    message,
    data: {
      rider: {
        id: rider._id,
        riderName: rider.riderName,
        riderCode: rider.riderCode,
        mobileNo: rider.mobileNo,
        active: rider.active
      },
      token
    }
  });
};

exports.createRider = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        error: errors.array()[0].msg,
        errors: errors.array()
      });
    }

    const {
      riderName,
      riderCode,
      soName,
      mobileNo,
      cnicNo,
      address,
      emergencyContact,
      active = true,
      password
    } = req.body;

    const defaultPassword = `${riderCode}${cnicNo.slice(-4)}`;
    const finalPassword = password && String(password).length >= 6 ? String(password) : defaultPassword;
    const usedDefaultPassword = finalPassword === defaultPassword;

    const rider = await Rider.create({
      riderName,
      riderCode,
      soName,
      mobileNo,
      cnicNo,
      address,
      emergencyContact,
      active,
      password: finalPassword
    });

    res.status(201).json({
      success: true,
      message: 'Rider created successfully',
      data: {
        rider,
        ...(usedDefaultPassword ? { defaultPassword } : {}),
        loginInstructions: usedDefaultPassword
          ? `Rider can login with Rider Code: ${riderCode} and Password: ${defaultPassword}`
          : 'Rider can login with the password provided during creation'
      }
    });

  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      const value = error.keyValue[field];
      return res.status(400).json({
        success: false,
        message: `${field.charAt(0).toUpperCase() + field.slice(1)} '${value}' already exists`,
        error: `${field.charAt(0).toUpperCase() + field.slice(1)} '${value}' already exists`
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

exports.getAllRiders = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const startIndex = (page - 1) * limit;
    const search = req.query.search || '';
    const status = req.query.status; 

    let query = {};

    if (search) {
      query.$or = [
        { riderName: { $regex: search, $options: 'i' } },
        { riderCode: { $regex: search, $options: 'i' } },
        { soName: { $regex: search, $options: 'i' } },
        { mobileNo: { $regex: search, $options: 'i' } },
        { cnicNo: { $regex: search, $options: 'i' } },
        { address: { $regex: search, $options: 'i' } }
      ];
    }

    if (status !== undefined) {
      query.active = status === 'active';
    }

    const total = await Rider.countDocuments(query);
    const riders = await Rider.find(query)
      .skip(startIndex)
      .limit(limit)
      .sort({ createdAt: -1 });

    const totalPages = Math.ceil(total / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    res.status(200).json({
      success: true,
      count: riders.length,
      total,
      pagination: {
        page,
        limit,
        totalPages,
        hasNextPage,
        hasPrevPage,
        nextPage: hasNextPage ? page + 1 : null,
        prevPage: hasPrevPage ? page - 1 : null
      },
      data: riders
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

exports.getRider = async (req, res) => {
  try {
    const rider = await Rider.findById(req.params.id);

    if (!rider) {
      return res.status(404).json({
        success: false,
        message: 'Rider not found'
      });
    }

    res.status(200).json({
      success: true,
      data: rider
    });

  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Rider not found'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

exports.updateRider = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const rider = await Rider.findByIdAndUpdate(
      req.params.id,
      req.body,
      {
        new: true,
        runValidators: true,
        context: 'query'
      }
    );

    if (!rider) {
      return res.status(404).json({
        success: false,
        message: 'Rider not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Rider updated successfully',
      data: rider
    });

  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      const value = error.keyValue[field];
      return res.status(400).json({
        success: false,
        message: `${field.charAt(0).toUpperCase() + field.slice(1)} '${value}' already exists`
      });
    }

    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Rider not found'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};


exports.toggleRiderStatus = async (req, res) => {
  try {
    const rider = await Rider.findById(req.params.id);

    if (!rider) {
      return res.status(404).json({
        success: false,
        message: 'Rider not found'
      });
    }

    rider.active = !rider.active;
    await rider.save();

    res.status(200).json({
      success: true,
      message: `Rider ${rider.active ? 'activated' : 'deactivated'} successfully`,
      data: rider
    });

  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Rider not found'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};


exports.deleteRider = async (req, res) => {
  try {
    const rider = await Rider.findByIdAndDelete(req.params.id);

    if (!rider) {
      return res.status(404).json({
        success: false,
        message: 'Rider not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Rider deleted successfully',
      data: {
        deletedRider: {
          id: rider._id,
          riderName: rider.riderName,
          riderCode: rider.riderCode
        }
      }
    });

  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Rider not found'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};


exports.resetRiderPassword = async (req, res) => {
  try {
    const rider = await Rider.findById(req.params.id);

    if (!rider) {
      return res.status(404).json({
        success: false,
        message: 'Rider not found'
      });
    }

    const newPassword = `${rider.riderCode}${rider.cnicNo.slice(-4)}`;
    rider.password = newPassword;
    await rider.save();

    res.status(200).json({
      success: true,
      message: 'Password reset successfully',
      data: {
        riderCode: rider.riderCode,
        newPassword,
        loginInstructions: `Rider can login with Rider Code: ${rider.riderCode} and new Password: ${newPassword}`
      }
    });

  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Rider not found'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};


exports.riderLogin = async (req, res) => {
  try {
    const { riderCode, password } = req.body;

    if (!riderCode || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide rider code and password'
      });
    }

    const rider = await Rider.findOne({ riderCode }).select('+password');

    if (!rider) {
      return res.status(401).json({
        success: false,
        message: 'Invalid rider code or password'
      });
    }

    if (!rider.active) {
      return res.status(401).json({
        success: false,
        message: 'Your account has been deactivated. Please contact admin.'
      });
    }

    const isMatch = await rider.comparePassword(password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid rider code or password'
      });
    }

    sendTokenResponse(rider, 200, res, 'Login successful');

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};


exports.getRiderProfile = async (req, res) => {
  try {
    const rider = await Rider.findById(req.user.id);

    if (!rider) {
      return res.status(404).json({
        success: false,
        message: 'Rider not found'
      });
    }

    res.status(200).json({
      success: true,
      data: rider
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

exports.updateRiderProfile = async (req, res) => {
  try {
    const allowedFields = ['mobileNo', 'address', 'emergencyContact'];
    const updates = {};

    Object.keys(req.body).forEach(key => {
      if (allowedFields.includes(key)) {
        updates[key] = req.body[key];
      }
    });

    if (updates.mobileNo && !/^\d{10,15}$/.test(updates.mobileNo)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid mobile number (10-15 digits)'
      });
    }

    const rider = await Rider.findByIdAndUpdate(
      req.user.id,
      updates,
      {
        new: true,
        runValidators: true,
        context: 'query'
      }
    );

    if (!rider) {
      return res.status(404).json({
        success: false,
        message: 'Rider not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: rider
    });

  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({
        success: false,
        message: `${field.charAt(0).toUpperCase() + field.slice(1)} already exists`
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};


exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Please provide current password, new password, and confirm password'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password and confirm password do not match'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long'
      });
    }

    const rider = await Rider.findById(req.user.id).select('+password');

    if (!rider) {
      return res.status(404).json({
        success: false,
        message: 'Rider not found'
      });
    }

    const isMatch = await rider.comparePassword(currentPassword);

    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    rider.password = newPassword;
    await rider.save();

    res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};