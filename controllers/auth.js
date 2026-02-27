const dotenv = require('dotenv');
dotenv.config();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const UserAuth = require('../models/UserAuth');

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
            const adminRoles = ['superAdmin', 'admin', 'operation', 'codClient'];
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