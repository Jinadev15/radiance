const express = require("express");
const { body, validationResult } = require("express-validator");
const Class = require("../models/Class");
const Student = require("../models/Student");
const auth = require("../middleware/auth");

const router = express.Router();

// @route   GET /api/classes
// @desc    Get all classes
// @access  Private
router.get("/", auth, async (req, res) => {
  try {
    const classes = await Class.find({ isActive: true })
      .populate("teacher", "name email")
      .sort({ grade: 1, section: 1 });
    res.json(classes);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

// @route   GET /api/classes/:id
// @desc    Get class by ID
// @access  Private
router.get("/:id", auth, async (req, res) => {
  try {
    const classData = await Class.findById(req.params.id).populate(
      "teacher",
      "name email"
    );

    if (!classData) {
      return res.status(404).json({ msg: "Class not found" });
    }

    res.json(classData);
  } catch (err) {
    console.error(err.message);
    if (err.kind === "ObjectId") {
      return res.status(404).json({ msg: "Class not found" });
    }
    res.status(500).send("Server error");
  }
});

// @route   POST /api/classes
// @desc    Create a new class
// @access  Private
router.post(
  "/",
  [
    auth,
    body("name", "Class name is required").not().isEmpty(),
    body("grade", "Grade is required").not().isEmpty(),
    body("section", "Section is required").not().isEmpty(),
    body("teacherId", "Teacher ID is required").not().isEmpty(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name, grade, section, teacherId, academicYear } = req.body;

      // Check if teacher exists
      const teacher = await require("../models/User").findById(teacherId);
      if (!teacher) {
        return res.status(404).json({ msg: "Teacher not found" });
      }

      // Check if class already exists
      const existingClass = await Class.findOne({
        grade,
        section,
        academicYear:
          academicYear ||
          new Date().getFullYear() + "-" + (new Date().getFullYear() + 1),
      });

      if (existingClass) {
        return res
          .status(400)
          .json({ msg: "Class already exists for this grade and section" });
      }

      // Create new class
      const newClass = new Class({
        name,
        grade,
        section,
        teacher: teacherId,
        academicYear,
      });

      await newClass.save();
      await newClass.populate("teacher", "name email");

      res.json(newClass);
    } catch (err) {
      console.error(err.message);
      res.status(500).send("Server error");
    }
  }
);

// @route   PUT /api/classes/:id
// @desc    Update class
// @access  Private
router.put(
  "/:id",
  [
    auth,
    body("name", "Class name is required").not().isEmpty(),
    body("grade", "Grade is required").not().isEmpty(),
    body("section", "Section is required").not().isEmpty(),
    body("teacherId", "Teacher ID is required").not().isEmpty(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name, grade, section, teacherId, academicYear } = req.body;

      // Check if teacher exists
      const teacher = await require("../models/User").findById(teacherId);
      if (!teacher) {
        return res.status(404).json({ msg: "Teacher not found" });
      }

      // Check if another class exists with same grade/section/year
      const existingClass = await Class.findOne({
        grade,
        section,
        academicYear:
          academicYear ||
          new Date().getFullYear() + "-" + (new Date().getFullYear() + 1),
        _id: { $ne: req.params.id },
      });

      if (existingClass) {
        return res
          .status(400)
          .json({
            msg: "Another class already exists for this grade and section",
          });
      }

      const updatedClass = await Class.findByIdAndUpdate(
        req.params.id,
        {
          name,
          grade,
          section,
          teacher: teacherId,
          academicYear,
        },
        { new: true }
      ).populate("teacher", "name email");

      if (!updatedClass) {
        return res.status(404).json({ msg: "Class not found" });
      }

      res.json(updatedClass);
    } catch (err) {
      console.error(err.message);
      if (err.kind === "ObjectId") {
        return res.status(404).json({ msg: "Class not found" });
      }
      res.status(500).send("Server error");
    }
  }
);

// @route   DELETE /api/classes/:id
// @desc    Delete class (soft delete)
// @access  Private
router.delete("/:id", auth, async (req, res) => {
  try {
    // Check if class has active students
    const studentCount = await Student.countDocuments({
      class: req.params.id,
      isActive: true,
    });

    if (studentCount > 0) {
      return res.status(400).json({
        msg: "Cannot delete class with active students. Please reassign or deactivate students first.",
      });
    }

    const classData = await Class.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );

    if (!classData) {
      return res.status(404).json({ msg: "Class not found" });
    }

    res.json({ msg: "Class deactivated" });
  } catch (err) {
    console.error(err.message);
    if (err.kind === "ObjectId") {
      return res.status(404).json({ msg: "Class not found" });
    }
    res.status(500).send("Server error");
  }
});

// @route   GET /api/classes/:id/students
// @desc    Get all students in a class
// @access  Private
router.get("/:id/students", auth, async (req, res) => {
  try {
    const students = await Student.find({
      class: req.params.id,
      isActive: true,
    }).select("-faceEmbedding");

    res.json(students);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

// @route   GET /api/classes/:id/stats
// @desc    Get class statistics
// @access  Private
router.get("/:id/stats", auth, async (req, res) => {
  try {
    const studentCount = await Student.countDocuments({
      class: req.params.id,
      isActive: true,
    });

    const attendanceStats = await require("../models/Attendance").aggregate([
      {
        $match: { class: require("mongoose").Types.ObjectId(req.params.id) },
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    res.json({
      studentCount,
      attendanceStats,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

module.exports = router;
