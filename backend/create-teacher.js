const mongoose = require("mongoose");
const User = require("./models/User");
require("dotenv").config();

async function createTestUsers() {
  try {
    await mongoose.connect(
      process.env.MONGODB_URI || "mongodb://localhost:27017/attendance-system"
    );

    // Create admin user
    const existingAdmin = await User.findOne({ email: "admin@test.com" });
    if (!existingAdmin) {
      const admin = new User({
        name: "Admin User",
        email: "admin@test.com",
        password: "password123",
        role: "admin",
      });
      await admin.save();
      console.log("Admin user created successfully");
    } else {
      console.log("Admin user already exists");
    }

    // Create teacher user
    const existingTeacher = await User.findOne({ email: "teacher@test.com" });
    if (!existingTeacher) {
      const teacher = new User({
        name: "Test Teacher",
        email: "teacher@test.com",
        password: "password123",
        role: "teacher",
      });
      await teacher.save();
      console.log("Teacher user created successfully");
    } else {
      console.log("Teacher user already exists");
    }
  } catch (error) {
    console.error("Error creating test users:", error);
  } finally {
    await mongoose.disconnect();
  }
}

createTestUsers();
