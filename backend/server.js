const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());
// Use an absolute path so static files resolve correctly regardless of
// the directory the process was launched from (npm start, pm2, etc.)
app.use(express.static(path.join(__dirname, '../frontend')));

// Mongoose v8 — no options needed
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/classroom_booking')
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err.message));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/classrooms', require('./routes/classrooms'));

// 404 handler for unknown API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Central error handler — must come last.
// Without this, a malformed JSON body (or any other thrown/async error)
// falls through to Express's default handler, which returns a raw HTML
// stack trace to the client and leaks server file paths.
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'Malformed JSON in request body.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});