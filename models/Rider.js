const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const riderSchema = new mongoose.Schema({
  riderName: {
    type: String,
    required: [true, 'Rider name is required'],
    trim: true,
    maxlength: [100, 'Rider name cannot exceed 100 characters']
  },
  riderCode: {
    type: String,
    required: [true, 'Rider code is required'],
    unique: true,
    trim: true,
    maxlength: [20, 'Rider code cannot exceed 20 characters']
  },
  soName: {
    type: String,
    required: [true, 'S/o name is required'],
    trim: true,
    maxlength: [100, 'S/o name cannot exceed 100 characters']
  },
  mobileNo: {
    type: String,
    required: [true, 'Mobile number is required'],
    unique: true,
    match: [/^\d{10,15}$/, 'Please provide a valid mobile number']
  },
  cnicNo: {
    type: String,
    required: [true, 'CNIC number is required'],
    unique: true,
    match: [/^\d{13}$/, 'CNIC must be 13 digits']
  },
  address: {
    type: String,
    required: [true, 'Address is required'],
    trim: true,
    maxlength: [500, 'Address cannot exceed 500 characters']
  },
  emergencyContact: {
    type: String,
    required: [true, 'Emergency contact is required'],
    trim: true,
    maxlength: [500, 'Emergency contact cannot exceed 500 characters']
  },
  active: {
    type: Boolean,
    default: true
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters'],
    select: false 
  }
}, {
  timestamps: true
});


riderSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});


riderSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};


riderSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.__v;
  return obj;
};


riderSchema.statics.findByRiderCode = function(riderCode) {
  return this.findOne({ riderCode });
};

module.exports = mongoose.model('Rider', riderSchema);