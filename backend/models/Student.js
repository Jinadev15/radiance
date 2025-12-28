const mongoose = require("mongoose");

const studentSchema = new mongoose.Schema({
  studentId: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  class: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Class",
    required: true,
  },
  faceEmbedding: {
    type: [Number], // Array of numbers for face embedding
    required: false, // Made optional for fallback creation
  },
  faceImage: {
    type: String, // Base64 encoded image
    required: false, // Made optional for fallback creation
  },
  enrolledAt: {
    type: Date,
    default: Date.now,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
});

module.exports = mongoose.model("Student", studentSchema);
