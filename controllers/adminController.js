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
        const { 
            fullName, username, email, password, role, phoneNumber,
            companyName, address, contactPerson, creditLimit, paymentTerms, clientId,
            specialRates
        } = req.body;
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

        // Permission check: Admin and superAdmin can create any admin-related roles
        if (!['superAdmin', 'admin'].includes(creatorRole)) {
            return res.status(403).json({ 
                success: false, 
                message: "Access denied" 
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
            companyName,
            address,
            contactPerson,
            creditLimit,
            paymentTerms,
            clientId,
            specialRates,
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
        
        if (['superAdmin', 'admin'].includes(creatorRole)) {
            query.role = { $in: ['admin', 'operation', 'operationPortal', 'codClient', 'codClientPortal', 'superAdmin'] };
        } else {
            // Other roles can't see users
            return res.status(403).json({ success: false, message: "Access denied" });
        }
        
        if (role) {
            // Sanity check for roles: allow admin and superAdmin to filter any role.
            if (!['superAdmin', 'admin'].includes(creatorRole)) {
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
            phoneNumber,
            companyName,
            address,
            contactPerson,
            creditLimit,
            paymentTerms,
            clientId,
            specialRates
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

        // Both superAdmin and admin can modify any account.
        // We only protect the primary bootstrap admin account.
        if (
            userToUpdate.email === process.env.EMAIL && 
            userToUpdate.role === 'superAdmin' &&
            updaterRole !== 'superAdmin'
        ) {
            return res.status(403).json({
                success: false,
                message: "Only the primary Super Admin can modify the bootstrap account"
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

        // Both admin and superAdmin can assign any role
        if (
            !['superAdmin', 'admin'].includes(updaterRole) &&
            role
        ) {
            return res.status(403).json({
                success: false,
                message: "Access denied"
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
            // Only allow superAdmin or admin to assign these roles
            if (
                !['superAdmin', 'admin'].includes(updaterRole) &&
                ['admin', 'superAdmin'].includes(role)
            ) {
                return res.status(403).json({
                    success: false,
                    message: "Only an Admin or Super Admin can assign these roles"
                });
            }
            userToUpdate.role = role;
            userToUpdate.isAdmin = ['superAdmin', 'admin'].includes(role);
        }

        // Business & Pricing Fields
        if (typeof companyName !== 'undefined') userToUpdate.companyName = companyName;
        if (typeof address !== 'undefined') userToUpdate.address = address;
        if (typeof contactPerson !== 'undefined') userToUpdate.contactPerson = contactPerson;
        if (typeof creditLimit !== 'undefined') userToUpdate.creditLimit = creditLimit;
        if (typeof paymentTerms !== 'undefined') userToUpdate.paymentTerms = paymentTerms;
        if (typeof clientId !== 'undefined') userToUpdate.clientId = clientId;
        if (typeof specialRates !== 'undefined') userToUpdate.specialRates = specialRates;

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
