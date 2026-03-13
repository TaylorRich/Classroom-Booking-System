const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');

    // Superadmin token
    if (decoded.role === 'superadmin') {
      req.user = 'superadmin';
      req.userRole = 'superadmin';
      return next();
    }

    const user = await User.findById(decoded.userId);
    if (!user) return res.status(401).json({ error: 'Invalid token.' });
    req.user = user;
    req.userRole = user.role;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token.' });
  }
};

const adminAuth = (req, res, next) => {
  if (req.userRole !== 'admin' && req.userRole !== 'superadmin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
};

const superAdminAuth = (req, res, next) => {
  if (req.userRole !== 'superadmin') {
    return res.status(403).json({ error: 'Superadmin access required.' });
  }
  next();
};

module.exports = { auth, adminAuth, superAdminAuth };