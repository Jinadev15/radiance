import os
import cv2
import base64
import logging
import urllib.request
import numpy as np
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
from typing import Dict, List, Optional

# Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("radiance-ml")

# Face engine: OpenCV's built-in YuNet (detection) + SFace (recognition).
# Both ship as ONNX models run through OpenCV's own DNN module — no
# TensorFlow/PyTorch, no compiled C-extension dependency beyond OpenCV
# itself (which this service needs regardless, for image decoding). This
# replaces an earlier DeepFace/TensorFlow pipeline that had a history of
# failing to load on Windows and silently falling back to a placeholder
# feature vector with no real recognition accuracy.
MODEL_DIR = Path(__file__).parent / "models"
DETECTOR_MODEL = MODEL_DIR / "face_detection_yunet_2023mar.onnx"
RECOGNIZER_MODEL = MODEL_DIR / "face_recognition_sface_2021dec.onnx"

# These two files are intentionally gitignored (38MB of binary weights
# don't belong in git history) — which means a fresh deploy on a hosting
# platform has no way to have them already present unless something fetches
# them. Rather than requiring every hosting provider to support a custom
# build-command step (not all free tiers do), the service fetches its own
# weights from the OpenCV Zoo on first boot if they're missing, so
# `python main.py` alone is enough to stand the service up anywhere.
_MODEL_SOURCES = {
    DETECTOR_MODEL: "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
    RECOGNIZER_MODEL: "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
}
_MIN_EXPECTED_BYTES = 100_000  # a failed download (e.g. an HTML error page) would be far smaller than either real model

def _ensure_model(path: Path, url: str) -> None:
    if path.exists() and path.stat().st_size >= _MIN_EXPECTED_BYTES:
        return
    logger.info(f"Model file missing or incomplete, downloading: {path.name}")
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".part")
    try:
        urllib.request.urlretrieve(url, tmp_path)
        if tmp_path.stat().st_size < _MIN_EXPECTED_BYTES:
            raise RuntimeError(f"Downloaded file for {path.name} is suspiciously small ({tmp_path.stat().st_size} bytes) — likely a failed/redirected download, not the real model.")
        tmp_path.replace(path)
        logger.info(f"Downloaded {path.name} ({path.stat().st_size} bytes)")
    except Exception as e:
        if tmp_path.exists():
            tmp_path.unlink()
        raise RuntimeError(
            f"Could not download required model file {path.name} from {url}: {e}\n"
            f"Download it manually instead (see ml-service/README.md) and place it at {path}."
        )

for _path, _url in _MODEL_SOURCES.items():
    _ensure_model(_path, _url)

detector = cv2.FaceDetectorYN_create(str(DETECTOR_MODEL), "", (320, 320), score_threshold=0.7)
recognizer = cv2.FaceRecognizerSF_create(str(RECOGNIZER_MODEL), "")
logger.info("Face engine ready: YuNet detector + SFace recognizer (pure OpenCV, CPU).")

# App Setup
app = FastAPI(
    title="Radiance ML Service",
    description="Face recognition and liveness detection for employee attendance",
    version="3.0.0"
)

# Nothing in this app calls the ML service directly from a browser (the
# Node backend is the only caller, server-to-server, which CORS doesn't
# apply to) — so this is defense-in-depth rather than load-bearing, but it
# was hardcoded to dev-only origins with no way to add a real deployed
# origin without editing code. EXTRA_CORS_ORIGINS lets that be configured
# without a redeploy.
_default_origins = ["http://localhost:5000", "http://localhost:3000", "http://localhost:3001", "http://localhost:5173"]
_extra_origins = [o.strip() for o in os.getenv("EXTRA_CORS_ORIGINS", "").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_default_origins + _extra_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Config
# 0.363 is the OpenCV Zoo's published SFace cosine-similarity match threshold.
COSINE_MATCH_THRESHOLD = float(os.getenv("COSINE_THRESHOLD", "0.363"))
# Lowered from an inherited 50.0 — that value was calibrated (if at all) on
# whole-frame variance, which runs much higher than a tight face-crop's
# variance. A real webcam face crop routinely lands well under 50; 50.0
# caused real users to be rejected as "flat/printed" in practice.
LIVENESS_LAPLACIAN_THRESHOLD = float(os.getenv("LIVENESS_LAPLACIAN_THRESHOLD", "12.0"))
LIVENESS_GLARE_RATIO = float(os.getenv("LIVENESS_GLARE_RATIO", "0.15"))
LIVENESS_MIN_MOTION = float(os.getenv("LIVENESS_MIN_MOTION", "2.0"))  # mean abs pixel diff, 0-255 scale
MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024  # 10MB limit
# The byte-size check above only bounds the *compressed* payload — a small,
# highly-compressible image (e.g. a large solid-color PNG) can still decode
# into a huge pixel buffer (a few hundred MB+) entirely in-process. No real
# webcam/phone capture needs a dimension above this; reject anything larger
# right after decode, before it's used for anything else.
MAX_IMAGE_DIMENSION = 4096

logger.info(f"ML Service starting — engine=OpenCV(YuNet+SFace), cosine_threshold={COSINE_MATCH_THRESHOLD}")

# Pydantic Models
class ImagePayload(BaseModel):
    image: str  # base64-encoded image string

    @field_validator('image')
    @classmethod
    def validate_image_size(cls, v):
        # Strip data URL prefix if present
        if ',' in v:
            v = v.split(',', 1)[1]
        # Check approximate size (base64 is ~33% larger than binary)
        if len(v) > MAX_IMAGE_SIZE_BYTES * 1.37:
            raise ValueError('Image payload too large (max 10MB)')
        return v

class LivenessPayload(BaseModel):
    # Preferred: 2 frames captured ~0.5s apart, enables the motion check below.
    # A single frame still works (backward compatible) but only gets the
    # static texture/glare checks — meaningfully weaker against a still photo.
    images: List[str]

    @field_validator('images')
    @classmethod
    def validate_images(cls, v):
        if not v or len(v) == 0:
            raise ValueError('At least one image is required')
        if len(v) > 3:
            raise ValueError('At most 3 images accepted')
        cleaned = []
        for img in v:
            s = img.split(',', 1)[1] if ',' in img else img
            if len(s) > MAX_IMAGE_SIZE_BYTES * 1.37:
                raise ValueError('Image payload too large (max 10MB)')
            cleaned.append(s)
        return cleaned

class RecognizePayload(BaseModel):
    embedding: List[float]
    candidates: Dict[str, List[float]]

# Helper: Decode Base64 Image
def decode_image(image_b64: str) -> np.ndarray:
    """Decode a base64 string to an OpenCV BGR image."""
    try:
        if ',' in image_b64:
            image_b64 = image_b64.split(',', 1)[1]
        img_bytes = base64.b64decode(image_b64)
        img_array = np.frombuffer(img_bytes, dtype=np.uint8)
        img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Failed to decode image")
        if img.shape[0] > MAX_IMAGE_DIMENSION or img.shape[1] > MAX_IMAGE_DIMENSION:
            raise ValueError(f"Image dimensions too large (max {MAX_IMAGE_DIMENSION}px per side)")
        return img
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image data: {str(e)}")

# Helper: Detect the highest-confidence face in an image
def detect_best_face(img: np.ndarray) -> Optional[np.ndarray]:
    """Run YuNet on the image; returns the top-scoring face row (bbox + 5 landmarks + score), or None."""
    h, w = img.shape[:2]
    if h < 10 or w < 10:
        return None
    detector.setInputSize((w, h))
    _, faces = detector.detect(img)
    if faces is None or len(faces) == 0:
        return None
    return max(faces, key=lambda f: f[-1])

# Crop to the detected face's bounding box, with a margin so we keep some
# surrounding skin/hair (pure edge-to-edge face crops can be unnaturally
# smooth). Falls back to the full frame if no face was detected — better to
# be permissive there than to hard-fail on a detection hiccup that isn't
# what liveness is supposed to be checking anyway.
def crop_to_face(img: np.ndarray, face) -> np.ndarray:
    if face is None:
        return img
    h_img, w_img = img.shape[:2]
    x, y, w, h = face[:4]
    margin_x, margin_y = w * 0.25, h * 0.25
    x1 = max(0, int(x - margin_x))
    y1 = max(0, int(y - margin_y))
    x2 = min(w_img, int(x + w + margin_x))
    y2 = min(h_img, int(y + h + margin_y))
    region = img[y1:y2, x1:x2]
    return region if region.size > 0 else img

# Helper: texture/glare check on a single (already face-cropped) frame.
# Measuring the whole frame was the original design here, but a plain wall
# or blurry background behind a person drags the whole-frame variance down
# and falsely reads as "flat/printed" even though the actual face is sharp —
# cropping to the face first is what makes this measurement mean anything.
def analyze_frame(img: np.ndarray) -> dict:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    laplacian_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    is_live_depth = laplacian_var >= LIVENESS_LAPLACIAN_THRESHOLD

    _, bright_mask = cv2.threshold(gray, 220, 255, cv2.THRESH_BINARY)
    bright_ratio = float(np.sum(bright_mask > 0) / gray.size)
    is_live_glare = bright_ratio <= LIVENESS_GLARE_RATIO

    return {
        "passed": bool(is_live_depth and is_live_glare),
        "laplacian_score": round(laplacian_var, 2),
        "bright_pixel_ratio": round(bright_ratio, 4),
        "reason": None if (is_live_depth and is_live_glare) else (
            "Flat image detected (possible print)" if not is_live_depth
            else "Screen glare detected (possible digital screen)"
        )
    }

# Helper: motion between two already-cropped face regions — the check that
# actually needs two frames. A static printed photo held still produces
# near-zero difference here even though its texture alone might pass
# analyze_frame; a live face never sits perfectly still.
def face_region_motion(crop_a: np.ndarray, crop_b: np.ndarray) -> Optional[float]:
    if crop_a.size == 0 or crop_b.size == 0:
        return None
    gray_a = cv2.resize(cv2.cvtColor(crop_a, cv2.COLOR_BGR2GRAY), (96, 96))
    gray_b = cv2.resize(cv2.cvtColor(crop_b, cv2.COLOR_BGR2GRAY), (96, 96))
    diff = cv2.absdiff(gray_a, gray_b)
    return float(np.mean(diff))

def analyze_liveness(images: List[np.ndarray]) -> dict:
    """
    Liveness check, single- or multi-frame:
    1. Laplacian variance + specular glare — per-frame, on the face crop only
    2. Inter-frame motion in the face region — only runs with 2+ frames; this
       is what actually distinguishes a live face from a held-up static photo,
       which the per-frame checks alone cannot.

    NOTE: still a heuristic, not certified anti-spoofing. It meaningfully
    raises the bar past "any single printed photo" — a determined attacker
    with a video replay or a moving prop can still defeat it.
    """
    faces = [detect_best_face(img) for img in images]
    crops = [crop_to_face(img, face) for img, face in zip(images, faces)]

    frame_results = [analyze_frame(c) for c in crops]
    frames_pass = all(r["passed"] for r in frame_results)
    failed_reason = next((r["reason"] for r in frame_results if r["reason"]), None)

    motion_score = None
    motion_pass = True
    if len(images) >= 2:
        motion_score = face_region_motion(crops[0], crops[-1])
        motion_pass = motion_score is None or motion_score >= LIVENESS_MIN_MOTION

    is_live = bool(frames_pass and motion_pass)
    if not frames_pass:
        details = failed_reason
    elif not motion_pass:
        details = "No natural movement detected between frames (possible static photo)"
    else:
        details = "PASS"

    return {
        "is_live": is_live,
        "laplacian_score": frame_results[0]["laplacian_score"],
        "bright_pixel_ratio": frame_results[0]["bright_pixel_ratio"],
        "motion_score": round(motion_score, 3) if motion_score is not None else None,
        "laplacian_threshold": LIVENESS_LAPLACIAN_THRESHOLD,
        "frames_checked": len(images),
        "details": details,
    }

# Endpoints

@app.get("/health")
def health_check():
    """Health check with engine status."""
    return {
        "status": "healthy",
        "service": "Radiance ML Service",
        "engine": "OpenCV YuNet + SFace",
        "cosine_threshold": COSINE_MATCH_THRESHOLD,
    }


@app.post("/liveness-check")
def liveness_check(payload: LivenessPayload):
    """
    Anti-spoofing liveness detection. Send 2 frames captured ~0.5s apart for
    the full check (texture/glare per frame + inter-frame motion); a single
    frame still works but skips the motion check.
    Returns: { is_live, laplacian_score, motion_score, frames_checked, details }
    """
    logger.info(f"[/liveness-check] Processing {len(payload.images)} frame(s)")
    images = [decode_image(img) for img in payload.images]
    result = analyze_liveness(images)
    logger.info(f"[/liveness-check] Result: is_live={result['is_live']}, laplacian={result['laplacian_score']} (threshold={LIVENESS_LAPLACIAN_THRESHOLD}), motion={result['motion_score']}, details={result['details']}")
    return result


@app.post("/extract-embedding")
def extract_embedding(payload: ImagePayload):
    """
    Extract a 128-d SFace embedding from an image.
    Returns: { embedding: [float, ...], face_detected: bool, dimensions: int }
    """
    logger.info("[/extract-embedding] Processing request")
    img = decode_image(payload.image)

    face = detect_best_face(img)
    if face is None:
        raise HTTPException(status_code=422, detail="No face detected. Ensure your face is clearly visible and well-lit.")

    aligned = recognizer.alignCrop(img, face)
    feature = recognizer.feature(aligned)
    embedding = feature.flatten().tolist()

    logger.info(f"[/extract-embedding] Extracted {len(embedding)}-d SFace embedding")
    return {"embedding": embedding, "face_detected": True, "dimensions": len(embedding)}


@app.post("/recognize-face")
def recognize_face(payload: RecognizePayload):
    """
    Match a face embedding against a dictionary of candidates using SFace cosine similarity.
    Returns: { match: bool, matched_id: str | None, confidence: float }

    Confidence is the raw cosine similarity score (higher = more similar).
    Match threshold follows the OpenCV Zoo's published SFace value (0.363).
    """
    logger.info(f"[/recognize-face] Comparing against {len(payload.candidates)} candidates")

    if not payload.candidates:
        return {"match": False, "matched_id": None, "confidence": 0.0}

    target = np.array(payload.embedding, dtype=np.float32).reshape(1, -1)
    best_id = None
    best_score = -1.0

    for emp_id, embedding in payload.candidates.items():
        candidate = np.array(embedding, dtype=np.float32).reshape(1, -1)
        if target.shape[1] != candidate.shape[1]:
            logger.warning(f"Dimension mismatch for candidate {emp_id}: {target.shape[1]} vs {candidate.shape[1]}")
            continue
        try:
            score = float(recognizer.match(target, candidate, cv2.FaceRecognizerSF_FR_COSINE))
        except Exception as e:
            logger.warning(f"Error comparing candidate {emp_id}: {e}")
            continue
        if score > best_score:
            best_score = score
            best_id = emp_id

    matched = bool(best_score >= COSINE_MATCH_THRESHOLD)

    logger.info(f"[/recognize-face] Best match: id={best_id}, score={best_score:.4f}, matched={matched}")
    return {
        "match": matched,
        "matched_id": best_id if matched else None,
        "confidence": round(max(0.0, best_score), 4)
    }


@app.post("/verify-faces")
def verify_faces(payload: dict):
    """
    1:1 face verification between two base64 images.
    Returns: { verified: bool, confidence: float }
    """
    try:
        image1 = payload.get('image1')
        image2 = payload.get('image2')
        if not image1 or not image2:
            raise HTTPException(status_code=400, detail="Both image1 and image2 are required")

        img1 = decode_image(image1)
        img2 = decode_image(image2)

        face1 = detect_best_face(img1)
        face2 = detect_best_face(img2)
        if face1 is None or face2 is None:
            raise HTTPException(status_code=422, detail="No face detected in one or both images.")

        feat1 = recognizer.feature(recognizer.alignCrop(img1, face1))
        feat2 = recognizer.feature(recognizer.alignCrop(img2, face2))
        score = recognizer.match(feat1, feat2, cv2.FaceRecognizerSF_FR_COSINE)

        return {"verified": bool(score >= COSINE_MATCH_THRESHOLD), "confidence": round(float(score), 4)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[/verify-faces] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    logger.info(f"Starting Radiance ML Service on {host}:{port}")
    uvicorn.run("main:app", host=host, port=port, reload=False)
