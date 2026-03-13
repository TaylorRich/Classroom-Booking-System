const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { auth, adminAuth, superAdminAuth } = require('../middleware/auth');
const router = express.Router();

// Login - auto-detects role
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    // Superadmin hardcoded check
    if (username === (process.env.SUPERADMIN_USER || 'superadmin') && password === (process.env.SUPERADMIN_PASS || 'superadmin123')) {
      const token = jwt.sign({ userId: 'superadmin', role: 'superadmin' }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
      return res.json({ token, user: { id: 'superadmin', username: 'superadmin', role: 'superadmin' } });
    }
    const user = await User.findOne({ username });
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, username: user.username, role: user.role, department: user.department } });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get current user
router.get('/me', auth, async (req, res) => {
  if (req.user === 'superadmin') {
    return res.json({ user: { id: 'superadmin', username: 'superadmin', role: 'superadmin' } });
  }
  res.json({ user: { id: req.user._id, username: req.user.username, role: req.user.role, department: req.user.department } });
});

// Get all users (admin + superadmin)
router.get('/users', auth, async (req, res) => {
  try {
    const role = req.user === 'superadmin' ? 'superadmin' : req.user.role;
    if (role !== 'admin' && role !== 'superadmin') return res.status(403).json({ error: 'Access denied' });
    const users = await User.find({}, '-password').sort({ role: 1, username: 1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// SuperAdmin: Create any user
router.post('/users', auth, superAdminAuth, async (req, res) => {
  try {
    const { username, password, role, department } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashedPassword, role, department });
    await user.save();
    res.status(201).json({ message: 'User created', user: { id: user._id, username: user.username, role: user.role, department: user.department } });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// SuperAdmin: Delete any user
router.delete('/users/:id', auth, superAdminAuth, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin: Create course_rep
router.post('/register', auth, adminAuth, async (req, res) => {
  try {
    const { username, password, department } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashedPassword, role: 'course_rep', department });
    await user.save();
    res.status(201).json({ message: 'Course rep created' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Admin: Remove course_rep
router.delete('/rep/:id', auth, adminAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || user.role !== 'course_rep') return res.status(400).json({ error: 'Not a course rep' });
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'Course rep removed' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;