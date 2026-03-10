const dotenv = require('dotenv');
dotenv.config();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const UserAuth = require('../models/UserAuth');
const Customer = require('../models/Customer');
const Rider = require('../models/Rider');

exports.adminLogin = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, message: "Email and password are required" });
        }

        // 1. Try to find user in database
        let user = await UserAuth.findOne({ email });
        let role = null;
        let userId = null;

        if (user) {
            // Check if user has an admin-related role
            const adminRoles = ['superAdmin', 'admin', 'operation', 'operationPortal', 'codClient'];
            if (!adminRoles.includes(user.role)) {
                return res.status(403).json({ success: false, message: "Not authorized as admin" });
            }

            const passwordMatch = await bcrypt.compare(password, user.password);
            if (!passwordMatch) {
                return res.status(401).json({ success: false, message: "Invalid credentials" });
            }
            role = user.role;
            userId = user._id;
        } else {
            // 2. Fallback to .env bootstrap credentials if no user in DB
            if (email === process.env.EMAIL) {
                const passwordMatch = await bcrypt.compare(password, process.env.ADMIN_PASSWORD);
                if (passwordMatch) {
                    role = "superAdmin";
                    userId = "bootstrap-admin";
                    
                    // Optional: Create the superAdmin user in DB if it doesn't exist
                    // This ensures the system transitions to DB-only smoothly
                    try {
                        const newSuperAdmin = new UserAuth({
                            email,
                            password: process.env.ADMIN_PASSWORD, // It's already hashed in .env
                            fullName: 'System Super Admin',
                            username: 'superadmin',
                            role: 'superAdmin',
                            isAdmin: true
                        });
                        await newSuperAdmin.save();
                        userId = newSuperAdmin._id;
                    } catch (saveErr) {
                        console.error('Failed to auto-create bootstrap superAdmin in DB:', saveErr.message);
                    }
                } else {
                    return res.status(401).json({ success: false, message: "Invalid credentials" });
                }
            } else {
                return res.status(401).json({ success: false, message: "Invalid credentials" });
            }
        }

        const token = jwt.sign(
            { 
                email, 
                role,
                id: userId,
                timestamp: Date.now()
            },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        return res.json({
            success: true,
            message: "Login successful",
            token,
            role,
            user: {
                email,
                role
            }
        });

    } catch (err) {
        console.error('Admin login error:', err);
        return res.status(500).json({ 
            success: false,
            message: "Internal server error",
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
};

exports.codClientLogin = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, message: "Email and password are required" });
        }

        let user = await UserAuth.findOne({ email });

        if (!user || user.role !== 'codClientPortal') {
            return res.status(401).json({ success: false, message: "Invalid credentials or unauthorized access" });
        }

        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ success: false, message: "Invalid credentials" });
        }

        const token = jwt.sign(
            { 
                email: user.email, 
                role: user.role,
                id: user._id,
                timestamp: Date.now()
            },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        return res.json({
            success: true,
            message: "Login successful",
            token,
            role: user.role,
            user: {
                id: user._id,
                email: user.email,
                fullName: user.fullName,
                username: user.username,
                role: user.role
            }
        });

    } catch (err) {
        console.error('COD Client login error:', err);
        return res.status(500).json({ 
            success: false,
            message: "Internal server error",
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
};

exports.operationPortalLogin = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, message: "Email and password are required" });
        }

        let user = await UserAuth.findOne({ email });

        if (!user || (user.role !== 'operationPortal' && user.role !== 'operation')) {
            return res.status(401).json({ success: false, message: "Invalid credentials or unauthorized access" });
        }

        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ success: false, message: "Invalid credentials" });
        }

        const token = jwt.sign(
            { 
                email: user.email, 
                role: user.role,
                id: user._id,
                timestamp: Date.now()
            },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        return res.json({
            success: true,
            message: "Login successful",
            token,
            role: user.role,
            user: {
                id: user._id,
                email: user.email,
                fullName: user.fullName,
                username: user.username,
                role: user.role
            }
        });

    } catch (err) {
        console.error('Operation Portal login error:', err);
        return res.status(500).json({ 
            success: false,
            message: "Internal server error",
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
};

// Unified login for Admin / Customer / Rider / Operation / COD Client
// Accepts: { email, password }
// - Admin / Operation / COD Client users are stored in UserAuth (email-based)
// - Customers are stored in Customer (email/username-based)
// - Riders are stored in Rider (identifier used as riderCode here)
exports.unifiedLogin = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, message: "Email and password are required" });
        }

        // 1) Try admin / operation / codClient users (UserAuth)
        let userAuth = await UserAuth.findOne({ email });
        if (userAuth) {
            const passwordMatch = await bcrypt.compare(password, userAuth.password);
            if (!passwordMatch) {
                return res.status(401).json({ success: false, message: "Invalid credentials" });
            }

            const role = userAuth.role;
            const adminToken = jwt.sign(
                { 
                    email: userAuth.email, 
                    role,
                    id: userAuth._id,
                    timestamp: Date.now()
                },
                process.env.JWT_SECRET,
                { expiresIn: "7d" }
            );

            return res.json({
                success: true,
                message: "Login successful",
                token: adminToken,
                role,
                userType: 'admin',
                user: {
                    id: userAuth._id,
                    email: userAuth.email,
                    fullName: userAuth.fullName,
                    username: userAuth.username,
                    role
                }
            });
        }

        // 2) Try customer portal (Customer model) - email or username
        const customer = await Customer.findOne({
            $or: [{ email }, { username: email }]
        });

        if (customer) {
            if (!customer.isActive) {
                return res.status(401).json({
                    success: false,
                    message: 'Account is not active. Please contact administrator.'
                });
            }

            const isPasswordValid = await bcrypt.compare(password, customer.password);
            if (!isPasswordValid) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid credentials'
                });
            }

            const JWT_SECRET = process.env.JWT_SECRET;
            const customerToken = jwt.sign(
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

            return res.json({
                success: true,
                message: 'Login successful',
                token: customerToken,
                role: 'customer',
                userType: 'customer',
                user: customerResponse
            });
        }

        // 3) Try rider portal (Rider model) - identifier treated as riderCode
        const rider = await Rider.findOne({ riderCode: email }).select('+password');

        if (rider) {
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
                    message: 'Invalid credentials'
                });
            }

            const riderToken = jwt.sign(
                { id: rider._id },
                process.env.JWT_SECRET || 'your-secret-key',
                { expiresIn: process.env.JWT_EXPIRE || '30d' }
            );

            return res.json({
                success: true,
                message: 'Login successful',
                token: riderToken,
                role: 'rider',
                userType: 'rider',
                user: {
                    id: rider._id,
                    riderName: rider.riderName,
                    riderCode: rider.riderCode,
                    mobileNo: rider.mobileNo,
                    active: rider.active
                }
            });
        }

        // If none matched
        return res.status(401).json({
            success: false,
            message: 'Invalid credentials'
        });
    } catch (err) {
        console.error('Unified login error:', err);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
};

exports.logout = (req, res) => {
    res.clearCookie('auth-token', {
        httpOnly: true, 
        sameSite: 'lax',
        path: '/',
        maxAge: 0
    });
    res.clearCookie('auth-token', {
        httpOnly: false,
        sameSite: 'lax',
        path: '/',
        maxAge: 0
    });
    res.clearCookie('admin-auth-token', {
        httpOnly: false, 
        sameSite: 'lax',
        path: '/',
        maxAge: 0
    });
    res.clearCookie('V_at', {
        sameSite: 'lax',
        path: '/',
        maxAge: 0
    });
    res.json({ message: 'Logged out successfully' });
};