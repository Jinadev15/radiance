# Radiance ML Service

Face detection, recognition, and liveness scoring — pure OpenCV, CPU-only, no paid APIs and no TensorFlow/PyTorch.

## Engine

Uses OpenCV's built-in DNN-based face pipeline, both models from the official [OpenCV Zoo](https://github.com/opencv/opencv_zoo) (Apache 2.0):

- **Detection** — YuNet (`face_detection_yunet_2023mar.onnx`, ~230KB)
- **Recognition** — SFace (`face_recognition_sface_2021dec.onnx`, ~37MB), 128-d embeddings

This was chosen over a DeepFace/TensorFlow pipeline specifically because TensorFlow has a documented history of failing to load on Windows in this project (DLL errors), which would silently degrade attendance matching to a placeholder feature vector with no real accuracy. OpenCV's wheels are prebuilt for Windows/Linux/macOS with no compilation step, so this pipeline has one dependency (OpenCV) instead of four (OpenCV + NumPy + SciPy + TensorFlow + DeepFace + MTCNN).

## Setup

```bash
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
```

Download the two model files (one-time, ~38MB total):

```bash
mkdir models
curl -L -o models/face_detection_yunet_2023mar.onnx https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx
curl -L -o models/face_recognition_sface_2021dec.onnx https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx
```

Copy `.env.example` to `.env` and adjust if needed, then run:

```bash
python main.py
```

Service listens on `http://localhost:8000` by default. `GET /health` confirms both models loaded.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /liveness-check` | Blur/glare heuristic on each frame, plus inter-frame motion in the face region when 2 frames are sent (`images: [frame1, frame2]`) — the motion check is what actually catches a held-up static photo, which per-frame texture checks alone cannot. One frame still works, just without the motion signal. |
| `POST /extract-embedding` | Returns a 128-d SFace embedding for a face image |
| `POST /recognize-face` | Cosine-similarity match against a dict of candidate embeddings (threshold 0.363) |
| `POST /verify-faces` | 1:1 comparison between two images |

None of this is certified anti-spoofing — it's a meaningful, free, local bar above "any single printed photo passes," not a guarantee against a determined attacker with video replay.
