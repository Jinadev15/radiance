const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema({
  student: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Student",
    required: true,
  },
  class: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Class",
    required: true,
  },
  date: {
    type: Date,
    required: true,
    default: Date.now,
  },
  status: {
    type: String,
    enum: ["Present", "Absent", "Late"],
    required: true,
  },
  checkInTime: {
    type: Date,
    required: true,
  },
  checkOutTime: {
    type: Date,
  },
  confidence: {
    type: Number, // Facial recognition confidence score
    min: 0,
    max: 1,
  },
  markedBy: {
    type: String,
    enum: ["Auto", "Manual"],
    default: "Auto",
  },
  notes: {
    type: String,
    trim: true,
  },
});

// Compound index to prevent duplicate attendance records for same student, class, and date
attendanceSchema.index({ student: 1, class: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("Attendance", attendanceSchema);
