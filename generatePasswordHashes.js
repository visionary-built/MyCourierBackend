const bcrypt = require('bcrypt');
require('dotenv').config();

async function generateHash(password) {
    try {
        if (!password) {
            throw new Error('Password is required');
        }
        
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(password, salt);
        
        console.log('Generated password hash:');
        console.log(hash);
        
        return hash;
    } catch (error) {
        console.error('Error generating hash:', error);
        process.exit(1);
    }
}

// Get password from command line argument or use default
const password = process.argv[2] || '******';
console.log(`Generating hash for password: ${password}`);
generateHash(password);