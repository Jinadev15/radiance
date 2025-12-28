const connectDB = require("./config/database");
const axios = require("axios");
const Student = require("./models/Student");
require("dotenv").config();

const updateFaceEmbeddings = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    // Find all students without face embeddings but with face images
    const studentsWithoutEmbeddings = await Student.find({
      faceEmbedding: { $exists: false },
      faceImage: { $exists: true, $ne: null },
    });

    console.log(
      `Found ${studentsWithoutEmbeddings.length} students without face embeddings`
    );

    let successCount = 0;
    let failureCount = 0;

    for (const student of studentsWithoutEmbeddings) {
      try {
        console.log(
          `Processing student: ${student.name} (${student.studentId})`
        );

        // Extract face embedding from ML service
        const mlResponse = await axios.post(
          `${process.env.ML_SERVICE_URL}/extract-embedding`,
          {
            image: student.faceImage,
          },
          {
            timeout: 30000, // 30 second timeout
          }
        );

        const faceEmbedding = mlResponse.data.embedding;

        // Update student with face embedding
        await Student.findByIdAndUpdate(student._id, {
          faceEmbedding: faceEmbedding,
        });

        console.log(`✓ Updated face embedding for ${student.name}`);
        successCount++;
      } catch (mlError) {
        console.error(`✗ Failed to process ${student.name}:`, mlError.message);
        failureCount++;
      }
    }

    console.log(`\nUpdate complete:`);
    console.log(`✓ Successfully updated: ${successCount} students`);
    console.log(`✗ Failed to update: ${failureCount} students`);
  } catch (error) {
    console.error("Error updating face embeddings:", error);
  } finally {
    // Note: connectDB doesn't provide a disconnect method, so we'll let the process exit
    console.log("Update process completed");
  }
};

// Run the update
updateFaceEmbeddings();
