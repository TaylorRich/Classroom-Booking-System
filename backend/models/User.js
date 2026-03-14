const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  // Admin fields
  username:    { type: String, unique: true, sparse: true },
  password:    { type: String, required: true },

  // Course Rep (student) fields
  fullName:    { type: String, required: function() { return this.role === 'course_rep'; } },
  indexNumber: {
    type: String,
    unique: true,
    sparse: true,
    required: function() { return this.role === 'course_rep'; }
  },
  level: {
    type: Number,
    enum: [100, 200, 300, 400],
    required: function() { return this.role === 'course_rep'; }
  },
  department:  { type: String, required: function() { return this.role === 'course_rep'; } },

  mustChangePassword: { type: Boolean, default: false },

  role: { type: String, enum: ['course_rep', 'admin'], required: true }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);