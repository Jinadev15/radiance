const express = require("express");
const { body, validationResult } = require("express-validator");
const axios = require("axios");
const Attendance = require("../models/Attendance");
const Student = require("../models/Student");
const Class = require("../models/Class");
const auth = require("../middleware/auth");

const router = express.Router();

// @route   GET /api/attendance
// @desc    Get attendance records with filters
// @access  Private
router.get("/", auth, async (req, res) => {
  try {
    const { studentId, classId, date, status } = req.query;

    let filter = {};

    if (studentId) {
      const student = await Student.findOne({ studentId });
      if (student) {
        filter.student = student._id;
      }
    }

    if (classId) {
      filter.class = classId;
    }

    if (date) {
      const startDate = new Date(date);
      const endDate = new Date(date);
      endDate.setDate(endDate.getDate() + 1);
      filter.date = { $gte: startDate, $lt: endDate };
    }

    if (status) {
      filter.status = status;
    }

    const attendance = await Attendance.find(filter)
      .populate("student", "studentId name")
      .populate("class", "name grade section")
      .sort({ date: -1, checkInTime: -1 });

    res.json(attendance);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

// @route   GET /api/attendance/:id
// @desc    Get attendance record by ID
// @access  Private
router.get("/:id", auth, async (req, res) => {
  try {
    const attendance = await Attendance.findById(req.params.id)
      .populate("student", "studentId name email")
      .populate("class", "name grade section");

    if (!attendance) {
      return res.status(404).json({ msg: "Attendance record not found" });
    }

    res.json(attendance);
  } catch (err) {
    console.error(err.message);
    if (err.kind === "ObjectId") {
      return res.status(404).json({ msg: "Attendance record not found" });
    }
    res.status(500).send("Server error");
  }
});

// @route   POST /api/attendance/mark
// @desc    Mark attendance using facial recognition
// @access  Private
router.post(
  "/mark",
  [
    auth,
    body("classId", "Class ID is required").not().isEmpty(),
    body("faceImage", "Face image is required").not().isEmpty(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { classId, faceImage } = req.body;

      // Check if class exists
      const classData = await Class.findById(classId);
      if (!classData) {
        return res.status(404).json({ msg: "Class not found" });
      }

      // Get all active students in the class
      const students = await Student.find({
        class: classId,
        isActive: true,
      }).select("studentId name faceEmbedding");

      if (students.length === 0) {
        return res
          .status(404)
          .json({ msg: "No active students found in this class" });
      }

      // Extract face embedding from the captured image
      try {
        const mlResponse = await axios.post(
          `${process.env.ML_SERVICE_URL}/extract-embedding`,
          {
            image: faceImage,
          }
        );

        const capturedEmbedding = mlResponse.data.embedding;

        // Find the best match using the ML service
        const recognitionResponse = await axios.post(
          `${process.env.ML_SERVICE_URL}/recognize-face`,
          {
            embedding: capturedEmbedding,
            candidates: students.map((student) => ({
              id: student._id.toString(),
              embedding: student.faceEmbedding,
            })),
          }
        );

        const { studentId, confidence } = recognitionResponse.data;

        if (!studentId || confidence < 0.7) {
          // Threshold for recognition
          return res.status(400).json({
            msg: "Face not recognized. Please try again or contact administrator.",
            confidence: confidence || 0,
          });
        }

        const student = await Student.findById(studentId);
        if (!student) {
          return res.status(404).json({ msg: "Student not found" });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Check if attendance already marked for today
        const existingAttendance = await Attendance.findOne({
          student: studentId,
          class: classId,
          date: {
            $gte: today,
            $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
          },
        });

        if (existingAttendance) {
          return res
            .status(400)
            .json({ msg: "Attendance already marked for today" });
        }

        // Determine status based on time
        const now = new Date();
        const hour = now.getHours();
        let status = "Present";

        if (hour >= 9) {
          // Assuming class starts at 9 AM
          status = "Late";
        }

        // Create attendance record
        const attendance = new Attendance({
          student: studentId,
          class: classId,
          date: now,
          status,
          checkInTime: now,
          confidence,
          markedBy: "Auto",
        });

        await attendance.save();
        await attendance.populate("student", "studentId name");
        await attendance.populate("class", "name grade section");

        res.json({
          msg: "Attendance marked successfully",
          attendance,
          confidence,
        });
      } catch (mlError) {
        console.error("ML Service Error:", mlError.message);
        return res
          .status(500)
          .json({ msg: "Failed to process face recognition" });
      }
    } catch (err) {
      console.error(err.message);
      res.status(500).send("Server error");
    }
  }
);

// @route   POST /api/attendance/manual
// @desc    Manually mark attendance
// @access  Private
router.post(
  "/manual",
  [
    auth,
    body("studentId", "Student ID is required").not().isEmpty(),
    body("classId", "Class ID is required").not().isEmpty(),
    body("status", "Status is required").isIn(["Present", "Absent", "Late"]),
    body("date", "Date is required").isISO8601(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { studentId, classId, status, date, notes } = req.body;

      // Find student by studentId
      const student = await Student.findOne({ studentId });
      if (!student) {
        return res.status(404).json({ msg: "Student not found" });
      }

      // Check if class exists
      const classData = await Class.findById(classId);
      if (!classData) {
        return res.status(404).json({ msg: "Class not found" });
      }

      // Check if attendance already exists for this student, class, and date
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const existingAttendance = await Attendance.findOne({
        student: student._id,
        class: classId,
        date: { $gte: today, $lt: tomorrow },
      });

      if (existingAttendance) {
        return res
          .status(400)
          .json({ msg: "Attendance already marked for today" });
      }

      // Create attendance record
      const attendance = new Attendance({
        student: student._id,
        class: classId,
        date: new Date(),
        status,
        checkInTime: new Date(),
        markedBy: req.user.id,
        notes,
      });

      await attendance.save();
      await attendance.populate("student", "studentId name");
      await attendance.populate("class", "name grade section");

      res.json({
        msg: "Attendance marked successfully",
        attendance,
      });
    } catch (err) {
      console.error(err.message);
      res.status(500).send("Server error");
    }
  }
);

// @route   PUT /api/attendance/:id
// @desc    Update attendance record
// @access  Private
router.put("/:id", auth, async (req, res) => {
  try {
    const { status, notes } = req.body;

    let attendance = await Attendance.findById(req.params.id);

    if (!attendance) {
      return res.status(404).json({ msg: "Attendance record not found" });
    }

    // Update fields
    if (status) attendance.status = status;
    if (notes !== undefined) attendance.notes = notes;

    await attendance.save();
    await attendance.populate("student", "studentId name");
    await attendance.populate("class", "name grade section");

    res.json(attendance);
  } catch (err) {
    console.error(err.message);
    if (err.kind === "ObjectId") {
      return res.status(404).json({ msg: "Attendance record not found" });
    }
    res.status(500).send("Server error");
  }
});

// @route   DELETE /api/attendance/:id
// @desc    Delete attendance record
// @access  Private
router.delete("/:id", auth, async (req, res) => {
  try {
    const attendance = await Attendance.findById(req.params.id);

    if (!attendance) {
      return res.status(404).json({ msg: "Attendance record not found" });
    }

    await attendance.remove();

    res.json({ msg: "Attendance record removed" });
  } catch (err) {
    console.error(err.message);
    if (err.kind === "ObjectId") {
      return res.status(404).json({ msg: "Attendance record not found" });
    }
    res.status(500).send("Server error");
  }
});

module.exports = router;
