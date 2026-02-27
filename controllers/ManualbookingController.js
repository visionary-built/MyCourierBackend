const mongoose = require('mongoose');
const ManualBooking = require("../models/ManualBooking");
const BookingStatus = require("../models/bookingStatus");
const XLSX = require('xlsx');

// Create a booking (Admin or Customer)
exports.createBooking = async (req, res) => {
  try {
    const {
      customerId: bodyCustomerId,
      serviceType,
      originCity,
      destinationCity,
      consigneeName,
      consigneeMobile,
      consigneeEmail,
      consigneeAddress,
      date,
      weight,
      codAmount,
      customerReferenceNo,
      pieces,
      fragile,
      deliveryCharges,
      productDetail,
      remarks
    } = req.body;

    // Determine who is creating the booking
    const createdBy = req.user && req.user.role === "customer" ? "customer" : "admin";

    let finalCustomerId;
    
    // If customer is creating their own booking, use their ID
    if (req.user && req.user.role === "customer") {
      finalCustomerId = req.user._id;
    } else if (bodyCustomerId) {
      // If admin is creating booking for a customer
      finalCustomerId = bodyCustomerId;
    } else {
      return res.status(400).json({
        success: false,
        message: "Customer is required"
      });
    }

    // Use actual user info if available, otherwise fallback to mock data
    const userInfo = {
      accountNo: (req.user && req.user.accountNo) || "TEST-ACCOUNT",
      username: (req.user && req.user.username) || "test-admin",
      name: (req.user && req.user.name) || "Test Admin"
    };

    if (!serviceType || !originCity || !destinationCity || !consigneeName || !consigneeMobile || !weight) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields"
      });
    }

    const newBooking = new ManualBooking({
      customerId: finalCustomerId,
      createdBy,
      serviceType,
      originCity,
      destinationCity,
      consigneeName,
      consigneeMobile,
      consigneeEmail,
      consigneeAddress,
      date,
      weight,
      codAmount,
      customerReferenceNo,
      pieces,
      fragile,
      deliveryCharges,
      productDetail,
      remarks
    });

    await newBooking.save();

    try {
      const bookingStatus = new BookingStatus({
        consignmentNumber: newBooking.consignmentNo,
        destinationCity: newBooking.destinationCity,
        accountNo: userInfo.accountNo,
        agentName: userInfo.name || userInfo.username,
        status: "pending",
        bookingDate: newBooking.date || new Date(),
        remarks: `Created via ${createdBy === "admin" ? "Admin" : "Customer"} portal`
      });

      await bookingStatus.save();
    } catch (statusError) {
      console.error("Error creating booking status:", statusError.message);
    }

    res.status(201).json({
      success: true,
      message: "Booking created successfully",
      data: newBooking
    });

  } catch (error) {
    console.error("Error creating booking:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
};


// Get all bookings (Admin) or user's bookings (Customer)
exports.getAllBookings = async (req, res) => {
  try {
    let query = {};
    
    // If user is a customer, only show their bookings
    if (req.user && req.user.role === "customer") {
      query.customerId = req.user._id;
    }
    
    // For admin users, show all bookings (no additional filtering needed)
    
    const bookings = await ManualBooking.find(query)
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: bookings.length,
      data: bookings
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Get booking by ID
exports.getBookingById = async (req, res) => {
  try {
    const { id } = req.params;
    let query = { _id: id };

    if (req.user.role === "customer") {
      query.customerId = req.user._id;
    }

    const booking = await ManualBooking.findOne(query);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found or access denied"
      });
    }

    res.status(200).json({
      success: true,
      data: booking
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Get booking by consignment number
exports.getBookingByConsignmentNo = async (req, res) => {
  try {
    const { consignmentNo } = req.params;
    let query = { consignmentNo };

    if (req.user.role === "customer") {
      query.customerId = req.user._id;
    }

    const booking = await ManualBooking.findOne(query);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found or access denied"
      });
    }

    res.status(200).json({
      success: true,
      data: booking
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Update booking
exports.updateBooking = async (req, res) => {
  try {
    const { id } = req.params;
    let query = { _id: id };

    if (req.user.role === "customer") {
      query.customerId = req.user._id;
    }

    const booking = await ManualBooking.findOne(query);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found or access denied"
      });
    }

    const allowedUpdates = [
      'serviceType', 'originCity', 'destinationCity', 'consigneeName',
      'consigneeMobile', 'consigneeEmail', 'consigneeAddress', 'date',
      'weight', 'codAmount', 'customerReferenceNo', 'pieces', 'fragile',
      'deliveryCharges', 'productDetail', 'remarks', 'status'
    ];

    if (req.user.role !== "admin") {
      delete req.body.customerId;
      delete req.body.status;
      delete req.body.consignmentNo;
    }

    const updates = {};
    Object.keys(req.body).forEach(key => {
      if (allowedUpdates.includes(key)) {
        updates[key] = req.body[key];
      }
    });

    const updatedBooking = await ManualBooking.findByIdAndUpdate(
      id,
      updates,
      { new: true, runValidators: true }
    );

    if (updatedBooking.consignmentNo) {
      try {
        const bookingStatusUpdates = {};

        if (updates.destinationCity) {
          bookingStatusUpdates.destinationCity = updates.destinationCity;
        }

        if (updates.status) {
          bookingStatusUpdates.status = updates.status;
          if (updates.status === 'delivered') {
            bookingStatusUpdates.deliveryDate = new Date();
          }
        }

        if (Object.keys(bookingStatusUpdates).length > 0) {
          await BookingStatus.findOneAndUpdate(
            { consignmentNumber: updatedBooking.consignmentNo },
            bookingStatusUpdates
          );
        }
      } catch (statusError) {
        console.error("Error updating booking status:", statusError);
      }
    }

    res.status(200).json({
      success: true,
      message: "Booking updated successfully",
      data: updatedBooking
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Delete booking
exports.deleteBooking = async (req, res) => {
  try {
    const { id } = req.params;
    let query = { _id: id };

    if (req.user.role === "customer") {
      query.customerId = req.user._id;
    }

    const booking = await ManualBooking.findOne(query);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found or access denied"
      });
    }

    const consignmentNo = booking.consignmentNo;

    await ManualBooking.findByIdAndDelete(id);

    if (consignmentNo) {
      try {
        await BookingStatus.findOneAndDelete({ consignmentNumber: consignmentNo });
      } catch (statusError) {
        console.error("Error deleting booking status:", statusError);
      }
    }

    res.status(200).json({
      success: true,
      message: "Booking deleted successfully"
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Get bookings with filters and pagination
exports.getBookingsWithFilters = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      serviceType,
      originCity,
      destinationCity,
      createdBy,
      startDate,
      endDate
    } = req.query;

    let query = {};

    // If user is a customer, only show their bookings
    if (req.user && req.user.role === "customer") {
      query.customerId = req.user._id;
    }
    
    // For admin users, show all bookings (no additional filtering needed)

    if (status) query.status = status;
    if (serviceType) query.serviceType = serviceType;
    if (originCity) query.originCity = new RegExp(originCity, 'i');
    if (destinationCity) query.destinationCity = new RegExp(destinationCity, 'i');
    if (createdBy) query.createdBy = createdBy;

    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { createdAt: -1 }
    };

    const bookings = await ManualBooking.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await ManualBooking.countDocuments(query);

    res.status(200).json({
      success: true,
      count: bookings.length,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      data: bookings
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error", error: error.message });
  }
};

// Bulk import bookings from Excel file
exports.bulkImportBookings = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded. Please ensure the field name is 'excelFile'"
      });
    }

    // Validate file type
    const allowedTypes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 
                         'application/vnd.ms-excel'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: "Invalid file type. Only Excel files (.xlsx, .xls) are allowed"
      });
    }

    // Determine who is creating the bookings
    const createdBy = req.user && req.user.role === "customer" ? "customer" : "admin";
    let finalCustomerId;
    
    // If customer is creating their own bookings, use their ID
    if (req.user && req.user.role === "customer") {
      finalCustomerId = req.user._id;
    } else if (req.body.customerId) {
      // If admin is creating bookings for a customer
      finalCustomerId = req.body.customerId;
    } else {
      // For testing purposes, use a default customer ID if none provided
      finalCustomerId = req.body.customerId || "test-customer-id";
      console.log("Warning: Using default customer ID for bulk import:", finalCustomerId);
    }

    // Use actual user info if available, otherwise fallback to mock data
    const userInfo = {
      accountNo: (req.user && req.user.accountNo) || "TEST-ACCOUNT",
      username: (req.user && req.user.username) || "test-admin",
      name: (req.user && req.user.name) || "Test Admin"
    };

    // Read Excel file
    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet);

    if (jsonData.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Excel file is empty or invalid"
      });
    }

    // Expected columns based on requirements
    const expectedColumns = [
      'Consignee Mobile No',
      'Consignee Name', 
      'Consignee Address',
      'Destination City',
      'Weight',
      'Pieces',
      'COD Amount',
      'Product Detail',
      'Remarks',
      'Fragile'
    ];

    // Validate required columns exist
    const firstRow = jsonData[0];
    const missingColumns = expectedColumns.filter(col => !(col in firstRow));
    
    if (missingColumns.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required columns: ${missingColumns.join(', ')}`,
        expectedColumns: expectedColumns
      });
    }

    const results = {
      total: jsonData.length,
      successful: 0,
      failed: 0,
      errors: [],
      createdBookings: []
    };

    // Process each row
    for (let i = 0; i < jsonData.length; i++) {
      const row = jsonData[i];
      const rowNumber = i + 2; // +2 because Excel is 1-indexed and we skip header

      try {
        // Validate required fields
        const requiredFields = [
          'Consignee Mobile No',
          'Consignee Name',
          'Consignee Address', 
          'Destination City',
          'Weight',
          'Pieces',
          'COD Amount',
          'Product Detail'
        ];

        const missingFields = requiredFields.filter(field => 
          !row[field] || row[field].toString().trim() === ''
        );

        if (missingFields.length > 0) {
          results.failed++;
          results.errors.push({
            row: rowNumber,
            error: `Missing required fields: ${missingFields.join(', ')}`
          });
          continue;
        }

        // Parse and validate data types
        const weight = parseFloat(row['Weight']);
        const pieces = parseInt(row['Pieces']);
        const codAmount = parseFloat(row['COD Amount']) || 0;
        const fragile = row['Fragile'] ? (
          row['Fragile'].toString().toLowerCase() === 'true' || 
          row['Fragile'].toString().toLowerCase() === 'yes' ||
          row['Fragile'].toString() === '1'
        ) : false;

        if (isNaN(weight) || weight <= 0) {
          results.failed++;
          results.errors.push({
            row: rowNumber,
            error: 'Weight must be a valid positive number'
          });
          continue;
        }

        if (isNaN(pieces) || pieces <= 0) {
          results.failed++;
          results.errors.push({
            row: rowNumber,
            error: 'Pieces must be a valid positive integer'
          });
          continue;
        }

        if (isNaN(codAmount) || codAmount < 0) {
          results.failed++;
          results.errors.push({
            row: rowNumber,
            error: 'COD Amount must be a valid non-negative number'
          });
          continue;
        }

        // Create booking object
        const bookingData = {
          customerId: finalCustomerId,
          createdBy,
          serviceType: req.body.serviceType || 'standard', // Default service type
          originCity: req.body.originCity || 'Unknown', // Default origin city
          destinationCity: row['Destination City'].toString().trim(),
          consigneeName: row['Consignee Name'].toString().trim(),
          consigneeMobile: row['Consignee Mobile No'].toString().trim(),
          consigneeEmail: '', // Not provided in Excel format
          consigneeAddress: row['Consignee Address'].toString().trim(),
          date: new Date(),
          weight: weight,
          codAmount: codAmount,
          customerReferenceNo: '', // Not provided in Excel format
          pieces: pieces,
          fragile: fragile,
          deliveryCharges: 0, // Default value
          productDetail: row['Product Detail'].toString().trim(),
          remarks: row['Remarks'] ? row['Remarks'].toString().trim() : ''
        };

        // Create booking
        const newBooking = new ManualBooking(bookingData);
        await newBooking.save();

        // Create booking status
        try {
          const bookingStatus = new BookingStatus({
            consignmentNumber: newBooking.consignmentNo,
            destinationCity: newBooking.destinationCity,
            accountNo: userInfo.accountNo,
            agentName: userInfo.name || userInfo.username,
            status: "pending",
            bookingDate: newBooking.date || new Date(),
            remarks: `Bulk imported via ${createdBy === "admin" ? "Admin" : "Customer"} portal`
          });

          await bookingStatus.save();
        } catch (statusError) {
          console.error("Error creating booking status for row", rowNumber, ":", statusError.message);
        }

        results.successful++;
        results.createdBookings.push({
          consignmentNo: newBooking.consignmentNo,
          consigneeName: newBooking.consigneeName,
          destinationCity: newBooking.destinationCity
        });

      } catch (error) {
        results.failed++;
        results.errors.push({
          row: rowNumber,
          error: error.message
        });
        console.error(`Error processing row ${rowNumber}:`, error);
      }
    }

    // Clean up uploaded file
    const fs = require('fs');
    try {
      fs.unlinkSync(req.file.path);
    } catch (cleanupError) {
      console.error("Error cleaning up uploaded file:", cleanupError);
    }

    res.status(200).json({
      success: true,
      message: `Bulk import completed. ${results.successful} successful, ${results.failed} failed`,
      data: results
    });

  } catch (error) {
    console.error("Error in bulk import:", error);
    res.status(500).json({
      success: false,
      message: "Server error during bulk import",
      error: error.message
    });
  }
};
