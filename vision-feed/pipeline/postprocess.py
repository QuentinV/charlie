"""Pure post-processing for the ONNX detector: letterbox, box decode, NMS.

`decode`, `nms` and `scale_boxes` are numpy-only and unit-tested without a model
(`__tests__/test_postprocess.py`). `letterbox` needs OpenCV, imported lazily so
the module (and the pure tests) load without it.
"""
import numpy as np


def letterbox(image, new_shape=(640, 640), color=114, scaleup=True):
    """Resize + pad an HxWx3 uint8 image, keeping aspect ratio.

    Returns `(padded_uint8, ratio, (pad_x, pad_y))` — the ratio/pad map model-space
    boxes back onto the original frame (`scale_boxes`).
    """
    import cv2

    h, w = image.shape[:2]
    ratio = min(new_shape[0] / h, new_shape[1] / w)
    if not scaleup:
        ratio = min(ratio, 1.0)

    new_w, new_h = int(round(w * ratio)), int(round(h * ratio))
    if (w, h) != (new_w, new_h):
        image = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_LINEAR)

    dw, dh = (new_shape[1] - new_w) / 2, (new_shape[0] - new_h) / 2
    top, bottom = int(round(dh - 0.1)), int(round(dh + 0.1))
    left, right = int(round(dw - 0.1)), int(round(dw + 0.1))
    padded = cv2.copyMakeBorder(
        image,
        top,
        bottom,
        left,
        right,
        cv2.BORDER_CONSTANT,
        value=(color, color, color),
    )
    return padded, ratio, (left, top)


def scale_boxes(boxes, ratio, pad, orig_shape):
    """Map xyxy boxes from the letterboxed model space back to the frame."""
    boxes = np.asarray(boxes, dtype=np.float32).reshape(-1, 4).copy()
    boxes[:, [0, 2]] -= pad[0]
    boxes[:, [1, 3]] -= pad[1]
    boxes /= ratio
    h, w = orig_shape[:2]
    boxes[:, [0, 2]] = boxes[:, [0, 2]].clip(0, w)
    boxes[:, [1, 3]] = boxes[:, [1, 3]].clip(0, h)
    return boxes


def _iou(box, others):
    x1 = np.maximum(box[0], others[:, 0])
    y1 = np.maximum(box[1], others[:, 1])
    x2 = np.minimum(box[2], others[:, 2])
    y2 = np.minimum(box[3], others[:, 3])
    inter = np.clip(x2 - x1, 0, None) * np.clip(y2 - y1, 0, None)
    area_a = (box[2] - box[0]) * (box[3] - box[1])
    area_b = (others[:, 2] - others[:, 0]) * (others[:, 3] - others[:, 1])
    union = area_a + area_b - inter
    return np.where(union > 0, inter / union, 0.0)


def nms(boxes, scores, iou_thres=0.45):
    """Greedy non-maximum suppression; returns the kept indices (best first)."""
    boxes = np.asarray(boxes, dtype=np.float32)
    scores = np.asarray(scores, dtype=np.float32)
    order = scores.argsort()[::-1]
    keep = []
    while order.size:
        i = int(order[0])
        keep.append(i)
        if order.size == 1:
            break
        ious = _iou(boxes[i], boxes[order[1:]])
        order = order[1:][ious <= iou_thres]
    return keep


def decode(output, conf_thres, iou_thres):
    """Decode a YOLO ONNX output → `[(class_id, conf, (x1,y1,x2,y2))]`, model space.

    Handles both the end-to-end NMS-free head (`[N, 6]`, already suppressed) and
    the raw head (`[4+nc, N]`), so the export options can change without touching
    the caller.
    """
    out = np.asarray(output, dtype=np.float32)
    if out.ndim == 3:
        out = out[0]

    # End-to-end: each row is [x1, y1, x2, y2, conf, cls].
    if out.shape[1] == 6 and out.shape[0] != 6:
        rows = out[out[:, 4] >= conf_thres]
        return [
            (int(r[5]), float(r[4]), tuple(float(v) for v in r[:4])) for r in rows
        ]

    # Raw: [4+nc, N] → [N, 4+nc]; no objectness (YOLOv8+), class scores only.
    data = out.T
    xywh = data[:, :4]
    class_scores = data[:, 4:]
    cls_ids = class_scores.argmax(axis=1)
    confs = class_scores[np.arange(class_scores.shape[0]), cls_ids]

    keep = confs >= conf_thres
    xywh, cls_ids, confs = xywh[keep], cls_ids[keep], confs[keep]
    if not xywh.shape[0]:
        return []

    xyxy = np.empty_like(xywh)
    xyxy[:, 0] = xywh[:, 0] - xywh[:, 2] / 2
    xyxy[:, 1] = xywh[:, 1] - xywh[:, 3] / 2
    xyxy[:, 2] = xywh[:, 0] + xywh[:, 2] / 2
    xyxy[:, 3] = xywh[:, 1] + xywh[:, 3] / 2

    kept = nms(xyxy, confs, iou_thres)
    return [
        (int(cls_ids[i]), float(confs[i]), tuple(float(v) for v in xyxy[i]))
        for i in kept
    ]
