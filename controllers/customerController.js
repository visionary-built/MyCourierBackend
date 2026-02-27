const Customer = require('../models/Customer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Create new customer
exports.createCustomer = async (req, res) => {
  try {
    console.log('Create customer request received:', JSON.stringify(req.body, null, 2));
    console.log('Request headers:', req.headers);

    const {
      email, password, confirmPassword, address, contactPerson,
      'User Name': userName,
      'Contact No': contactNo,
      'CNIC No': cnicNo,
      'Bank Name': bankName,
      'Bank A/C Title': bankAccountTitle,
      'Bank A/C No': bankAccountNo,
      'Bank IBN No': bankIBNNo,
      'Brand Name': brandName,
      'Active': isActive,
      username, contactNo: contactNoBackend, cnicNo: cnicNoBackend,
      bankName: bankNameBackend, bankAccountTitle: bankAccountTitleBackend,
      bankAccountNo: bankAccountNoBackend, bankIBNNo: bankIBNNoBackend,
      brandName: brandNameBackend, isActive: isActiveBackend,
      invoices
    } = req.body;

    const finalUsername = userName || username;
    const finalContactNo = contactNo || contactNoBackend;
    const finalCnicNo = cnicNo || cnicNoBackend;
    const finalBankName = bankName || bankNameBackend;
    const finalBankAccountTitle = bankAccountTitle || bankAccountTitleBackend;
    const finalBankAccountNo = bankAccountNo || bankAccountNoBackend;
    const finalBankIBNNo = bankIBNNo || bankIBNNoBackend;
    const finalBrandName = brandName || brandNameBackend;
    const finalIsActive = isActive === 'YES' || isActive === true || isActiveBackend || false;

    const city = req.body.city || 'Default City';
    const serialNo = req.body.serialNo || `SN${Date.now()}`;
    const accountNo = req.body.accountNo || `ACC${Date.now()}`;

    if (!finalUsername || !email || !password || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Username, email, password, and confirm password are required'
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Password and confirm password do not match'
      });
    }

    const existingCustomer = await Customer.findOne({
      $or: [{ email }, { username: finalUsername }, { accountNo }]
    });

    if (existingCustomer) {
      return res.status(400).json({
        success: false,
        message: 'Customer with this email, username, or account number already exists'
      });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const customerData = {
      city,
      serialNo,
      accountNo,
      username: finalUsername,
      email,
      password: hashedPassword,
      confirmPassword: hashedPassword,
      contactNo: finalContactNo,
      cnicNo: finalCnicNo,
      bankName: finalBankName,
      bankAccountTitle: finalBankAccountTitle,
      bankAccountNo: finalBankAccountNo,
      bankIBNNo: finalBankIBNNo,
      address,
      contactPerson,
      brandName: finalBrandName,
      isActive: finalIsActive,
      invoices: invoices || []
    };

    const customer = new Customer(customerData);
    await customer.save();

    const customerResponse = customer.toObject();
    delete customerResponse.password;
    delete customerResponse.confirmPassword;

    console.log('Customer created successfully:', customerResponse._id);

    return res.status(201).json({
      success: true,
      message: 'Customer created successfully',
      data: customerResponse
    });
  } catch (error) {
    console.error('Create customer error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Customer login
exports.customerLogin = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required'
      });
    }

    const customer = await Customer.findOne({
      $or: [{ username }, { email: username }]
    });

    if (!customer) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    if (!customer.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is not active. Please contact administrator.'
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, customer.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Generate JWT token
    const JWT_SECRET = process.env.JWT_SECRET;
    const token = jwt.sign(
      {
        customerId: customer._id,
        username: customer.username,
        accountNo: customer.accountNo,
        type: 'customer'
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    const customerResponse = customer.toObject();
    delete customerResponse.password;
    delete customerResponse.confirmPassword;

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      data: customerResponse
    });
  } catch (error) {
    console.error('Customer login error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Get all customers
exports.getAllCustomers = async (req, res) => {
  try {
    const customers = await Customer.find().select('-password -confirmPassword');
    res.status(200).json({ success: true, data: customers });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get single customer
exports.getCustomerById = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id).select('-password -confirmPassword');
    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
    res.status(200).json({ success: true, data: customer });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Update customer
exports.updateCustomer = async (req, res) => {
  try {
    const updateData = { ...req.body };

    if (updateData.password) {
      const saltRounds = 10;
      updateData.password = await bcrypt.hash(updateData.password, saltRounds);
      updateData.confirmPassword = updateData.password;
    }

    const customer = await Customer.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ).select('-password -confirmPassword');

    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
    res.status(200).json({ success: true, data: customer });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Delete customer
exports.deleteCustomer = async (req, res) => {
  try {
    await Customer.findByIdAndDelete(req.params.id);
    res.status(200).json({ success: true, message: 'Customer deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// Get customer profile (requires authentication)
exports.getCustomerProfile = async (req, res) => {
  try {
    const customer = await Customer.findById(req.customer._id).select('-password -confirmPassword');
    res.status(200).json({
      success: true,
      data: customer
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Update customer profile (requires authentication)
exports.updateCustomerProfile = async (req, res) => {
  try {
    const updateData = { ...req.body };

    delete updateData.isActive;
    delete updateData.accountNo;
    delete updateData.serialNo;

    const customer = await Customer.findByIdAndUpdate(
      req.customer._id,
      updateData,
      { new: true }
    ).select('-password -confirmPassword');

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: customer
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Get customer invoices (requires authentication)
exports.getCustomerInvoices = async (req, res) => {
  try {
    const customer = await Customer.findById(req.customer._id);
    res.status(200).json({
      success: true,
      data: customer.invoices
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
