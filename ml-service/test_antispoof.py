"""
Guards the passive anti-spoofing check.

The dangerous failure here is silent: this model's preprocessing (RGB, scaled
to 0-1) is not validated by onnxruntime. Feed it BGR, or 0-255, and it does
not error — it returns a confident wrong answer. That would either wave
through every printed photo or accuse every real employee of fraud, with
nothing in the logs to indicate why.

Also guards the precedence rule: "too dark to judge" must never be reported
as a spoof verdict. Telling an honest worker in a dim corridor that they look
like a printed photo is both wrong and insulting, and it sends HR chasing a
security incident that did not happen.
"""
import cv2
import numpy as np
import main


def _face_row(x=40.0, y=40.0, w=120.0, h=120.0, score=0.95):
    """A YuNet-shaped detection row: bbox(4) + 5 landmarks(10) + score."""
    return np.array(
        [x, y, w, h,
         x + 0.3 * w, y + 0.35 * h, x + 0.7 * w, y + 0.35 * h,
         x + 0.5 * w, y + 0.55 * h, x + 0.35 * w, y + 0.75 * h, x + 0.65 * w, y + 0.75 * h,
         score],
        np.float32,
    )


def _image(width=640, height=480, value=128):
    return np.full((height, width, 3), value, np.uint8)


# --------------------------------------------------------------- cropping
def test_crop_is_square_and_model_sized():
    crop = main.antispoof_crop(_image(), _face_row())
    assert crop is not None
    assert crop.shape == (128, 128, 3), f'model expects 128x128, got {crop.shape}'


def test_crop_includes_context_around_the_face():
    # The model needs the region *around* the face — a bezel, a paper edge, the
    # hand holding it. A tight recognition crop throws exactly that away.
    #
    # face box  = x 200-300, y 150-250
    # 1.5x crop = x 175-325, y 125-275
    # so this marker sits in the context ring: inside the crop, outside the face.
    face = _face_row(x=200, y=150, w=100, h=100)
    img = _image()
    cv2.rectangle(img, (180, 130), (195, 145), (0, 0, 255), -1)

    crop = main.antispoof_crop(img, face)
    assert crop is not None
    assert crop[:, :, 2].max() > crop[:, :, 0].max(), 'context around the face was cropped away'

    # And a marker fully outside the widened box must NOT be included, or the
    # crop is simply too wide to mean anything.
    outside = _image()
    cv2.rectangle(outside, (0, 0), (40, 40), (0, 0, 255), -1)
    crop_outside = main.antispoof_crop(outside, face)
    assert crop_outside[:, :, 2].max() == crop_outside[:, :, 0].max(), 'crop reached beyond the 1.5x box'


def test_crop_pads_rather_than_failing_when_the_face_is_at_the_frame_edge():
    # Someone standing close and off-centre is normal at a kiosk; the widened
    # box runs off frame and must be padded, not abandoned.
    crop = main.antispoof_crop(_image(), _face_row(x=-30, y=-20, w=140, h=140))
    assert crop is not None
    assert crop.shape == (128, 128, 3)


def test_crop_returns_none_without_a_detected_face():
    assert main.antispoof_crop(_image(), None) is None


# --------------------------------------------------------- preprocessing
def test_preprocessing_is_pinned_to_rgb_zero_to_one_nchw():
    """
    Pins the exact tensor handed to the model.

    Comparing output probabilities cannot do this: on a synthetic flat image
    both correct and incorrect preprocessing happen to say "spoof", so such a
    test would pass while the contract silently rotted. Inspecting the input
    tensor checks the thing that actually matters — and it is the thing that
    fails silently in production, because onnxruntime validates shape but not
    colour order or scale.
    """
    captured = {}

    class Spy:
        def run(self, _outputs, feeds):
            captured['x'] = feeds[main._antispoof_input]
            return [np.array([[3.0, -3.0]], np.float32)]   # confidently "real"

    # A crop with a distinctive blue patch, so channel order is detectable:
    # pure blue is (255, 0, 0) in BGR and (0, 0, 255) in RGB.
    img = _image(value=10)
    cv2.rectangle(img, (60, 60), (180, 180), (255, 0, 0), -1)
    crop = main.antispoof_crop(img, _face_row(x=60, y=60, w=120, h=120))

    original = main.antispoof
    main.antispoof = Spy()
    try:
        p = main.spoof_probability(crop)
    finally:
        main.antispoof = original

    x = captured['x']
    assert x.shape == (1, 3, 128, 128), f'expected NCHW 1x3x128x128, got {x.shape}'
    assert x.dtype == np.float32
    assert 0.0 <= x.min() and x.max() <= 1.0, (
        f'expected 0-1 scaling, got range [{x.min():.1f}, {x.max():.1f}] — '
        'feeding 0-255 does not error, it just returns a confident wrong answer'
    )

    # The blue patch must land in the LAST channel (RGB), not the first (BGR).
    per_channel = [x[0, c].mean() for c in range(3)]
    assert per_channel[2] > per_channel[0], (
        f'channels look like BGR, not RGB (means: {per_channel}) — swapRB was lost'
    )

    # And the softmax over the spy's logits is read from index 1 = spoof.
    assert p < 0.01, 'class 0 must be read as real, class 1 as spoof'


def test_spoof_probability_is_none_when_the_model_is_unavailable():
    original = main.antispoof
    main.antispoof = None
    try:
        assert main.spoof_probability(np.zeros((128, 128, 3), np.uint8)) is None
    finally:
        main.antispoof = original


# ------------------------------------------------------------- precedence
def test_too_dark_is_reported_as_lighting_not_as_a_spoof():
    dark = _image(value=5)          # far below the brightness gate
    result = main.analyze_liveness([dark, dark])
    assert result['is_live'] is False
    assert result['too_dark'] is True
    assert 'attack' not in result['details'].lower(), (
        'a dark frame must not be reported as a presentation attack — the '
        'backend logs that as a security incident against a named employee'
    )


def test_liveness_reports_the_score_and_threshold_it_decided_on():
    result = main.analyze_liveness([_image(value=140), _image(value=140)])
    assert 'spoof_score' in result
    assert 'spoof_threshold' in result
    assert 'antispoof_available' in result
    assert result['spoof_threshold'] == main.LIVENESS_SPOOF_THRESHOLD


def test_liveness_still_works_with_the_antispoof_model_unavailable():
    # A failed 1.8 MB download must not stop everyone clocking in; liveness
    # falls back to the motion and brightness checks.
    original = main.antispoof
    main.antispoof = None
    try:
        result = main.analyze_liveness([_image(value=140), _image(value=140)])
        assert result['antispoof_available'] is False
        assert result['spoof_score'] is None
        assert isinstance(result['is_live'], bool)
    finally:
        main.antispoof = original


def test_a_completely_static_pair_fails_the_motion_check():
    # The motion check is kept precisely because it is orthogonal to the
    # model: an identical pair of frames is not a live face regardless of how
    # convincing the texture looks.
    frame = _image(value=140)
    result = main.analyze_liveness([frame, frame.copy()])
    assert result['is_live'] is False
