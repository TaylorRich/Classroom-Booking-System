/* =============================================================
   seed.js — Populate the database with initial admins, course
   reps, and classrooms.

   Connects using MONGODB_URI from .env — so wherever that points
   (local Mongo or Atlas) is where this data will be written.

   Safe to re-run: existing records (matched by username / index
   number / room name) are skipped, not overwritten, so re-running
   this will never reset a password someone has already changed.

   Usage:
     node seed.js
   ============================================================= */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const User      = require('./models/User');
const Classroom = require('./models/Classroom');

const PRESET_RESOURCES = [
  'Projector', 'Speakers', 'Whiteboard', 'Air Conditioning',
  'Smart Board', 'Microphone', 'Video Camera', 'Computers'
];

function randomResources() {
  const shuffled = [...PRESET_RESOURCES].sort(() => 0.5 - Math.random());
  const count = 2 + Math.floor(Math.random() * 3); // 2–4 resources
  return shuffled.slice(0, count);
}

const admins = [
  { username: 'Marvin',    password: 'admin123' },
  { username: 'Emmanuel',  password: 'admin123' },
  { username: 'Roland',    password: 'admin123' },
  { username: 'Prince',    password: 'admin123' },
];

const courseReps = [
  { fullName: 'Dumorgah Richard',   indexNumber: 'csc/22/01/1420', level: 300, department: 'Computer Science' },
  { fullName: 'Victor Arinze Eze',  indexNumber: 'law/22/01/1420', level: 400, department: 'Law' },
];

const classrooms = [
  { name: 'F201', capacity: 60 },
  { name: 'E201', capacity: 24 },
  { name: 'F202', capacity: 60 },
  { name: 'F203', capacity: 60 },
  { name: 'F204', capacity: 45 },
  { name: 'E202', capacity: 24 },
  { name: 'E203', capacity: 30 },
  { name: 'G101', capacity: 50 },
  { name: 'G102', capacity: 40 },
  { name: 'H301', capacity: 100 },
];

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/classroom_booking');
  console.log(`Connected to database: ${mongoose.connection.name}\n`);

  console.log('── Admins ─────────────────────────');
  for (const a of admins) {
    const exists = await User.findOne({ username: a.username });
    if (exists) { console.log(`  ⏭  ${a.username} already exists — skipped`); continue; }
    const hashed = await bcrypt.hash(a.password, 10);
    await User.create({ username: a.username, password: hashed, role: 'admin' });
    console.log(`  ✅ ${a.username} created (password: ${a.password})`);
  }

  console.log('\n── Course Reps ────────────────────');
  const repHashedPassword = await bcrypt.hash('rep123', 10);
  for (const r of courseReps) {
    const indexNumber = r.indexNumber.trim().toLowerCase();
    const exists = await User.findOne({ indexNumber });
    if (exists) { console.log(`  ⏭  ${r.fullName} (${indexNumber}) already exists — skipped`); continue; }
    await User.create({
      fullName: r.fullName,
      indexNumber,
      level: r.level,
      department: r.department,
      password: repHashedPassword,
      mustChangePassword: true,
      role: 'course_rep'
    });
    console.log(`  ✅ ${r.fullName} (${indexNumber}) created (default password: rep123)`);
  }

  console.log('\n── Classrooms ─────────────────────');
  for (const c of classrooms) {
    const exists = await Classroom.findOne({ name: c.name });
    if (exists) { console.log(`  ⏭  ${c.name} already exists — skipped`); continue; }
    const resources = randomResources();
    await Classroom.create({ name: c.name, capacity: c.capacity, resources, isActive: true });
    console.log(`  ✅ ${c.name} created (capacity ${c.capacity}, resources: ${resources.join(', ')})`);
  }

  console.log('\n✅ Seed complete.');
  await mongoose.disconnect();
}

seed().catch(err => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
