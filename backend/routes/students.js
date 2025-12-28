const express = require("express");
const { body, validationResult } = require("express-validator");
const axios = require("axios");
const Student = require("../models/Student");
const Class = require("../models/Class");
const auth = require("../middleware/auth");

const router = express.Router();

// @route   GET /api/students
// @desc    Get all students
// @access  Private
router.get("/", auth, async (req, res) => {
  try {
    const students = await Student.find({ isActive: true })
      .populate("class", "name grade section")
      .select("-faceEmbedding");
    res.json(students);
  } catch (err) {
    console.error(err.message);
    res.status(500).send("Server error");
  }
});

// @route   GET /api/students/:id
// @desc    Get student by ID
// @access  Private
router.get("/:id", auth, async (req, res) => {
  try {
    const student = await Student.findById(req.params.id)
      .populate("class", "name grade section")
      .select("-faceEmbedding");

    if (!student) {
      return res.status(404).json({ msg: "Student not found" });
    }

    res.json(student);
  } catch (err) {
    console.error(err.message);
    if (err.kind === "ObjectId") {
      return res.status(404).json({ msg: "Student not found" });
    }
    res.status(500).send("Server error");
  }
});

// @route   POST /api/students
// @desc    Add new student with face capture
// @access  Private
router.post(
  "/",
  [
    auth,
    body("studentId", "Student ID is required").not().isEmpty(),
    body("name", "Name is required").not().isEmpty(),
    body("email", "Please include a valid email").isEmail(),
    body("classId", "Class ID is required").not().isEmpty(),
    body("faceImage", "Face image is required").not().isEmpty(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { studentId, name, email, classId, faceImage } = req.body;

      // Check if student ID already exists
      let student = await Student.findOne({ studentId });
      if (student) {
        return res.status(400).json({ msg: "Student ID already exists" });
      }

      // Check if email already exists
      student = await Student.findOne({ email });
      if (student) {
        return res.status(400).json({ msg: "Email already exists" });
      }

      // Check if class exists
      const studentClass = await Class.findById(classId);
      if (!studentClass) {
        return res.status(404).json({ msg: "Class not found" });
      }

      // Extract face embedding from ML service
      try {
        const mlResponse = await axios.post(
          `${process.env.ML_SERVICE_URL}/extract-embedding`,
          {
            image: faceImage,
          },
          {
            timeout: 30000, // 30 second timeout
          }
        );

        const faceEmbedding = mlResponse.data.embedding;

        // Create new student with face embedding
        student = new Student({
          studentId,
          name,
          email,
          class: classId,
          faceEmbedding,
          faceImage,
        });

        await student.save();

        // Populate class information
        await student.populate("class", "name grade section");

        res.json(student);
      } catch (mlError) {
        console.error(
          "ML Service Error:",
          mlError.response?.data || mlError.message
        );

        // If ML service is unavailable or face detection fails, create student without face embedding
        // This allows the system to continue working even if face recognition is temporarily down
        try {
          console.log(
            "Creating student without face embedding due to ML service failure"
          );

          student = new Student({
            studentId,
            name,
            email,
            class: classId,
            faceImage, // Store the image for later processing
            // faceEmbedding will be null
          });

          await student.save();
          await student.populate("class", "name grade section");

          res.json({
            ...student.toObject(),
            warning:
              "Student created successfully, but facial recognition setup failed. You can update the face data later.",
          });
        } catch (fallbackError) {
          console.error("Fallback student creation failed:", fallbackError);
          return res
            .status(500)
            .json({ msg: "Failed to create student. Please try again." });
        }
      }
    } catch (err) {
      console.error(err.message);
      res.status(500).send("Server error");
    }
  }
);

// @route   PUT /api/students/:id
// @desc    Update student
// @access  Private
router.put(
  "/:id",
  [
    auth,
    body("name", "Name is required").not().isEmpty(),
    body("email", "Please include a valid email").isEmail(),
    body("classId", "Class ID is required").not().isEmpty(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name, email, classId, faceImage } = req.body;

      // Check if class exists
      const studentClass = await Class.findById(classId);
      if (!studentClass) {
        return res.status(404).json({ msg: "Class not found" });
      }

      // Check if email is already taken by another student
      const existingStudent = await Student.findOne({
        email,
        _id: { $ne: req.params.id },
      });
      if (existingStudent) {
        return res.status(400).json({ msg: "Email already exists" });
      }

      let updateData = {
        name,
        email,
        class: classId,
      };

      // If new face image provided, extract new embedding
      if (faceImage) {
        try {
          const mlResponse = await axios.post(
            `${process.env.ML_SERVICE_URL}/extract-embedding`,
            {
              image: faceImage,
            }
          );
          updateData.faceEmbedding = mlResponse.data.embedding;
          updateData.faceImage = faceImage;
        } catch (mlError) {
          console.error("ML Service Error:", mlError.message);
          return res.status(500).json({ msg: "Failed to process face image" });
        }
      }

      const student = await Student.findByIdAndUpdate(
        req.params.id,
        updateData,
        { new: true }
      ).populate("class", "name grade section");

      if (!student) {
        return res.status(404).json({ msg: "Student not found" });
      }

      res.json(student);
    } catch (err) {
      console.error(err.message);
      if (err.kind === "ObjectId") {
        return res.status(404).json({ msg: "Student not found" });
      }
      res.status(500).send("Server error");
    }
  }
);

// @route   DELETE /api/students/:id
// @desc    Delete student (soft delete)
// @access  Private
router.delete("/:id", auth, async (req, res) => {
  try {
    const student = await Student.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );

    if (!student) {
      return res.status(404).json({ msg: "Student not found" });
    }

    res.json({ msg: "Student deactivated" });
  } catch (err) {
    console.error(err.message);
    if (err.kind === "ObjectId") {
      return res.status(404).json({ msg: "Student not found" });
    }
    res.status(500).send("Server error");
  }
});

module.exports = router;
