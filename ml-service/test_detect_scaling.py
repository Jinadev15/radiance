"""
Guards the downscaled-detection optimisation.

Detection is the dominant cost in a scan and runs three times per clock-in
(once to embed, twice for liveness frames). Running it on a 640-wide copy
instead of the kiosk's native 1280x720 frame is what takes throughput from
~250 to ~600 scans/min/core — the difference between a 15-minute shift
change for 4,000 employees fitting and not fitting.

The risk being guarded is accuracy: the coordinates must map back to the
original image (so the embedding is still computed from full-resolution
pixels), and a face the small pass misses must fall back to full resolution
rather than being reported as "no face detected".
"""
import numpy as np
import main

# bbox(4) + 5 landmarks(10) + score(1), in ORIGINAL 1280x720 coordinates
TRUTH = np.array(
    [400., 200., 240., 240.,
     460., 260., 580., 260., 520., 320., 470., 380., 570., 380.,
     0.95],
    np.float32,
)
BIG = np.zeros((720, 1280, 3), np.uint8)


def _patched(stub):
    """Swap _detect_raw for a stub, returning a restore callable."""
    original = main._detect_raw
    main._detect_raw = stub
    return lambda: setattr(main, "_detect_raw", original)


def test_coordinates_map_back_to_original_space():
    scale = main.DETECT_MAX_WIDTH / 1280.0
    sizes = []

    def stub(img):
        sizes.append(img.shape[1])
        if img.shape[1] == main.DETECT_MAX_WIDTH:
            row = TRUTH.copy()
            row[:14] = row[:14] * scale     # what YuNet sees on the small copy
            return row
        return None

    restore = _patched(stub)
    try:
        got = main.detect_best_face(BIG)
    finally:
        restore()

    assert sizes == [main.DETECT_MAX_WIDTH], f"should detect once, on the small copy; got {sizes}"
    assert np.abs(got[:14] - TRUTH[:14]).max() < 0.51, "coordinates must land back in original space"
    assert abs(got[14] - TRUTH[14]) < 1e-6, "confidence score must pass through untouched"


def test_falls_back_to_full_resolution_when_small_pass_misses():
    # A face further from the camera can be too small to find on a downscaled
    # frame. That must cost one slow scan, never a false "no face detected".
    sizes = []

    def stub(img):
        sizes.append(img.shape[1])
        return TRUTH.copy() if img.shape[1] == 1280 else None

    restore = _patched(stub)
    try:
        got = main.detect_best_face(BIG)
    finally:
        restore()

    assert got is not None, "must not report 'no face' without trying full resolution"
    assert sizes == [main.DETECT_MAX_WIDTH, 1280], f"expected small-then-full; got {sizes}"
    assert np.abs(got[:14] - TRUTH[:14]).max() < 1e-6, "fallback coords are already original-space"


def test_genuinely_absent_face_still_returns_none():
    restore = _patched(lambda img: None)
    try:
        assert main.detect_best_face(BIG) is None
    finally:
        restore()


def test_small_image_is_not_resized():
    sizes = []

    def stub(img):
        sizes.append(img.shape[1])
        return TRUTH.copy()

    restore = _patched(stub)
    try:
        main.detect_best_face(np.zeros((480, 640, 3), np.uint8))
    finally:
        restore()

    assert sizes == [640], f"an image already within the threshold must not be resized; got {sizes}"


def test_degenerate_images_are_rejected_before_the_detector():
    restore = _patched(lambda img: TRUTH.copy())
    try:
        assert main.detect_best_face(np.zeros((4, 4, 3), np.uint8)) is None
    finally:
        restore()
