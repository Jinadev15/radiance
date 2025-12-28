const express = require("express");
const cors = require("./middleware/cors");
const connectDB = require("./config/database");
require("dotenv").config();

const app = express();

// Connect to MongoDB
connectDB();

// Middleware
app.use(cors);
app.use(express.json({ limit: "10mb" })); // For handling base64 images
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/students", require("./routes/students"));
app.use("/api/classes", require("./routes/classes"));
app.use("/api/attendance", require("./routes/attendance"));

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", message: "Attendance Management API is running" });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Something went wrong!" });
});

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({ message: "Route not found" });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
