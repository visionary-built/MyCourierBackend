const { body, validationResult } = require('express-validator');

const validateRider = [
  body('riderName')
    .trim()
    .notEmpty()
    .withMessage('Rider name is required')
    .isLength({ max: 100 })
    .withMessage('Rider name cannot exceed 100 characters'),
  
  body('riderCode')
    .trim()
    .notEmpty()
    .withMessage('Rider code is required')
    .isLength({ max: 20 })
    .withMessage('Rider code cannot exceed 20 characters'),
  
  body('soName')
    .trim()
    .notEmpty()
    .withMessage('S/o name is required')
    .isLength({ max: 100 })
    .withMessage('S/o name cannot exceed 100 characters'),
  
  body('mobileNo')
    .trim()
    .notEmpty()
    .withMessage('Mobile number is required')
    .matches(/^\d{10,15}$/)
    .withMessage('Please provide a valid mobile number (10-15 digits)'),
  
  body('cnicNo')
    .trim()
    .notEmpty()
    .withMessage('CNIC number is required')
    .matches(/^\d{13}$/)
    .withMessage('CNIC must be exactly 13 digits'),
  
  body('address')
    .trim()
    .notEmpty()
    .withMessage('Address is required')
    .isLength({ max: 500 })
    .withMessage('Address cannot exceed 500 characters'),
  
  body('emergencyContact')
    .trim()
    .notEmpty()
    .withMessage('Emergency contact is required')
    .isLength({ max: 500 })
    .withMessage('Emergency contact cannot exceed 500 characters'),
  
  body('active')
    .optional()
    .isBoolean()
    .withMessage('Active must be a boolean value'),

  // Optional password during creation; if provided, must meet minimum requirements
  body('password')
    .optional()
    .isString()
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters when provided')
];

const validateRiderLogin = [
  body('riderCode')
    .trim()
    .notEmpty()
    .withMessage('Rider code is required'),
  
  body('password')
    .trim()
    .notEmpty()
    .withMessage('Password is required')
];

const validateChangePassword = [
  body('currentPassword')
    .trim()
    .notEmpty()
    .withMessage('Current password is required'),
  
  body('newPassword')
    .trim()
    .notEmpty()
    .withMessage('New password is required')
    .isLength({ min: 6 })
    .withMessage('New password must be at least 6 characters long'),
  
  body('confirmPassword')
    .trim()
    .notEmpty()
    .withMessage('Confirm password is required')
    .custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error('New password and confirm password do not match');
      }
      return true;
    })
];

const validateRiderProfileUpdate = [
  body('mobileNo')
    .optional()
    .trim()
    .matches(/^\d{10,15}$/)
    .withMessage('Please provide a valid mobile number (10-15 digits)'),
  
  body('address')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Address cannot exceed 500 characters'),
  
  body('emergencyContact')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Emergency contact cannot exceed 500 characters')
];

const validateConsignmentNumber = (req, res, next) => {
  const consignmentNumber = req.params.consignmentNumber || req.params.consignmentNo;
  
  if (!consignmentNumber) {
    return res.status(400).json({
      success: false,
      message: 'Consignment number is required'
    });
  }

  // Basic format validation for consignment numbers
  const cnRegex = /^[A-Z0-9-]+$/i;
  if (!cnRegex.test(consignmentNumber)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid consignment number format'
    });
  }

  // Convert to uppercase for consistency
  req.params.consignmentNumber = consignmentNumber.toUpperCase();
  if (req.params.consignmentNo) {
    req.params.consignmentNo = consignmentNumber.toUpperCase();
  }

  next();
};

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      error: errors.array()[0].msg, 
      errors: errors.array() 
    });
  }
  next();
};

module.exports = {
  validateRider,
  validateRiderLogin,
  validateChangePassword,
  validateRiderProfileUpdate,
  validateConsignmentNumber,
  handleValidationErrors
};