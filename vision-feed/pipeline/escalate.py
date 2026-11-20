"""Tier 3 — escalate an interesting event to the VLM.

The brain owns the model choice (fast SmolVLM first, heavy Qwen3-VL fallback)
and the keyframe storage; this only encodes the frame and asks. Kept tiny on
purpose: the pipeline stays a sensor.
"""
import base64

import brain


def encode_jpeg(frame, quality: int = 80):
    """A BGR frame → a `data:image/jpeg;base64,…` URL, or None."""
    import cv2

    ok, buf = cv2.imencode(
        '.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality]
    )
    if not ok:
        return None
    return 'data:image/jpeg;base64,' + base64.b64encode(buf.tobytes()).decode()


def escalate_keyframe(frame, prompt=None):
    """Describe a keyframe via the brain; returns the response dict or None."""
    image = encode_jpeg(frame)
    if not image:
        return None
    result = brain.describe(image, prompt)
    if not result or not result.get('text'):
        return None
    return result
