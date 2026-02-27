require('dotenv').config();
const express = require("express");
const mongoose = require('mongoose');
const cors = require('cors');
const app = express();
const adminRoutes = require('./routes/adminRoutes');
const customerRoutes = require('./routes/customerRoutes');
const riderRoutes = require('./routes/riderRoutes');
// JWT Secret from environment variables
const JWT_SECRET = process.env.JWT_SECRET;

// JWT utility functions
const jwt = require('jsonwebtoken');

const generateToken = (payload) => {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
};

const verifyToken = (token) => {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        throw new Error('Invalid token');
    }
};

// CORS middleware
app.use(cors({
  // origin: ['http://localhost:3000', 'https://tezlift-kappa.vercel.app'],
  origin: 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// JSON parsing middleware
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ limit: '50mb', extended: true })); 

app.get("/", (req, res) => {
    return res.json({ 
        message: "Courier Backend API is running",
        status: "success",
        timestamp: new Date().toISOString(),
        environment: 'development'
    });
});

app.get('/api/health', (req, res) => {
    const health = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: 'development'
    };
    res.json(health);
});


// Import Routes File

app.get('/api/test', (req, res) => {
  res.json({ success: true, message: 'Test route working!' });
});

// Admin Routes
app.use('/api/admin', adminRoutes);

// Customer Routes
app.use('/api/customer', customerRoutes);

// Rider Routes
app.use('/api/rider', riderRoutes);

// JWT test routes
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  // Simple authentication (replace with your actual auth logic)
  if (username === 'admin' && password === 'password') {
    const token = generateToken({ userId: 1, username: 'admin' });
    res.json({ 
      success: true, 
      message: 'Login successful',
      token 
    });
  } else {
    res.status(401).json({ 
      success: false, 
      message: 'Invalid credentials' 
    });
  }
});

// Public Routes
const publicRoutes = require('./routes/publicRoutes');
app.use('/api', publicRoutes);

app.get('/api/protected', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ 
      success: false, 
      message: 'No token provided' 
    });
  }
  
  try {
    const decoded = verifyToken(token);
    res.json({ 
      success: true, 
      message: 'Protected route accessed successfully',
      user: decoded 
    });
  } catch (error) {
    res.status(401).json({ 
      success: false, 
      message: 'Invalid token' 
    });
  }
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Global error handler:', err);
    
    // Handle multer errors specifically
    if (err.code === 'MISSING_FIELD_NAME') {
        return res.status(400).json({
            success: false,
            message: 'Field name missing. Please ensure the field name is set to "excelFile" in your form data',
            error: 'The file upload field name must be "excelFile"'
        });
    }
    
    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
            success: false,
            message: 'File too large. Maximum size is 10MB',
            error: err.message
        });
    }
    
    res.status(err.status || 500).json({ 
        success: false,
        message: 'Internal Server Error',
        error: err.message || 'Something went wrong'
    });
});

// Handle 404 errors
app.use('*', (req, res) => {
    res.status(404).json({ 
        success: false,
        message: 'Route not found' 
    });
});

// MongoDB Connection
const connectDB = async () => {
    try {
        const MONGODB_URI = process.env.MONGODB_URI;
        if (!MONGODB_URI) {
            console.log('⚠️  No MONGODB_URI found in environment variables. Skipping MongoDB connection.');
            return;
        }
        await mongoose.connect(MONGODB_URI);
        console.log('✅ MongoDB connected successfully');
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        console.log('⚠️  Continuing without MongoDB connection...');
        // Don't exit process, just log the error
    }
};

// Server startup
const startServer = async () => {
    // Connect to MongoDB first
    await connectDB();
    
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
        console.log('✅ Server is running on port', PORT);
    });
    
    // Handle server errors
    app.on('error', (error) => {
        console.error('❌ Server error:', error);
        if (error.code === 'EADDRINUSE') {
            console.error('Port is already in use. Please try a different port.');
        }
    });
};

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
});

startServer();
