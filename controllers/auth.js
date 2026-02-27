const dotenv = require('dotenv');
dotenv.config();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

exports.adminLogin = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: "Email and password are required" });
        }

        if (email !== process.env.EMAIL) {
            return res.status(401).json({ message: "Invalid admin credentials" });
        }

        const passwordMatch = await bcrypt.compare(password, process.env.ADMIN_PASSWORD);
        if (!passwordMatch) {
            return res.status(401).json({ message: "Invalid admin credentials" });
        }

        const token = jwt.sign(
            { 
                email: process.env.EMAIL, 
                role: "admin",
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
            message: "Admin login successful",
            token
        });

    } catch (err) {
        console.error('Admin login error:', err);
        return res.status(500).json({ 
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