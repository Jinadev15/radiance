const mongoose = require("mongoose");

const classSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  grade: {
    type: String,
    required: true,
    trim: true,
  },
  section: {
    type: String,
    required: true,
    trim: true,
  },
  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  academicYear: {
    type: String,
    default: () => {
      const year = new Date().getFullYear();
      return `${year}-${year + 1}`;
    },
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Compound index to prevent duplicate classes
classSchema.index({ grade: 1, section: 1, academicYear: 1 }, { unique: true });

module.exports = mongoose.model("Class", classSchema);
