const express = require('express');
const Classroom = require('../models/Classroom');
const { auth, adminAuth } = require('../middleware/auth');
const { google } = require('googleapis');
const router = express.Router();

// Google Calendar API setup
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Get all classrooms
router.get('/', auth, async (req, res) => {
  try {
    const classrooms = await Classroom.find({ isActive: true })
      .populate('bookings.courseRep', 'username department')
      .populate('comments.courseRep', 'username department')
      .sort({ name: 1 });
    res.json(classrooms);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Book classroom
router.post('/:id/book', auth, async (req, res) => {
  try {
    const { startTime, endTime } = req.body;
    const classroom = await Classroom.findById(req.params.id);
    
    if (!classroom) return res.status(404).json({ error: 'Classroom not found' });
    
    // Check for conflicts
    const conflict = classroom.bookings.find(booking => 
      booking.status === 'active' &&
      ((new Date(startTime) < new Date(booking.endTime) && new Date(endTime) > new Date(booking.startTime)))
    );
    
    if (conflict) return res.status(400).json({ error: 'Classroom already booked for this time' });

    classroom.bookings.push({ courseRep: req.user._id, startTime, endTime });
    await classroom.save();

    // Create Google Calendar event
    // Note: In production, complete OAuth2 flow and use access token
    // oauth2Client.setCredentials({ access_token: req.user.googleToken });
    // const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    // await calendar.events.insert({
    //   calendarId: 'primary',
    //   resource: {
    //     summary: `Classroom ${classroom.name} Booking`,
    //     start: { dateTime: startTime },
    //     end: { dateTime: endTime }
    //   }
    // });

    res.json({ message: 'Booking created successfully', booking: classroom.bookings[classroom.bookings.length - 1] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add comment
router.post('/:id/comment', auth, async (req, res) => {
  try {
    const { projector, desks, speakers, comments } = req.body;
    const classroom = await Classroom.findById(req.params.id);
    
    if (!classroom) return res.status(404).json({ error: 'Classroom not found' });

    classroom.comments.push({
      courseRep: req.user._id,
      projector,
      desks,
      speakers,
      comments
    });
    
    await classroom.save();
    res.json({ message: 'Comment added successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin: Add classroom
router.post('/', auth, adminAuth, async (req, res) => {
  try {
    const { name, capacity } = req.body;
    const classroom = new Classroom({ name, capacity });
    await classroom.save();
    res.status(201).json(classroom);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Admin: Delete classroom
router.delete('/:id', auth, adminAuth, async (req, res) => {
  try {
    await Classroom.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ message: 'Classroom deactivated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;