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
// in source), and mustChangePassword forces a real one to be set at first
// login rather than the temporary one becoming permanent by habit.
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

  const generated = !process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD || `${crypto.randomBytes(9).toString('base64url')}-Rd1`;

  if (!generated) {
    const weak = User.validatePasswordStrength(password, { email });
    if (weak) {
      console.error(`ADMIN_PASSWORD rejected: ${weak}`);
      process.exitCode = 1;
      return;
    }
  }

  const admin = new User({
    name: 'Radiance Admin',
    email,
    password, // hashed by the pre-save hook
    role: 'admin',
    mustChangePassword: true,
  });

  await admin.save();
  console.log('Admin user created:');
  console.log(`   Email: ${email}`);
  console.log(`   Password: ${password}`);
  console.log('   You will be required to change this password at first login.');
}

async function seedDefaultShifts() {
  const count = await ShiftTemplate.countDocuments();
  if (count > 0) {
    console.log('Shift templates already exist, skipping default seed.');
    return;
  }

  await ShiftTemplate.insertMany([
    { name: 'Day Shift', startTime: '09:00', endTime: '17:00', graceMinutes: 10, breakMinutes: 30 },
    { name: 'Night Shift', startTime: '21:00', endTime: '06:00', graceMinutes: 10, breakMinutes: 30 },
  ]);
  console.log('Seeded default shift templates: Day Shift (09:00-17:00), Night Shift (21:00-06:00).');
}

async function main() {
  if (process.env.NODE_ENV === 'production' && !process.env.NATIONAL_ID_HMAC_SECRET) {
    console.error('NATIONAL_ID_HMAC_SECRET must be set before seeding a production database.');
    process.exitCode = 1;
    return;
  }
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB...');
    await createAdminUser();
    await seedDefaultShifts();
  } catch (error) {
    console.error('Error:', error.message);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
