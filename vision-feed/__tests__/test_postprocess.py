"""Pure ONNX post-processing tests — no model, no onnxruntime, no torch."""
import numpy as np

from pipeline import postprocess


def test_letterbox_pads_to_square_and_reports_the_mapping():
    img = np.zeros((100, 200, 3), dtype=np.uint8)  # h=100, w=200
    padded, ratio, pad = postprocess.letterbox(img, (640, 640))
    assert padded.shape == (640, 640, 3)
    # 200x100 scales by 3.2 → 640x320, padded top/bottom by 160 each.
    assert abs(ratio - 3.2) < 1e-6
    assert pad == (0, 160)


def test_scale_boxes_maps_back_through_the_letterbox():
    boxes = postprocess.scale_boxes(
        [[20, 20, 40, 40]], ratio=2.0, pad=(0, 0), orig_shape=(100, 100, 3)
    )
    assert boxes.tolist() == [[10.0, 10.0, 20.0, 20.0]]


def test_scale_boxes_clips_to_the_frame():
    boxes = postprocess.scale_boxes(
        [[-5, -5, 500, 500]], ratio=1.0, pad=(0, 0), orig_shape=(100, 100, 3)
    )
    assert boxes.tolist() == [[0.0, 0.0, 100.0, 100.0]]


def test_nms_keeps_the_best_of_overlapping_boxes():
    boxes = [[0, 0, 10, 10], [1, 1, 11, 11], [100, 100, 110, 110]]
    scores = [0.9, 0.8, 0.7]
    # The second overlaps the first (IoU 0.68) and is dropped.
    assert postprocess.nms(boxes, scores, 0.5) == [0, 2]


def test_decode_end_to_end_head_filters_by_confidence():
    out = np.array(
        [[[10, 20, 30, 40, 0.9, 0], [1, 2, 3, 4, 0.1, 1]]], dtype=np.float32
    )
    rows = postprocess.decode(out, conf_thres=0.5, iou_thres=0.45)
    assert len(rows) == 1
    cls_id, conf, box = rows[0]
    assert cls_id == 0
    assert abs(conf - 0.9) < 1e-6
    assert box == (10.0, 20.0, 30.0, 40.0)


def test_decode_raw_head_returns_xyxy():
    # 1 box, 2 classes: [1, 4+2, 1]; cx,cy,w,h = 100,100,20,20 → (90,90,110,110).
    out = np.array(
        [[[100], [100], [20], [20], [0.9], [0.1]]], dtype=np.float32
    )
    rows = postprocess.decode(out, conf_thres=0.5, iou_thres=0.45)
    assert len(rows) == 1
    cls_id, conf, box = rows[0]
    assert cls_id == 0
    assert box == (90.0, 90.0, 110.0, 110.0)


def test_decode_empty_when_nothing_passes():
    out = np.array([[[0, 0, 1, 1, 0.1, 0]]], dtype=np.float32)
    assert postprocess.decode(out, conf_thres=0.5, iou_thres=0.45) == []
