// seed.js — MUST be placed inside your backend/ folder
// Run from inside that folder: node seed.js

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/classroom_booking';

// ── CLASSROOMS ────────────────────────────────────────────────────────────────
const classroomsData = [
  {
    name: 'Room A101',
    capacity: 40,
    resources: ['Projector', 'Whiteboard', 'Air Conditioning'],
    isActive: true,
  },
  {
    name: 'Room A102',
    capacity: 35,
    resources: ['Whiteboard', 'Speakers', 'Air Conditioning'],
    isActive: true,
  },
  {
    name: 'Room B201',
    capacity: 60,
    resources: ['Projector', 'Speakers', 'Whiteboard', 'Microphone'],
    isActive: true,
  },
  {
    name: 'Room B202',
    capacity: 50,
    resources: ['Projector', 'Smart Board', 'Air Conditioning'],
    isActive: true,
  },
  {
    name: 'Computer Lab C301',
    capacity: 30,
    resources: ['Projector', 'Computers', 'Air Conditioning', 'Whiteboard'],
    isActive: true,
  },
  {
    name: 'Computer Lab C302',
    capacity: 25,
    resources: ['Projector', 'Computers', 'Air Conditioning'],
    isActive: true,
  },
  {
    name: 'Lecture Hall D401',
    capacity: 120,
    resources: ['Projector', 'Speakers', 'Microphone', 'Air Conditioning', 'Video Camera'],
    isActive: true,
  },
  {
    name: 'Seminar Room E101',
    capacity: 20,
    resources: ['Smart Board', 'Whiteboard', 'Air Conditioning'],
    isActive: true,
  },
  {
    name: 'Board Room F201',
    capacity: 15,
    resources: ['Smart Board', 'Video Camera', 'Microphone', 'Air Conditioning'],
    isActive: true,
  },
  {
    name: 'Room G101',
    capacity: 45,
    resources: ['Projector', 'Whiteboard'],
    isActive: false,
  },
];

// ── USERS ─────────────────────────────────────────────────────────────────────
const usersData = [
  { username: 'admin',          password: 'admin123',      role: 'admin' },
  { username: 'facilities_mgr', password: 'facilities123', role: 'admin' },

  { username: 'rep_cs',          password: 'rep123', role: 'course_rep', department: 'Computer Science' },
  { username: 'rep_engineering', password: 'rep123', role: 'course_rep', department: 'Engineering' },
  { username: 'rep_mathematics', password: 'rep123', role: 'course_rep', department: 'Mathematics' },
  { username: 'rep_biology',     password: 'rep123', role: 'course_rep', department: 'Biology' },
  { username: 'rep_business',    password: 'rep123', role: 'course_rep', department: 'Business Administration' },
  { username: 'rep_law',         password: 'rep123', role: 'course_rep', department: 'Law' },
];

// ── SEED ──────────────────────────────────────────────────────────────────────
async function seed() {
  try {
    console.log('╔══════════════════════════════════════╗');
    console.log('║   Central University — DB Seeder     ║');
    console.log('╚══════════════════════════════════════╝\n');

    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('✅ Connected!\n');

    // Load models AFTER connecting
    const User      = require('./models/User');
    const Classroom = require('./models/Classroom');

    console.log('🗑️  Clearing existing data...');
    await User.deleteMany({});
    await Classroom.deleteMany({});
    console.log('   Done.\n');

    console.log('🏫 Seeding classrooms...');
    const classrooms = await Classroom.insertMany(classroomsData);
    console.log(`   ✓ ${classrooms.length} classrooms created\n`);

    console.log('👥 Seeding users...');
    const usersWithHashes = await Promise.all(
      usersData.map(async (u) => ({ ...u, password: await bcrypt.hash(u.password, 10) }))
    );
    const users = await User.insertMany(usersWithHashes);
    console.log(`   ✓ ${users.length} users created\n`);

    // ── SUMMARY ──────────────────────────────────────────────────────────────
    console.log('═══════════════════════════════════════');
    console.log('           SEED COMPLETE 🎉');
    console.log('═══════════════════════════════════════\n');

    console.log(`🏫 CLASSROOMS (${classrooms.length} total):`);
    classrooms.forEach((c) => {
      const status = c.isActive ? '✅' : '❌';
      console.log(`   ${status} ${c.name.padEnd(25)} Cap: ${String(c.capacity).padEnd(4)} | ${c.resources.join(', ') || 'No resources'}`);
    });

    console.log('\n🔐 SUPERADMIN (hardcoded — no DB entry):');
    console.log(`   Username : ${process.env.SUPERADMIN_USER || 'superadmin'}`);
    console.log(`   Password : ${process.env.SUPERADMIN_PASS || 'superadmin123'}`);
    console.log(`   Page     : superadmin.html`);

    console.log('\n👔 ADMINS:');
    usersData.filter(u => u.role === 'admin').forEach(u =>
      console.log(`   ${u.username.padEnd(20)} / ${u.password}  →  admin.html`)
    );

    console.log('\n👨‍🎓 COURSE REPS:');
    usersData.filter(u => u.role === 'course_rep').forEach(u =>
      console.log(`   ${u.username.padEnd(22)} / ${u.password}  →  courserep.html  (${u.department})`)
    );

    console.log('\n🌐 Next step: node server.js  →  http://localhost:5000\n');

  } catch (err) {
    console.error('\n❌ Seed failed:', err.message);
    if (err.code === 11000) {
      console.error('   Duplicate key — try running again, the deleteMany should have cleared it.');
    }
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB.');
  }
}

seed();