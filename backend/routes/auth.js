const express  = require('express');
const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const speakeasy = require('speakeasy');
const QRCode   = require('qrcode');
const User     = require('../models/User');
const { auth, adminAuth, superAdminAuth } = require('../middleware/auth');
const router   = express.Router();

// ─── helpers ──────────────────────────────────────────────────────────────
const JWT_SECRET   = () => process.env.JWT_SECRET || 'secret';
const APP_NAME     = process.env.APP_NAME || 'ClassroomBooking';

const getSuperadminSecret = () => process.env.SUPERADMIN_TOTP_SECRET || null;

// Partial token (password OK, 2FA still pending) — expires in 5 min
function partialToken(payload) {
  return jwt.sign({ ...payload, twoFactorPending: true }, JWT_SECRET(), { expiresIn: '5m' });
}

// Full session token
function fullToken(payload) {
  return jwt.sign(payload, JWT_SECRET(), { expiresIn: '7d' });
}

// ─── LOGIN ────────────────────────────────────────────────────────────────
// POST /api/auth/login
// Returns one of:
//   { token, user }                                          → fully authenticated (course_rep)
//   { requiresTwoFactor: true, tempToken }                   → password OK, needs TOTP code
//   { requiresTwoFactorSetup: true, tempToken, qrCodeUrl }   → first-time 2FA setup
router.post('/login', async (req, res) => {
  try {
    const { username, password, indexNumber } = req.body;

    // ── Superadmin ────────────────────────────────────────────────────────
    if (username === (process.env.SUPERADMIN_USER || 'superadmin') &&
        password === (process.env.SUPERADMIN_PASS || 'superadmin123')) {

      const saSecret = getSuperadminSecret();

      if (saSecret) {
        // Already set up — just ask for the code
        const tempToken = partialToken({ userId: 'superadmin', role: 'superadmin' });
        return res.json({ requiresTwoFactor: true, tempToken });
      }

      // First run — generate secret & QR, embed new secret in the temp token
      const secret = speakeasy.generateSecret({ name: `${APP_NAME} (superadmin)`, length: 20 });
      const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
      const tempToken = partialToken({ userId: 'superadmin', role: 'superadmin', newSecret: secret.base32 });
      return res.json({ requiresTwoFactorSetup: true, tempToken, qrCodeUrl, secret: secret.base32 });
    }

    // ── Course rep ────────────────────────────────────────────────────────
    if (indexNumber) {
      const user = await User.findOne({ indexNumber: indexNumber.trim().toLowerCase() });
      if (!user || user.role !== 'course_rep') {
        return res.status(400).json({ error: 'Invalid index number or password.' });
      }
      if (!await bcrypt.compare(password, user.password)) {
        return res.status(400).json({ error: 'Invalid index number or password.' });
      }
      const token = fullToken({ userId: user._id });
      return res.json({
        token,
        user: { id: user._id, fullName: user.fullName, indexNumber: user.indexNumber,
                level: user.level, department: user.department, role: user.role,
                mustChangePassword: user.mustChangePassword }
      });
    }

    // ── Admin ─────────────────────────────────────────────────────────────
    const user = await User.findOne({ username });
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(400).json({ error: 'Invalid username or password.' });
    }

    // First ever login — generate secret & QR, save pending secret to DB
    if (!user.twoFactorEnabled && !user.twoFactorSecret) {
      const secret = speakeasy.generateSecret({ name: `${APP_NAME} (${user.username})`, length: 20 });
      user.twoFactorSecret  = secret.base32;
      user.twoFactorPending = true;
      await user.save();
      const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
      const tempToken = partialToken({ userId: user._id.toString(), role: user.role });
      return res.json({ requiresTwoFactorSetup: true, tempToken, qrCodeUrl, secret: secret.base32 });
    }

    // Already fully enabled — just ask for the code
    if (user.twoFactorEnabled) {
      const tempToken = partialToken({ userId: user._id.toString(), role: user.role });
      return res.json({ requiresTwoFactor: true, tempToken });
    }

    // Secret generated but setup was never confirmed — re-show the QR
    if (user.twoFactorSecret && !user.twoFactorEnabled) {
      const otpauth = speakeasy.otpauthURL({
        secret: user.twoFactorSecret,
        label:  `${APP_NAME} (${user.username})`,
        encoding: 'base32'
      });
      const qrCodeUrl = await QRCode.toDataURL(otpauth);
      const tempToken = partialToken({ userId: user._id.toString(), role: user.role });
      return res.json({ requiresTwoFactorSetup: true, tempToken, qrCodeUrl, secret: user.twoFactorSecret });
    }

    // Fallback (shouldn't be reached in normal operation)
    const token = fullToken({ userId: user._id });
    res.json({ token, user: { id: user._id, username: user.username, role: user.role } });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── VERIFY 2FA (returning users) ────────────────────────────────────────
// POST /api/auth/verify-2fa
// Body: { tempToken, totpCode }
router.post('/verify-2fa', async (req, res) => {
  try {
    const { tempToken, totpCode } = req.body;
    if (!tempToken || !totpCode) return res.status(400).json({ error: 'Missing token or code.' });

    let decoded;
    try {
      decoded = jwt.verify(tempToken, JWT_SECRET());
    } catch {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }

    if (!decoded.twoFactorPending) return res.status(400).json({ error: 'Invalid request.' });

    // Superadmin
    if (decoded.userId === 'superadmin') {
      const saSecret = getSuperadminSecret();
      if (!saSecret) return res.status(400).json({ error: 'Superadmin 2FA not configured.' });
      const valid = speakeasy.totp.verify({ secret: saSecret, encoding: 'base32', token: totpCode, window: 1 });
      if (!valid) return res.status(400).json({ error: 'Invalid authenticator code.' });
      const token = fullToken({ userId: 'superadmin', role: 'superadmin' });
      return res.json({ token, user: { id: 'superadmin', username: 'superadmin', role: 'superadmin' } });
    }

    // Admin
    const user = await User.findById(decoded.userId);
    if (!user) return res.status(401).json({ error: 'User not found.' });

    const valid = speakeasy.totp.verify({
      secret: user.twoFactorSecret, encoding: 'base32', token: totpCode, window: 1
    });
    if (!valid) return res.status(400).json({ error: 'Invalid authenticator code.' });

    const token = fullToken({ userId: user._id });
    res.json({ token, user: { id: user._id, username: user.username, role: user.role } });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── CONFIRM FIRST-TIME 2FA SETUP ────────────────────────────────────────
// POST /api/auth/confirm-2fa-setup
// Body: { tempToken, totpCode }
// User scanned the QR, typed a code — verify it before fully enabling 2FA
router.post('/confirm-2fa-setup', async (req, res) => {
  try {
    const { tempToken, totpCode } = req.body;
    if (!tempToken || !totpCode) return res.status(400).json({ error: 'Missing token or code.' });

    let decoded;
    try {
      decoded = jwt.verify(tempToken, JWT_SECRET());
    } catch {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    if (!decoded.twoFactorPending) return res.status(400).json({ error: 'Invalid request.' });

    // Superadmin first-time setup
    if (decoded.userId === 'superadmin') {
      const newSecret = decoded.newSecret;
      if (!newSecret) return res.status(400).json({ error: 'No secret in token.' });
      const valid = speakeasy.totp.verify({ secret: newSecret, encoding: 'base32', token: totpCode, window: 1 });
      if (!valid) return res.status(400).json({ error: 'Invalid code. Please try again with your authenticator app.' });
      const token = fullToken({ userId: 'superadmin', role: 'superadmin' });
      return res.json({
        token,
        user: { id: 'superadmin', username: 'superadmin', role: 'superadmin' },
        newTotpSecret: newSecret, // operator must save this to .env as SUPERADMIN_TOTP_SECRET
        message: 'Setup complete. Save the secret in your .env file as SUPERADMIN_TOTP_SECRET.'
      });
    }

    // Admin first-time setup
    const user = await User.findById(decoded.userId);
    if (!user) return res.status(401).json({ error: 'User not found.' });

    const valid = speakeasy.totp.verify({
      secret: user.twoFactorSecret, encoding: 'base32', token: totpCode, window: 1
    });
    if (!valid) return res.status(400).json({ error: 'Invalid code. Please try again with your authenticator app.' });

    user.twoFactorEnabled = true;
    user.twoFactorPending = false;
    await user.save();

    const token = fullToken({ userId: user._id });
    res.json({ token, user: { id: user._id, username: user.username, role: user.role } });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET CURRENT USER ─────────────────────────────────────────────────────
router.get('/me', auth, async (req, res) => {
  if (req.user === 'superadmin') {
    return res.json({ user: { id: 'superadmin', username: 'superadmin', role: 'superadmin' } });
  }
  const u = req.user;
  if (u.role === 'course_rep') {
    return res.json({ user: { id: u._id, fullName: u.fullName, indexNumber: u.indexNumber,
      level: u.level, department: u.department, role: u.role, mustChangePassword: u.mustChangePassword } });
  }
  res.json({ user: { id: u._id, username: u.username, role: u.role, twoFactorEnabled: u.twoFactorEnabled } });
});

// ─── GET ALL USERS ────────────────────────────────────────────────────────
router.get('/users', auth, async (req, res) => {
  try {
    const role = req.user === 'superadmin' ? 'superadmin' : req.user.role;
    if (role !== 'admin' && role !== 'superadmin') return res.status(403).json({ error: 'Access denied' });
    // Never expose the TOTP secret
    const users = await User.find({}, '-password -twoFactorSecret').sort({ role: 1, fullName: 1, username: 1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── SUPERADMIN: CREATE USER ──────────────────────────────────────────────
router.post('/users', auth, superAdminAuth, async (req, res) => {
  try {
    const { username, password, role, department, fullName, indexNumber, level } = req.body;
    let userData = { role };
    if (role === 'course_rep') {
      const hashedPassword = await bcrypt.hash('rep123', 10);
      userData = { ...userData, fullName, indexNumber: indexNumber?.trim().toLowerCase(),
        level: parseInt(level), department, password: hashedPassword, mustChangePassword: true };
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      userData = { ...userData, username, password: hashedPassword };
      // Admin 2FA will be enforced on their first login
    }
    const user = new User(userData);
    await user.save();
    const out = role === 'course_rep'
      ? { id: user._id, fullName: user.fullName, indexNumber: user.indexNumber, level: user.level, department: user.department, role: user.role }
      : { id: user._id, username: user.username, role: user.role, twoFactorEnabled: user.twoFactorEnabled };
    res.status(201).json({ message: 'User created', user: out });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ─── SUPERADMIN: DELETE USER ──────────────────────────────────────────────
router.delete('/users/:id', auth, superAdminAuth, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── SUPERADMIN: RESET AN ADMIN'S 2FA ────────────────────────────────────
// DELETE /api/auth/users/:id/2fa
// Clears the admin's TOTP secret so they must set it up again on next login
router.delete('/users/:id/2fa', auth, superAdminAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user || user.role !== 'admin') return res.status(400).json({ error: 'Admin not found.' });
    user.twoFactorSecret  = null;
    user.twoFactorEnabled = false;
    user.twoFactorPending = false;
    await user.save();
    res.json({ message: `2FA reset for ${user.username}. They will set it up on next login.` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── ADMIN: CREATE COURSE REP ─────────────────────────────────────────────
router.post('/register', auth, adminAuth, async (req, res) => {
  try {
    const { fullName, indexNumber, level, department } = req.body;
    const hashedPassword = await bcrypt.hash('rep123', 10);
    const user = new User({
      fullName, indexNumber: indexNumber?.trim().toLowerCase(),
      level: parseInt(level), department,
      password: hashedPassword, mustChangePassword: true, role: 'course_rep'
    });
    await user.save();
    res.status(201).json({ message: 'Course rep created' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ─── ADMIN: REMOVE COURSE REP ─────────────────────────────────────────────
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

// ─── CHANGE PASSWORD ──────────────────────────────────────────────────────
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