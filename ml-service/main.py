from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
import base64
import io
from PIL import Image
import numpy as np
from face_recognition_service import FaceRecognitionService
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Face Recognition ML Service",
    description="Microservice for facial recognition operations",
    version="1.0.0"
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5000"],  # Frontend and backend URLs
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize face recognition service
face_service = FaceRecognitionService()

@app.get("/")
async def root():
    """Health check endpoint"""
    return {"message": "Face Recognition ML Service is running", "status": "healthy"}

@app.post("/extract-embedding")
async def extract_embedding(image_data: dict):
    """
    Extract face embedding from base64 image
    """
    try:
        image_base64 = image_data.get("image")
        if not image_base64:
            raise HTTPException(status_code=400, detail="Image data is required")

        # Decode base64 image
        try:
            image_data = base64.b64decode(image_base64.split(',')[1] if ',' in image_base64 else image_base64)
            image = Image.open(io.BytesIO(image_data))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid image data: {str(e)}")

        # Extract embedding
        embedding = face_service.extract_embedding(image)

        if embedding is None:
            raise HTTPException(
                status_code=400,
                detail="Unable to process the face image. Please ensure the image contains a clear, well-lit face photo and try again."
            )

        return {"embedding": embedding.tolist()}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error extracting embedding: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post("/recognize-face")
async def recognize_face(recognition_data: dict):
    """
    Recognize face by comparing embedding with candidate embeddings
    """
    try:
        embedding = recognition_data.get("embedding")
        candidates = recognition_data.get("candidates")

        if not embedding or not candidates:
            raise HTTPException(status_code=400, detail="Embedding and candidates are required")

        # Convert embedding to numpy array
        embedding = np.array(embedding)

        # Perform recognition
        result = face_service.recognize_face(embedding, candidates)

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error recognizing face: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post("/verify-faces")
async def verify_faces(verification_data: dict):
    """
    Verify if two face embeddings belong to the same person
    """
    try:
        embedding1 = verification_data.get("embedding1")
        embedding2 = verification_data.get("embedding2")

        if not embedding1 or not embedding2:
            raise HTTPException(status_code=400, detail="Both embeddings are required")

        # Convert embeddings to numpy arrays
        embedding1 = np.array(embedding1)
        embedding2 = np.array(embedding2)

        # Perform verification
        result = face_service.verify_faces(embedding1, embedding2)

        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error verifying faces: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get("/health")
async def health_check():
    """Detailed health check"""
    return {
        "status": "healthy",
        "service": "Face Recognition ML Service",
        "version": "1.0.0",
        "models_loaded": face_service.is_ready()
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
