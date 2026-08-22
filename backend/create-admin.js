// First-run setup: creates the initial admin login and default shift templates.
const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('./models/User');
const ShiftTemplate = require('./models/ShiftTemplate');
require('dotenv').config();

// A hardcoded default admin password is a real liability if this script is
// ever run against a live deployment — anyone with repo access would know
// it. ADMIN_EMAIL/ADMIN_PASSWORD let an operator set their own; without
// them, a random one-time password is generated and printed (never stored
// in source), and the operator is expected to change it after first login.
async function createAdminUser() {
  const email = process.env.ADMIN_EMAIL || 'admin@radiance.com';
  const existing = await User.findOne({ email });
  if (existing) {
    console.log(`Admin user already exists (${email}) — skipping.`);
    if (!process.env.ADMIN_EMAIL) {
      console.warn('WARNING: this looks like it may be an existing/production database. Set ADMIN_EMAIL/ADMIN_PASSWORD explicitly before re-running seed scripts against it.');
    }
    return;
  }

  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  const admin = new User({
    name: 'Radiance Admin',
    email,
    password, // Will be hashed by pre-save hook
    role: 'admin',
  });

  await admin.save();
  console.log('Admin user created:');
  console.log(`   Email: ${email}`);
  console.log(`   Password: ${password}`);
  console.log('   CHANGE THIS PASSWORD after first login!');
}

async function seedDefaultShifts() {
  const count = await ShiftTemplate.countDocuments();
  if (count > 0) {
    console.log('Shift templates already exist, skipping default seed.');
    return;
  }

  await ShiftTemplate.insertMany([
    { name: 'Day Shift', startTime: '09:00', endTime: '17:00', graceMinutes: 10 },
    { name: 'Night Shift', startTime: '21:00', endTime: '06:00', graceMinutes: 10 },
  ]);
  console.log('Seeded default shift templates: Day Shift (09:00-17:00), Night Shift (21:00-06:00).');
}

async function main() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB...');
    await createAdminUser();
    await seedDefaultShifts();
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

main();
