const jwt = require('jsonwebtoken');
const Customer = require('../models/Customer');
const Rider = require('../models/Rider');

// Middleware to verify customer token
const authenticateCustomer = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Support both payload shapes: { customerId } (current) or { id }
    const customerId = decoded.customerId || decoded.id || decoded._id;

    // Verify customer still exists and is active
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(401).json({
        success: false,
        message: 'Customer not found'
      });
    }

    if (!customer.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is not active'
      });
    }

    req.user = customer;
    req.userType = 'customer';
    req.customer = customer;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }
};

// Middleware to verify rider token
const authenticateRider = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');

    // Verify rider still exists and is active
    const rider = await Rider.findById(decoded.id);
    if (!rider) {
      return res.status(401).json({
        success: false,
        message: 'Rider not found'
      });
    }

    if (!rider.active) {
      return res.status(401).json({
        success: false,
        message: 'Account is not active'
      });
    }

    req.user = rider;
    req.userType = 'rider';
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }
};

// Middleware to verify admin token (for admin routes)
const authenticateAdmin = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');

    // For now, we'll use a simple admin check
    // In a real application, you'd have an Admin model
    if (decoded.username !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required'
      });
    }

    req.user = decoded;
    req.userType = 'admin';
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }
};



// Admin authentication middleware for admin routes
const adminAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ success: false, message: 'Malformed token' });
  }
  const token = parts[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Allow superAdmin, admin, operation, and codClient for general admin routes
    const allowedRoles = ['superAdmin', 'admin', 'operation', 'operationPortal', 'codClient', 'codClientPortal'];
    if (!allowedRoles.includes(decoded.role)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

// Super Admin only middleware
const superAdminAuth = (req, res, next) => {
  adminAuth(req, res, () => {
    if (!req.user || req.user.role !== 'superAdmin') {
      return res.status(403).json({ success: false, message: 'Super Admin access required' });
    }
    next();
  });
};

module.exports = {
  authenticateCustomer,
  authenticateRider,
  authenticateAdmin,
  adminAuth,
  superAdminAuth
};