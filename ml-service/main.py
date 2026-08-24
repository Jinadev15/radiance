import os
import cv2
import time
import base64
import hmac
import logging
import threading
import urllib.request
import numpy as np
from pathlib import Path
from fastapi import FastAPI, HTTPException, Header, Depends
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
# itself (which this service needs regardless, for image decoding).
MODEL_DIR = Path(__file__).parent / "models"
DETECTOR_MODEL = MODEL_DIR / "face_detection_yunet_2023mar.onnx"
RECOGNIZER_MODEL = MODEL_DIR / "face_recognition_sface_2021dec.onnx"

_MODEL_SOURCES = {
    DETECTOR_MODEL: "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
    RECOGNIZER_MODEL: "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
}
_MIN_EXPECTED_BYTES = 100_000  # a failed download (e.g. an HTML error page) is far smaller than either real model


def _ensure_model(path: Path, url: str) -> None:
    """Fetch a model file if it isn't already present and complete."""
    if path.exists() and path.stat().st_size >= _MIN_EXPECTED_BYTES:
        return
    logger.info(f"Model file missing or incomplete, downloading: {path.name}")
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".part")
    try:
        urllib.request.urlretrieve(url, tmp_path)
        if tmp_path.stat().st_size < _MIN_EXPECTED_BYTES:
            raise RuntimeError(
                f"Downloaded file for {path.name} is suspiciously small "
                f"({tmp_path.stat().st_size} bytes) — likely a failed/redirected download."
            )
        tmp_path.replace(path)
        logger.info(f"Downloaded {path.name} ({path.stat().st_size} bytes)")
    except Exception as e:
        if tmp_path.exists():
            tmp_path.unlink()
        raise RuntimeError(
            f"Could not obtain required model file {path.name} from {url}: {e}\n"
            f"Commit the file to the repo or place it at {path}."
        )


# Model loading must NOT be able to kill the process.
#
# These two files are ~38MB of weights. Loading them at import time and letting
# any failure propagate meant a GitHub outage, a rate-limit, or an ephemeral
# filesystem (which is what a container gets — the disk is wiped on every cold
# start) took the whole service down at boot: uvicorn never started, so the
# backend saw connection refused rather than a diagnosable error, and /health
# could not answer either. Now a failure is captured, /health reports
# "degraded" with the reason, and the face endpoints return a clear 503.
detector = None
recognizer = None
MODEL_LOAD_ERROR: Optional[str] = None
# Serialises access to the OpenCV model objects. cv2's DNN objects are not
# documented as thread-safe, and uvicorn runs sync endpoint handlers in a
# thread pool — concurrent clock-ins at a shift change genuinely do overlap.
_engine_lock = threading.Lock()


def _load_engine() -> None:
    global detector, recognizer, MODEL_LOAD_ERROR
    try:
        for _path, _url in _MODEL_SOURCES.items():
            _ensure_model(_path, _url)
        detector = cv2.FaceDetectorYN_create(str(DETECTOR_MODEL), "", (320, 320), score_threshold=0.7)
        recognizer = cv2.FaceRecognizerSF_create(str(RECOGNIZER_MODEL), "")
        MODEL_LOAD_ERROR = None
        logger.info("Face engine ready: YuNet detector + SFace recognizer (pure OpenCV, CPU).")
    except Exception as e:
        MODEL_LOAD_ERROR = str(e)
        logger.error(f"Face engine FAILED to load — service will report degraded: {e}")


_load_engine()


def require_engine():
    """FastAPI dependency: refuse face work with a clear error if models are absent."""
    if MODEL_LOAD_ERROR is not None or detector is None or recognizer is None:
        raise HTTPException(
            status_code=503,
            detail="Face engine unavailable (models failed to load). Check the ML service logs.",
        )


# App Setup
app = FastAPI(
    title="Radiance ML Service",
    description="Face recognition and liveness detection for employee attendance",
    version="4.0.0"
)

_default_origins = ["http://localhost:5000", "http://localhost:3000", "http://localhost:3001", "http://localhost:5173"]
_extra_origins = [o.strip() for o in os.getenv("EXTRA_CORS_ORIGINS", "").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_default_origins + _extra_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Shared-secret authentication.
#
# This service is deployed on a public URL and previously accepted requests
# from anyone who discovered it — meaning an anonymous caller could burn the
# entire CPU budget on /extract-embedding, and (worse) call /recognize-face
# with candidate embeddings of their own choosing. Only the Node backend ever
# calls this service, server-to-server, so a shared secret is the right shape
# of control. Unset in development so `python main.py` still just works.
ML_SERVICE_TOKEN = os.getenv("ML_SERVICE_TOKEN", "").strip()
if not ML_SERVICE_TOKEN:
    logger.warning(
        "ML_SERVICE_TOKEN not set — this service will accept requests from anyone "
        "who can reach it. Set it (and the matching value on the backend) before deploying."
    )


def require_token(x_ml_token: Optional[str] = Header(default=None, alias="X-ML-Token")):
    if not ML_SERVICE_TOKEN:
        return
    # compare_digest, not ==, so a wrong token can't be recovered by timing.
    if not x_ml_token or not hmac.compare_digest(x_ml_token, ML_SERVICE_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid or missing service token")


# Config
# 0.363 is the OpenCV Zoo's published SFace threshold for 1:1 *verification*
# ("are these two photos the same person"). Identification against a roster of
# hundreds is a different and much harder question — every extra enrolled
# person is another chance for a false match — so the default here is
# deliberately stricter than the published verification figure.
COSINE_MATCH_THRESHOLD = float(os.getenv("COSINE_THRESHOLD", "0.45"))
# The best match must also beat the runner-up by this margin. Without it, a
# top score of 0.40 against a second-best 0.39 was accepted as certainty when
# it is really a coin flip between two people — which is how one employee's
# hours end up credited to another, with no way to explain it afterwards.
MIN_MATCH_MARGIN = float(os.getenv("MIN_MATCH_MARGIN", "0.06"))

LIVENESS_LAPLACIAN_THRESHOLD = float(os.getenv("LIVENESS_LAPLACIAN_THRESHOLD", "12.0"))
LIVENESS_GLARE_RATIO = float(os.getenv("LIVENESS_GLARE_RATIO", "0.15"))
LIVENESS_MIN_MOTION = float(os.getenv("LIVENESS_MIN_MOTION", "2.0"))  # mean abs pixel diff, 0-255 scale
# Reject a frame too dark to judge instead of failing it as "flat/printed".
# Facility shifts start before sunrise and run after dark; a dim, grainy frame
# has low Laplacian variance for reasons that have nothing to do with spoofing,
# and telling a worker "possible printed photo" when the real problem is the
# light is both wrong and insulting.
LIVENESS_MIN_BRIGHTNESS = float(os.getenv("LIVENESS_MIN_BRIGHTNESS", "40.0"))
MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024  # 10MB limit
MAX_IMAGE_DIMENSION = 4096
# Width the face detector runs at. Detection cost scales with pixel count and
# a scan runs it three times, so this is the main throughput lever. Faces are
# still located precisely enough at this width, and the coordinates are mapped
# back so the embedding is always computed from full-resolution pixels.
# See detect_best_face() for the accuracy safeguards.
DETECT_MAX_WIDTH = int(os.getenv("DETECT_MAX_WIDTH", "640"))

logger.info(
    f"ML Service starting — engine=OpenCV(YuNet+SFace), "
    f"cosine_threshold={COSINE_MATCH_THRESHOLD}, min_margin={MIN_MATCH_MARGIN}"
)


# Pydantic Models
class ImagePayload(BaseModel):
    image: str  # base64-encoded image string

    @field_validator('image')
    @classmethod
    def validate_image_size(cls, v):
        if ',' in v:
            v = v.split(',', 1)[1]
        if len(v) > MAX_IMAGE_SIZE_BYTES * 1.37:  # base64 is ~33% larger than binary
            raise ValueError('Image payload too large (max 10MB)')
        return v


class LivenessPayload(BaseModel):
    # Preferred: 2 frames captured ~0.5s apart, which enables the motion check.
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


class CachedEmployee(BaseModel):
    id: str
    site_id: Optional[str] = None
    embeddings: List[List[float]]


class SyncPayload(BaseModel):
    # Opaque token the backend computes from the roster's current state. The
    # ML service never interprets it, only compares it for equality.
    version: str
    employees: List[CachedEmployee]


class CachedRecognizePayload(BaseModel):
    embedding: List[float]
    site_id: Optional[str] = None
    version: str
    threshold: Optional[float] = None
    min_margin: Optional[float] = None


class RecognizePayload(BaseModel):
    embedding: List[float]
    # Each candidate may hold SEVERAL embeddings for one person (different
    # angles and lighting from re-enrolment), matched as best-of. A flat list
    # is still accepted for backward compatibility.
    candidates: Dict[str, List]
    # Optional per-request overrides, so the backend can loosen the margin for
    # a low-stakes lookup without changing the deployment-wide default.
    threshold: Optional[float] = None
    min_margin: Optional[float] = None


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
        # The byte-size cap above bounds only the *compressed* payload — a
        # small, highly-compressible image can still decode into a huge pixel
        # buffer in-process.
        if img.shape[0] > MAX_IMAGE_DIMENSION or img.shape[1] > MAX_IMAGE_DIMENSION:
            raise ValueError(f"Image dimensions too large (max {MAX_IMAGE_DIMENSION}px per side)")
        return img
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image data: {str(e)}")


def _detect_raw(img: np.ndarray) -> Optional[np.ndarray]:
    """One YuNet pass at the image's own resolution."""
    h, w = img.shape[:2]
    if h < 10 or w < 10:
        return None
    with _engine_lock:
        detector.setInputSize((w, h))
        _, faces = detector.detect(img)
    if faces is None or len(faces) == 0:
        return None
    return max(faces, key=lambda f: f[-1])


def detect_best_face(img: np.ndarray) -> Optional[np.ndarray]:
    """
    Locate the most confident face, detecting on a downscaled copy first.

    Detection is the single most expensive step in a scan and its cost scales
    with pixel count: measured at 59.5 ms on the kiosk's native 1280x720
    frame versus 17.4 ms at 640x480. A full scan runs detection three times
    (once to embed, twice for the liveness frames), so this is the difference
    between ~263 and ~589 scans per minute per core — the difference between
    a morning shift change fitting and not fitting.

    Accuracy is preserved two ways:
      * The returned coordinates are scaled back to the ORIGINAL image, and
        alignCrop then crops from the original full-resolution pixels. The
        embedding is computed from exactly the same pixels as before.
      * If the downscaled pass finds nothing, it retries at full resolution.
        Someone standing further back produces a smaller face that a
        downscaled pass can miss; that costs one slow scan rather than a
        false "no face detected".
    """
    h, w = img.shape[:2]
    if h < 10 or w < 10:
        return None

    if w <= DETECT_MAX_WIDTH:
        return _detect_raw(img)

    scale = DETECT_MAX_WIDTH / float(w)
    small = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    face = _detect_raw(small)

    if face is None:
        # Fall back to the full frame rather than declaring no face.
        return _detect_raw(img)

    # YuNet returns [x, y, w, h, 5x(landmark x,y), score] — indices 0..13 are
    # coordinates in the detected image's space, index 14 is the score. Map the
    # coordinates back onto the original so alignCrop reads full-res pixels.
    face = face.copy()
    face[:14] = face[:14] / scale
    return face


def crop_to_face(img: np.ndarray, face) -> np.ndarray:
    """Crop to the detected face with a margin, keeping some surrounding skin/hair."""
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


def analyze_frame(img: np.ndarray) -> dict:
    """Texture/glare/brightness check on a single (already face-cropped) frame."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    mean_brightness = float(np.mean(gray))
    too_dark = mean_brightness < LIVENESS_MIN_BRIGHTNESS

    laplacian_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    is_live_depth = laplacian_var >= LIVENESS_LAPLACIAN_THRESHOLD

    _, bright_mask = cv2.threshold(gray, 220, 255, cv2.THRESH_BINARY)
    bright_ratio = float(np.sum(bright_mask > 0) / gray.size)
    is_live_glare = bright_ratio <= LIVENESS_GLARE_RATIO

    # Darkness is reported as its own distinct outcome, never as a spoof: the
    # fix is a light, and the message has to say so.
    if too_dark:
        reason = "Too dark to scan clearly — please move to better light or turn on a light."
    elif not is_live_depth:
        reason = "Flat image detected (possible print)"
    elif not is_live_glare:
        reason = "Screen glare detected (possible digital screen)"
    else:
        reason = None

    return {
        "passed": bool(not too_dark and is_live_depth and is_live_glare),
        "too_dark": bool(too_dark),
        "mean_brightness": round(mean_brightness, 2),
        "laplacian_score": round(laplacian_var, 2),
        "bright_pixel_ratio": round(bright_ratio, 4),
        "reason": reason,
    }


def face_region_motion(crop_a: np.ndarray, crop_b: np.ndarray) -> Optional[float]:
    """Mean absolute pixel difference between two face crops — the check that needs two frames."""
    if crop_a.size == 0 or crop_b.size == 0:
        return None
    gray_a = cv2.resize(cv2.cvtColor(crop_a, cv2.COLOR_BGR2GRAY), (96, 96))
    gray_b = cv2.resize(cv2.cvtColor(crop_b, cv2.COLOR_BGR2GRAY), (96, 96))
    diff = cv2.absdiff(gray_a, gray_b)
    return float(np.mean(diff))


def analyze_liveness(images: List[np.ndarray]) -> dict:
    """
    Liveness check, single- or multi-frame:
    1. Brightness gate — reject "can't tell" rather than guessing "spoof"
    2. Laplacian variance + specular glare, per frame, on the face crop only
    3. Inter-frame motion in the face region — needs 2+ frames; this is what
       actually distinguishes a live face from a held-up static photo

    NOTE: still a heuristic, not certified anti-spoofing. It raises the bar
    well past "any printed photo", but a determined attacker with a video
    replay can still defeat it — which is why every failure is logged and
    attributed by the backend.
    """
    faces = [detect_best_face(img) for img in images]
    crops = [crop_to_face(img, face) for img, face in zip(images, faces)]

    frame_results = [analyze_frame(c) for c in crops]
    frames_pass = all(r["passed"] for r in frame_results)
    failed_reason = next((r["reason"] for r in frame_results if r["reason"]), None)
    too_dark = any(r["too_dark"] for r in frame_results)

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
        # Lets the backend distinguish "bad conditions, ask them to retry" from
        # "looks like a spoof, log it" — the two must not be conflated.
        "too_dark": too_dark,
        "mean_brightness": frame_results[0]["mean_brightness"],
        "laplacian_score": frame_results[0]["laplacian_score"],
        "bright_pixel_ratio": frame_results[0]["bright_pixel_ratio"],
        "motion_score": round(motion_score, 3) if motion_score is not None else None,
        "laplacian_threshold": LIVENESS_LAPLACIAN_THRESHOLD,
        "frames_checked": len(images),
        "details": details,
    }


# ---------------------------------------------------------------------------
# Vectorised candidate matching
# ---------------------------------------------------------------------------
# The previous implementation looped in Python and called recognizer.match()
# once per candidate. At 500 employees that is 500 OpenCV calls for every
# single scan; at 2000 it times out. SFace cosine similarity is just a dot
# product of L2-normalised vectors, so the whole roster can be compared in one
# NumPy matrix-vector multiply — roughly two orders of magnitude faster, and
# it yields the runner-up score for free, which is what the margin check needs.

def _normalise_rows(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    # Guard a zero vector (a corrupt stored embedding) against divide-by-zero;
    # it scores 0 against everything, which is the correct outcome.
    norms[norms == 0] = 1.0
    return matrix / norms


def _flatten_candidates(candidates: Dict[str, List], dim: int):
    """
    Build a matrix of every stored embedding plus a parallel list of owner ids.
    Accepts either a flat embedding per candidate or a list of embeddings
    (multiple enrolment captures for one person).
    """
    vectors: List[List[float]] = []
    owners: List[str] = []
    skipped = 0

    for emp_id, value in candidates.items():
        if not value:
            continue
        # A list of lists means several embeddings for this person.
        embeddings = value if isinstance(value[0], (list, tuple)) else [value]
        for emb in embeddings:
            if not isinstance(emb, (list, tuple)) or len(emb) != dim:
                skipped += 1
                continue
            vectors.append(list(emb))
            owners.append(emp_id)

    if not vectors:
        return None, [], skipped
    return np.asarray(vectors, dtype=np.float32), owners, skipped


def _rank(
    matrix: np.ndarray,
    owners: List[str],
    probe: List[float],
    threshold: float,
    min_margin: float,
    skipped: int = 0,
    prenormalised: bool = False,
) -> dict:
    """
    Score one probe against a matrix of candidate embeddings.

    Shared by both the cached and the payload-carrying match paths so the two
    can never drift on the thing that matters most — how a match is decided.
    `prenormalised` skips re-normalising a cached matrix that was already
    normalised at sync time.
    """
    target = np.asarray(probe, dtype=np.float32).reshape(1, -1)
    rows = matrix if prenormalised else _normalise_rows(matrix)
    scores = (rows @ _normalise_rows(target).T).ravel()

    # Best score *per person*, not per stored embedding — otherwise someone
    # with five enrolment captures would occupy both the best and runner-up
    # slots and defeat the margin check entirely.
    best_by_owner: Dict[str, float] = {}
    for owner, score in zip(owners, scores):
        current = best_by_owner.get(owner)
        if current is None or score > current:
            best_by_owner[owner] = float(score)

    ranked = sorted(best_by_owner.items(), key=lambda kv: kv[1], reverse=True)
    best_id, best_score = ranked[0]
    runner_up_id, runner_up_score = (ranked[1] if len(ranked) > 1 else (None, None))

    # With only one enrolled person there is no runner-up to compare against,
    # so the margin is undefined; the threshold alone decides.
    margin = None if runner_up_score is None else round(best_score - runner_up_score, 4)

    above_threshold = best_score >= threshold
    margin_ok = margin is None or margin >= min_margin
    matched = bool(above_threshold and margin_ok)

    if matched:
        reason = "match"
    elif not above_threshold:
        reason = "below_threshold"
    else:
        reason = "ambiguous_margin"

    return {
        "match": matched,
        "matched_id": best_id if matched else None,
        "confidence": round(max(0.0, best_score), 4),
        "margin": margin,
        "runner_up_id": runner_up_id,
        "runner_up_confidence": None if runner_up_score is None else round(max(0.0, runner_up_score), 4),
        "candidates_compared": len(best_by_owner),
        "candidates_skipped": skipped,
        "reason": reason,
    }


def _empty_match(skipped: int = 0, reason: str = "no_comparable_candidates") -> dict:
    return {
        "match": False, "matched_id": None, "confidence": 0.0,
        "margin": None, "runner_up_id": None, "runner_up_confidence": None,
        "candidates_compared": 0, "candidates_skipped": skipped,
        "reason": reason,
    }


def match_embedding(
    probe: List[float],
    candidates: Dict[str, List],
    threshold: float,
    min_margin: float,
) -> dict:
    matrix, owners, skipped = _flatten_candidates(candidates, len(probe))
    if matrix is None:
        return _empty_match(skipped)
    return _rank(matrix, owners, probe, threshold, min_margin, skipped)


# ---------------------------------------------------------------------------
# Resident embedding cache
# ---------------------------------------------------------------------------
# Sending the whole roster's embeddings on every scan does not survive real
# scale. Measured against this deployment's actual size (4,000 employees, 126
# sites), the candidate payload was 13.6 MB *per scan* — roughly 1.8 GB/minute
# of backend->ML traffic at a morning shift change, and enough resident memory
# per concurrent request to OOM a small instance outright.
#
# The embeddings barely ever change, so they live here instead: pushed once by
# the backend, held as one pre-normalised float32 matrix, and re-pushed only
# when an employee is enrolled, approved, re-enrolled or deactivated. A scan
# then carries only the probe vector.
#
# 4,000 employees x ~1.2 embeddings x 128 float32 = under 3 MB resident. The
# per-site row index lets a site-scoped scan compare against just that site's
# roster, which is both faster and materially more accurate (fewer candidates
# means fewer chances for a false match).
_cache_lock = threading.RLock()
_cache_version: Optional[str] = None
_cache_rows: Optional[np.ndarray] = None      # (M, D) L2-normalised
_cache_owners: List[str] = []                 # length M, employee id per row
_cache_site_rows: Dict[str, np.ndarray] = {}  # site id -> row indices into _cache_rows
_cache_people = 0
_cache_synced_at: Optional[float] = None


def _rebuild_cache(version: str, employees: List[dict]) -> dict:
    """Replace the resident cache. Returns a summary for the sync response."""
    global _cache_version, _cache_rows, _cache_owners, _cache_site_rows
    global _cache_people, _cache_synced_at

    vectors: List[List[float]] = []
    owners: List[str] = []
    site_rows: Dict[str, List[int]] = {}
    skipped = 0
    dim: Optional[int] = None

    for emp in employees:
        emp_id = emp.get("id")
        embeddings = emp.get("embeddings") or []
        site_id = emp.get("site_id")
        if not emp_id or not embeddings:
            continue
        for emb in embeddings:
            if not isinstance(emb, (list, tuple)) or len(emb) == 0:
                skipped += 1
                continue
            if dim is None:
                dim = len(emb)
            elif len(emb) != dim:
                # A mixed-dimension roster would silently corrupt the matrix.
                skipped += 1
                continue
            idx = len(vectors)
            vectors.append(list(emb))
            owners.append(emp_id)
            if site_id:
                site_rows.setdefault(site_id, []).append(idx)

    with _cache_lock:
        if not vectors:
            _cache_version = version
            _cache_rows = None
            _cache_owners = []
            _cache_site_rows = {}
            _cache_people = 0
            _cache_synced_at = time.time()
        else:
            # Normalise once here, not per scan.
            _cache_rows = _normalise_rows(np.asarray(vectors, dtype=np.float32))
            _cache_owners = owners
            _cache_site_rows = {s: np.asarray(idxs, dtype=np.int32) for s, idxs in site_rows.items()}
            _cache_version = version
            _cache_people = len(set(owners))
            _cache_synced_at = time.time()

    return {
        "version": version,
        "people": _cache_people,
        "embeddings": len(vectors),
        "sites": len(site_rows),
        "skipped": skipped,
        "bytes": int(_cache_rows.nbytes) if _cache_rows is not None else 0,
    }


def _match_cached(probe: List[float], site_id: Optional[str], threshold: float, min_margin: float) -> dict:
    with _cache_lock:
        rows = _cache_rows
        owners = _cache_owners
        site_index = _cache_site_rows.get(site_id) if site_id else None

    if rows is None:
        return _empty_match(reason="cache_empty")

    if site_id:
        if site_index is None or len(site_index) == 0:
            # The site is known to the backend but has nobody enrolled here.
            return _empty_match(reason="no_candidates_at_site")
        subset = rows[site_index]
        subset_owners = [owners[i] for i in site_index]
        return _rank(subset, subset_owners, probe, threshold, min_margin, prenormalised=True)

    return _rank(rows, owners, probe, threshold, min_margin, prenormalised=True)


# Endpoints

@app.get("/health")
def health_check():
    """Health check. Reports degraded (not healthy) when the models failed to load."""
    ready = MODEL_LOAD_ERROR is None and detector is not None and recognizer is not None
    with _cache_lock:
        cache = {
            "version": _cache_version,
            "people": _cache_people,
            "embeddings": 0 if _cache_rows is None else int(_cache_rows.shape[0]),
            "sites": len(_cache_site_rows),
            "bytes": 0 if _cache_rows is None else int(_cache_rows.nbytes),
            "synced_at": _cache_synced_at,
        }
    return {
        "status": "healthy" if ready else "degraded",
        "service": "Radiance ML Service",
        "engine": "OpenCV YuNet + SFace",
        "models_loaded": ready,
        "model_error": MODEL_LOAD_ERROR,
        "cosine_threshold": COSINE_MATCH_THRESHOLD,
        "min_match_margin": MIN_MATCH_MARGIN,
        "auth_required": bool(ML_SERVICE_TOKEN),
        "embedding_cache": cache,
    }


@app.post("/reload-models")
def reload_models(_: None = Depends(require_token)):
    """Retry a failed model load without redeploying the service."""
    _load_engine()
    return {"models_loaded": MODEL_LOAD_ERROR is None, "model_error": MODEL_LOAD_ERROR}


@app.post("/liveness-check")
def liveness_check(payload: LivenessPayload, _: None = Depends(require_token), __: None = Depends(require_engine)):
    """
    Anti-spoofing liveness detection. Send 2 frames captured ~0.5s apart for
    the full check (brightness + texture/glare per frame, plus inter-frame
    motion); a single frame still works but skips the motion check.
    """
    started = time.perf_counter()
    images = [decode_image(img) for img in payload.images]
    result = analyze_liveness(images)
    result["elapsed_ms"] = round((time.perf_counter() - started) * 1000, 1)
    logger.info(
        f"[/liveness-check] frames={len(payload.images)} is_live={result['is_live']} "
        f"brightness={result['mean_brightness']} laplacian={result['laplacian_score']} "
        f"motion={result['motion_score']} details={result['details']} ({result['elapsed_ms']}ms)"
    )
    return result


@app.post("/extract-embedding")
def extract_embedding(payload: ImagePayload, _: None = Depends(require_token), __: None = Depends(require_engine)):
    """Extract a 128-d SFace embedding from an image."""
    started = time.perf_counter()
    img = decode_image(payload.image)

    face = detect_best_face(img)
    if face is None:
        raise HTTPException(status_code=422, detail="No face detected. Ensure your face is clearly visible and well-lit.")

    with _engine_lock:
        aligned = recognizer.alignCrop(img, face)
        feature = recognizer.feature(aligned)
    embedding = feature.flatten().tolist()

    elapsed = round((time.perf_counter() - started) * 1000, 1)
    logger.info(f"[/extract-embedding] {len(embedding)}-d SFace embedding ({elapsed}ms)")
    return {
        "embedding": embedding,
        "face_detected": True,
        "dimensions": len(embedding),
        "elapsed_ms": elapsed,
    }


@app.post("/recognize-face")
def recognize_face(payload: RecognizePayload, _: None = Depends(require_token), __: None = Depends(require_engine)):
    """
    Match a face embedding against candidates using vectorised cosine similarity.

    Returns match/matched_id/confidence plus `margin` (the gap to the runner-up)
    and `reason`. A best score that clears the threshold but sits too close to
    the second-best is rejected as `ambiguous_margin` rather than reported as a
    confident match.
    """
    started = time.perf_counter()

    if not payload.candidates:
        return {
            "match": False, "matched_id": None, "confidence": 0.0, "margin": None,
            "runner_up_id": None, "runner_up_confidence": None,
            "candidates_compared": 0, "candidates_skipped": 0,
            "reason": "no_candidates", "elapsed_ms": 0.0,
        }

    threshold = payload.threshold if payload.threshold is not None else COSINE_MATCH_THRESHOLD
    min_margin = payload.min_margin if payload.min_margin is not None else MIN_MATCH_MARGIN

    result = match_embedding(payload.embedding, payload.candidates, threshold, min_margin)
    result["elapsed_ms"] = round((time.perf_counter() - started) * 1000, 1)

    logger.info(
        f"[/recognize-face] people={result['candidates_compared']} "
        f"best={result['confidence']} margin={result['margin']} "
        f"reason={result['reason']} ({result['elapsed_ms']}ms)"
    )
    return result


@app.post("/sync-embeddings")
def sync_embeddings(payload: SyncPayload, _: None = Depends(require_token)):
    """
    Replace the resident embedding cache.

    Pushed by the backend at startup and whenever the roster changes. No model
    call is involved, so this stays available even if the face engine failed
    to load.
    """
    started = time.perf_counter()
    summary = _rebuild_cache(payload.version, [e.model_dump() for e in payload.employees])
    summary["elapsed_ms"] = round((time.perf_counter() - started) * 1000, 1)
    logger.info(
        f"[/sync-embeddings] version={summary['version']} people={summary['people']} "
        f"embeddings={summary['embeddings']} sites={summary['sites']} "
        f"skipped={summary['skipped']} ({summary['elapsed_ms']}ms)"
    )
    return summary


@app.post("/recognize-cached")
def recognize_cached(payload: CachedRecognizePayload, _: None = Depends(require_token)):
    """
    Identify a probe embedding against the resident cache.

    The scan payload is just the probe vector — the roster is already here.
    If the caller's cache version doesn't match ours (we restarted, or the
    roster changed), this returns `cache_stale` so the backend can re-sync and
    retry rather than matching against a roster it can't verify. Silently
    matching against a stale roster is the dangerous option: it would let a
    deactivated employee keep clocking in.
    """
    started = time.perf_counter()

    with _cache_lock:
        current_version = _cache_version
        has_cache = _cache_rows is not None

    if not has_cache or current_version != payload.version:
        return {
            "cache_stale": True,
            "server_version": current_version,
            "requested_version": payload.version,
            **_empty_match(reason="cache_stale"),
        }

    threshold = payload.threshold if payload.threshold is not None else COSINE_MATCH_THRESHOLD
    min_margin = payload.min_margin if payload.min_margin is not None else MIN_MATCH_MARGIN

    result = _match_cached(payload.embedding, payload.site_id, threshold, min_margin)
    result["cache_stale"] = False
    result["elapsed_ms"] = round((time.perf_counter() - started) * 1000, 1)

    logger.info(
        f"[/recognize-cached] site={payload.site_id or 'all'} "
        f"people={result['candidates_compared']} best={result['confidence']} "
        f"margin={result['margin']} reason={result['reason']} ({result['elapsed_ms']}ms)"
    )
    return result


@app.post("/verify-faces")
def verify_faces(payload: dict, _: None = Depends(require_token), __: None = Depends(require_engine)):
    """
    1:1 face verification between two base64 images. Used by the
    employee-code + face flow, where the identity is asserted up front and
    only has to be confirmed — a far easier and more accurate question than
    identifying one face among hundreds.
    """
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

    with _engine_lock:
        feat1 = recognizer.feature(recognizer.alignCrop(img1, face1))
        feat2 = recognizer.feature(recognizer.alignCrop(img2, face2))
        score = float(recognizer.match(feat1, feat2, cv2.FaceRecognizerSF_FR_COSINE))

    return {"verified": bool(score >= COSINE_MATCH_THRESHOLD), "confidence": round(score, 4)}


@app.post("/compare-embedding")
def compare_embedding(payload: dict, _: None = Depends(require_token)):
    """
    1:1 comparison of a probe embedding against one person's stored
    embeddings. No image decoding and no model call — pure vector maths — so
    it stays fast even on a cold instance.
    """
    probe = payload.get("embedding")
    stored = payload.get("embeddings")
    if not probe or not stored:
        raise HTTPException(status_code=400, detail="Both 'embedding' and 'embeddings' are required")

    result = match_embedding(
        probe,
        {"target": stored},
        float(payload.get("threshold", COSINE_MATCH_THRESHOLD)),
        0.0,  # a 1:1 comparison has no runner-up, so no margin applies
    )
    return {"verified": result["match"], "confidence": result["confidence"]}


if __name__ == "__main__":
    import uvicorn
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    logger.info(f"Starting Radiance ML Service on {host}:{port}")
    uvicorn.run("main:app", host=host, port=port, reload=False)
