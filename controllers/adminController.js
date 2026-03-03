const UserAuth = require('../models/UserAuth');
const bcrypt = require('bcrypt');

/**
 * Create a new Operation Portal user
 */
exports.createOperationPortal = async (req, res) => {
    req.body.role = 'operationPortal';
    return exports.createUser(req, res);
};

/**
 * Create a new COD Client Portal user
 */
exports.createCodPortal = async (req, res) => {
    req.body.role = 'codClientPortal';
    return exports.createUser(req, res);
};

/**
 * Create a new user with specific role (Admin, Operation, etc.)
 */
exports.createUser = async (req, res) => {
    try {
        console.log("Create User Payload:", req.body);
        const { fullName, username, email, password, role, phoneNumber } = req.body;
        const creatorRole = req.user.role;

        if (!email || !password || !role || !username) {
            return res.status(400).json({ 
                success: false, 
                message: "Email, password, role, and username are required" 
            });
        }

        // Validate role and permissions
        const allowedRoles = ['admin', 'operation', 'operationPortal', 'codClient', 'codClientPortal', 'superAdmin'];
        if (!allowedRoles.includes(role)) {
            return res.status(400).json({ 
                success: false, 
                message: "Invalid role specified" 
            });
        }

        // Permission check: Admin can only create operation and codClient portals
        if (creatorRole === 'admin' && !['operationPortal', 'codClientPortal'].includes(role)) {
            return res.status(403).json({ 
                success: false, 
                message: "Admins can only create Operation Portal and COD Client Portal users" 
            });
        }

        // Check if user already exists
        const existingUser = await UserAuth.findOne({ $or: [{ email }, { username }] });
        if (existingUser) {
            return res.status(400).json({ 
                success: false, 
                message: "User with this email or username already exists" 
            });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = new UserAuth({
            fullName,
            username,
            email,
            password: hashedPassword,
            phoneNumber,
            role,
            isAdmin: ['superAdmin', 'admin'].includes(role)
        });

        await newUser.save();

        res.status(201).json({
            success: true,
            message: `${role} created successfully`,
            user: {
                id: newUser._id,
                fullName: newUser.fullName,
                username: newUser.username,
                email: newUser.email,
                role: newUser.role
            }
        });

    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ 
            success: false, 
            message: "Internal server error",
            error: error.message 
        });
    }
};

/**
 * Get all users managed by Super Admin or Admin
 */
exports.getAllUsers = async (req, res) => {
    try {
        const { role } = req.query;
        const creatorRole = req.user.role;
        
        let query = {};
        
        if (creatorRole === 'superAdmin') {
            query.role = { $in: ['admin', 'operation', 'operationPortal', 'codClient', 'codClientPortal', 'superAdmin'] };
        } else {
            // Admins can only see operation and codClient users
            query.role = { $in: ['operation', 'operationPortal', 'codClient', 'codClientPortal'] };
        }
        
        if (role) {
            // Sanity check for admin role
            if (creatorRole === 'admin' && !['operationPortal', 'codClientPortal'].includes(role)) {
                return res.status(403).json({ success: false, message: "Access denied" });
            }
            query.role = role;
        }

        const users = await UserAuth.find(query).select('-password');

        res.json({
            success: true,
            users
        });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * Delete a user
 */
exports.deleteUser = async (req, res) => {
    try {
        const { id } = req.params;

        // Prevent deleting self if needed, or prevent deleting the bootstrap admin email
        const userToDelete = await UserAuth.findById(id);
        if (!userToDelete) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        if (userToDelete.email === process.env.EMAIL && userToDelete.role === 'superAdmin') {
            return res.status(403).json({ 
                success: false, 
                message: "Cannot delete the primary bootstrap Super Admin" 
            });
        }

        await UserAuth.findByIdAndDelete(id);

        res.json({
            success: true,
            message: "User deleted successfully"
        });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};

/**
 * Update an existing user's details (SuperAdmin & Admin only)
 */
exports.updateUser = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            fullName,
            username,
            email,
            password,
            role,
            phoneNumber
        } = req.body;

        const updaterRole = req.user.role;

        // Only superAdmin and admin can update users
        if (!['superAdmin', 'admin'].includes(updaterRole)) {
            return res.status(403).json({
                success: false,
                message: "Access denied"
            });
        }

        const userToUpdate = await UserAuth.findById(id);
        if (!userToUpdate) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        // Prevent non-superAdmin from modifying superAdmin/admin accounts
        if (
            updaterRole === 'admin' &&
            ['superAdmin', 'admin'].includes(userToUpdate.role)
        ) {
            return res.status(403).json({
                success: false,
                message: "Admins cannot modify Super Admin or Admin accounts"
            });
        }

        // Validate role if provided
        const allowedRoles = ['admin', 'operation', 'operationPortal', 'codClient', 'codClientPortal', 'superAdmin'];
        if (role && !allowedRoles.includes(role)) {
            return res.status(400).json({
                success: false,
                message: "Invalid role specified"
            });
        }

        // Admins can only assign certain roles
        if (
            updaterRole === 'admin' &&
            role &&
            !['operationPortal', 'codClientPortal'].includes(role)
        ) {
            return res.status(403).json({
                success: false,
                message: "Admins can only assign Operation Portal and COD Client Portal roles"
            });
        }

        // Ensure email/username are unique if changed
        if (email || username) {
            const conflictQuery = {
                _id: { $ne: id },
                $or: []
            };
            if (email) conflictQuery.$or.push({ email });
            if (username) conflictQuery.$or.push({ username });

            if (conflictQuery.$or.length > 0) {
                const existing = await UserAuth.findOne(conflictQuery);
                if (existing) {
                    return res.status(400).json({
                        success: false,
                        message: "Another user with this email or username already exists"
                    });
                }
            }
        }

        // Apply updates
        if (typeof fullName !== 'undefined') userToUpdate.fullName = fullName;
        if (typeof username !== 'undefined') userToUpdate.username = username;
        if (typeof email !== 'undefined') userToUpdate.email = email;
        if (typeof phoneNumber !== 'undefined') userToUpdate.phoneNumber = phoneNumber;

        if (password) {
            userToUpdate.password = await bcrypt.hash(password, 10);
        }

        if (role) {
            // Only superAdmin can promote/demote to/from admin/superAdmin
            if (
                updaterRole !== 'superAdmin' &&
                ['admin', 'superAdmin'].includes(role)
            ) {
                return res.status(403).json({
                    success: false,
                    message: "Only Super Admin can assign Admin or Super Admin roles"
                });
            }
            userToUpdate.role = role;
            userToUpdate.isAdmin = ['superAdmin', 'admin'].includes(role);
        }

        await userToUpdate.save();

        const sanitizedUser = userToUpdate.toObject();
        delete sanitizedUser.password;

        res.json({
            success: true,
            message: "User updated successfully",
            user: sanitizedUser
        });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        });
    }
};
