const crypto = require('crypto');
require('dotenv').config();

async function generateEncryptedData() {
    try {
        // Generate a new encryption key (32 bytes = 256 bits)
        const encryptionKey = Buffer.from(crypto.randomBytes(32)).toString('base64');
        
        // Generate a secure JWT secret (64 bytes = 512 bits)
        const jwtSecret = Buffer.from(crypto.randomBytes(64)).toString('base64');

        // Create admin data
        const adminData = {
            id: 'admin1',
            email: process.env.EMAIL,
            password: process.env.ADMIN_PASSWORD,
            role: 'admin',
            isSuspended: false,
            createdAt: new Date().toISOString()
        };

        console.log('\n=== SECRET KEYS ===');
        console.log('ENCRYPTION_KEY=' + encryptionKey);
        console.log('JWT_SECRET=' + jwtSecret);
        
        console.log('\n=== INSTRUCTIONS ===');
        console.log('1. Add these keys to your .env file:');
        console.log('   ENCRYPTION_KEY=' + encryptionKey);
        console.log('   JWT_SECRET=' + jwtSecret);
        
        return {
            encryptionKey,
            jwtSecret,
            adminData
        };
    } catch (error) {
        console.error('Error generating data:', error);
        process.exit(1);
    }
}

generateEncryptedData();