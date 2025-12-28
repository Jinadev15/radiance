import numpy as np
from deepface import DeepFace
from PIL import Image
import io
import logging
from sklearn.metrics.pairwise import cosine_similarity
import os

logger = logging.getLogger(__name__)

class FaceRecognitionService:
    def __init__(self, model_name="Facenet"):
        self.model_name = model_name
        self.model = None
        self._load_model()

    def _load_model(self):
        """Pre-load the DeepFace model to avoid delays on first use"""
        try:
            logger.info(f"Loading {self.model_name} model...")
            # Test the model by getting embeddings for a dummy image
            dummy_embedding = DeepFace.represent(
                img_path=np.zeros((224, 224, 3), dtype=np.uint8),
                model_name=self.model_name,
                enforce_detection=False
            )
            self.model = self.model_name
            logger.info(f"Successfully loaded {self.model_name} model")
        except Exception as e:
            logger.error(f"Failed to load {self.model_name} model: {str(e)}")
            raise e

    def is_ready(self):
        """Check if the model is loaded and ready"""
        return self.model is not None

    def extract_embedding(self, image: Image.Image) -> np.ndarray:
        """
        Extract face embedding from a PIL Image
        Returns None if no face is detected
        """
        try:
            # Convert PIL image to numpy array
            img_array = np.array(image)

            # Ensure image is in RGB format
            if len(img_array.shape) == 2:
                img_array = np.stack([img_array] * 3, axis=-1)
            elif img_array.shape[2] == 4:
                img_array = img_array[:, :, :3]

            # Extract embedding using DeepFace
            embedding = DeepFace.represent(
                img_path=img_array,
                model_name=self.model_name,
                enforce_detection=False,
                detector_backend='mtcnn'
            )

            if isinstance(embedding, list) and len(embedding) > 0:
                return np.array(embedding[0]['embedding'])
            elif isinstance(embedding, dict):
                return np.array(embedding['embedding'])
            else:
                return None

        except Exception as e:
            logger.error(f"Error extracting embedding: {str(e)}")
            return None

    def recognize_face(self, embedding: np.ndarray, candidates: list) -> dict:
        """
        Recognize face by comparing embedding with candidate embeddings

        Args:
            embedding: The face embedding to recognize
            candidates: List of dicts with 'id' and 'embedding' keys

        Returns:
            dict: {'studentId': str, 'confidence': float} or {'error': str}
        """
        try:
            if not candidates:
                return {"error": "No candidates provided"}

            best_match = None
            best_confidence = 0.0

            for candidate in candidates:
                candidate_id = candidate['id']
                candidate_embedding = np.array(candidate['embedding'])

                # Calculate cosine similarity
                similarity = cosine_similarity(
                    embedding.reshape(1, -1),
                    candidate_embedding.reshape(1, -1)
                )[0][0]

                # Convert similarity to confidence score (0-1)
                confidence = (similarity + 1) / 2

                if confidence > best_confidence:
                    best_confidence = confidence
                    best_match = candidate_id

            return {
                "studentId": best_match,
                "confidence": float(best_confidence)
            }

        except Exception as e:
            logger.error(f"Error recognizing face: {str(e)}")
            return {"error": f"Recognition failed: {str(e)}"}

    def verify_faces(self, embedding1: np.ndarray, embedding2: np.ndarray) -> dict:
        """
        Verify if two face embeddings belong to the same person

        Args:
            embedding1: First face embedding
            embedding2: Second face embedding

        Returns:
            dict: {'verified': bool, 'distance': float, 'similarity': float}
        """
        try:
            # Calculate cosine similarity
            similarity = cosine_similarity(
                embedding1.reshape(1, -1),
                embedding2.reshape(1, -1)
            )[0][0]

            # Calculate Euclidean distance
            distance = np.linalg.norm(embedding1 - embedding2)

            # Threshold for verification (can be adjusted)
            threshold = 0.4  # Cosine distance threshold
            verified = distance < threshold

            return {
                "verified": bool(verified),
                "distance": float(distance),
                "similarity": float(similarity)
            }

        except Exception as e:
            logger.error(f"Error verifying faces: {str(e)}")
            return {"error": f"Verification failed: {str(e)}"}

    def batch_extract_embeddings(self, images: list) -> list:
        """
        Extract embeddings from multiple images

        Args:
            images: List of PIL Images

        Returns:
            list: List of embeddings (None for failed extractions)
        """
        embeddings = []
        for image in images:
            embedding = self.extract_embedding(image)
            embeddings.append(embedding)
        return embeddings
