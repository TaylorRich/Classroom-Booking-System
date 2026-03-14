const express = require('express');
const Classroom = require('../models/Classroom');
const { auth, adminAuth } = require('../middleware/auth');
const router = express.Router();

// Auto-expire bookings whose endTime has passed
async function expireBookings(classroom) {
  const now = new Date();
  let changed = false;
  classroom.bookings.forEach(b => {
    if (b.status === 'active' && new Date(b.endTime) <= now) {
      b.status = 'completed';
      changed = true;
    }
  });
  if (changed) await classroom.save();
}

// Course rep: Get all active classrooms
router.get('/', auth, async (req, res) => {
  try {
    const classrooms = await Classroom.find({ isActive: true })
      .populate('bookings.courseRep', 'fullName indexNumber department')
      .populate('comments.courseRep', 'fullName indexNumber department')
      .sort({ name: 1 });
    await Promise.all(classrooms.map(expireBookings));
    const fresh = await Classroom.find({ isActive: true })
      .populate('bookings.courseRep', 'fullName indexNumber department')
      .populate('comments.courseRep', 'fullName indexNumber department')
      .sort({ name: 1 });
    res.json(fresh);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin: Get ALL classrooms (active + inactive)
router.get('/all', auth, adminAuth, async (req, res) => {
  try {
    const classrooms = await Classroom.find()
      .populate('bookings.courseRep', 'fullName indexNumber department')
      .populate('comments.courseRep', 'fullName indexNumber department')
      .sort({ name: 1 });
    await Promise.all(classrooms.map(expireBookings));
    const fresh = await Classroom.find()
      .populate('bookings.courseRep', 'fullName indexNumber department')
      .populate('comments.courseRep', 'fullName indexNumber department')
      .sort({ name: 1 });
    res.json(fresh);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin: Add classroom
router.post('/', auth, adminAuth, async (req, res) => {
  try {
    const { name, capacity, resources } = req.body;
    const classroom = new Classroom({ name, capacity, resources: resources || [] });
    await classroom.save();
    res.status(201).json(classroom);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Admin: Edit classroom
router.patch('/:id', auth, adminAuth, async (req, res) => {
  try {
    const updates = {};
    const allowed = ['name', 'capacity', 'resources', 'isActive'];
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    const classroom = await Classroom.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!classroom) return res.status(404).json({ error: 'Classroom not found' });
    res.json(classroom);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Admin: Deactivate classroom
router.delete('/:id', auth, adminAuth, async (req, res) => {
  try {
    await Classroom.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ message: 'Classroom deactivated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Course rep: Book classroom
router.post('/:id/book', auth, async (req, res) => {
  try {
    const { startTime, endTime } = req.body;
    const classroom = await Classroom.findById(req.params.id);
    if (!classroom) return res.status(404).json({ error: 'Classroom not found' });
    if (!classroom.isActive) return res.status(400).json({ error: 'Classroom is not active' });

    await expireBookings(classroom);

    const conflict = classroom.bookings.find(b =>
      b.status === 'active' &&
      new Date(startTime) < new Date(b.endTime) &&
      new Date(endTime) > new Date(b.startTime)
    );
    if (conflict) return res.status(400).json({ error: 'Classroom already booked for this time' });

    classroom.bookings.push({ courseRep: req.user._id, startTime, endTime });
    await classroom.save();
    res.json({ message: 'Booking created successfully', booking: classroom.bookings[classroom.bookings.length - 1] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Course rep OR Admin: Unlock (end booking early)
router.patch('/:id/unlock/:bookingId', auth, async (req, res) => {
  try {
    const classroom = await Classroom.findById(req.params.id);
    if (!classroom) return res.status(404).json({ error: 'Classroom not found' });
    const booking = classroom.bookings.id(req.params.bookingId);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const isAdmin = req.userRole === 'admin' || req.userRole === 'superadmin';
    const isOwner = req.user !== 'superadmin' && booking.courseRep.toString() === req.user._id.toString();
    if (!isAdmin && !isOwner) {
      return res.status(403).json({ error: 'Not authorized to unlock this booking' });
    }

    booking.status = 'completed';
    booking.endTime = new Date();
    await classroom.save();
    res.json({ message: 'Classroom unlocked successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Course rep: Add review
router.post('/:id/comment', auth, async (req, res) => {
  try {
    const { projector, desks, speakers, comments } = req.body;
    const classroom = await Classroom.findById(req.params.id);
    if (!classroom) return res.status(404).json({ error: 'Classroom not found' });
    classroom.comments.push({ courseRep: req.user._id, projector, desks, speakers, comments });
    await classroom.save();
    res.json({ message: 'Review added successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin: Delete a review
router.delete('/:id/comment/:commentId', auth, adminAuth, async (req, res) => {
  try {
    const classroom = await Classroom.findById(req.params.id);
    if (!classroom) return res.status(404).json({ error: 'Classroom not found' });
    const comment = classroom.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Review not found' });
    comment.deleteOne();
    await classroom.save();
    res.json({ message: 'Review deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;