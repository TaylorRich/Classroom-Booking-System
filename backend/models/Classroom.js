const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  courseRep: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  startTime: { type: Date, required: true },
  endTime:   { type: Date, required: true },
  status:    { type: String, enum: ['active', 'completed', 'cancelled'], default: 'active' }
}, { timestamps: true });

const commentSchema = new mongoose.Schema({
  courseRep: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  projector: { type: Number, min: 1, max: 5 },
  desks:     { type: Number, min: 1, max: 5 },
  speakers:  { type: Number, min: 1, max: 5 },
  comments:  { type: String }
}, { timestamps: true });

const classroomSchema = new mongoose.Schema({
  name:      { type: String, required: true, unique: true },
  capacity:  { type: Number, required: true },
  resources: { type: [String], default: [] },
  isActive:  { type: Boolean, default: true },
  bookings:  [bookingSchema],
  comments:  [commentSchema]
}, { timestamps: true });

module.exports = mongoose.model('Classroom', classroomSchema);