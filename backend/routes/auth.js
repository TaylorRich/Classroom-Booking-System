const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { auth, adminAuth, superAdminAuth } = require('../middleware/auth');
const router = express.Router();

// Login - all users require a password; course_rep uses indexNumber, admin uses username
router.post('/login', async (req, res) => {
  try {
    const { username, password, indexNumber } = req.body;

    // Superadmin hardcoded check
    if (username === (process.env.SUPERADMIN_USER || 'superadmin') && password === (process.env.SUPERADMIN_PASS || 'superadmin123')) {
      const token = jwt.sign({ userId: 'superadmin', role: 'superadmin' }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
      return res.json({ token, user: { id: 'superadmin', username: 'superadmin', role: 'superadmin' } });
    }

    // Course rep login — index number + password
    if (indexNumber) {
      const user = await User.findOne({ indexNumber: indexNumber.trim().toLowerCase() });
      if (!user || user.role !== 'course_rep') {
        return res.status(400).json({ error: 'Invalid index number or password.' });
      }
      if (!await bcrypt.compare(password, user.password)) {
        return res.status(400).json({ error: 'Invalid index number or password.' });
      }
      const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
      return res.json({
        token,
        user: { id: user._id, fullName: user.fullName, indexNumber: user.indexNumber, level: user.level, department: user.department, role: user.role, mustChangePassword: user.mustChangePassword }
      });
    }

    // Admin login — username + password
    const user = await User.findOne({ username });
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(400).json({ error: 'Invalid username or password.' });
    }
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, username: user.username, role: user.role } });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get current user
router.get('/me', auth, async (req, res) => {
  if (req.user === 'superadmin') {
    return res.json({ user: { id: 'superadmin', username: 'superadmin', role: 'superadmin' } });
  }
  const u = req.user;
  if (u.role === 'course_rep') {
    return res.json({ user: { id: u._id, fullName: u.fullName, indexNumber: u.indexNumber, level: u.level, department: u.department, role: u.role, mustChangePassword: u.mustChangePassword } });
  }
  res.json({ user: { id: u._id, username: u.username, role: u.role } });
});

// Get all users (admin + superadmin)
router.get('/users', auth, async (req, res) => {
  try {
    const role = req.user === 'superadmin' ? 'superadmin' : req.user.role;
    if (role !== 'admin' && role !== 'superadmin') return res.status(403).json({ error: 'Access denied' });
    const users = await User.find({}, '-password').sort({ role: 1, fullName: 1, username: 1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// SuperAdmin: Create any user
router.post('/users', auth, superAdminAuth, async (req, res) => {
  try {
    const { username, password, role, department, fullName, indexNumber, level } = req.body;
    let userData = { role };
    if (role === 'course_rep') {
      const hashedPassword = await bcrypt.hash('rep123', 10);
      userData = { ...userData, fullName, indexNumber: indexNumber?.trim().toLowerCase(), level: parseInt(level), department, password: hashedPassword, mustChangePassword: true };
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      userData = { ...userData, username, password: hashedPassword };
    }
    const user = new User(userData);
    await user.save();
    const out = role === 'course_rep'
      ? { id: user._id, fullName: user.fullName, indexNumber: user.indexNumber, level: user.level, department: user.department, role: user.role }
      : { id: user._id, username: user.username, role: user.role };
    res.status(201).json({ message: 'User created', user: out });
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

// Admin: Create course_rep (default password: rep123, must change on first login)
router.post('/register', auth, adminAuth, async (req, res) => {
  try {
    const { fullName, indexNumber, level, department } = req.body;
    const hashedPassword = await bcrypt.hash('rep123', 10);
    const user = new User({
      fullName,
      indexNumber: indexNumber?.trim().toLowerCase(),
      level: parseInt(level),
      department,
      password: hashedPassword,
      mustChangePassword: true,
      role: 'course_rep'
    });
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

// Course rep: Change password (clears mustChangePassword flag)
router.post('/change-password', auth, async (req, res) => {
  try {
    if (req.user === 'superadmin') return res.status(400).json({ error: 'Not applicable for superadmin.' });
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user._id);
    if (!await bcrypt.compare(currentPassword, user.password)) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }
    if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    user.password = await bcrypt.hash(newPassword, 10);
    user.mustChangePassword = false;
    await user.save();
    res.json({ message: 'Password changed successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;