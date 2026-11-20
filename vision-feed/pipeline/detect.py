"""Tier 1 — the nano detector, **ONNX Runtime only**.

The model is an exported YOLO26n ONNX (`export.py`, a build/dev tool kept in
`requirements-export.txt`); the runtime never needs torch. `onnxruntime` is
imported lazily so the pure post-processing tests run without it, and the ONNX
session tunes itself for the host CPU at creation (graph optimisation + ISA-
specific kernels) with a host-local optimized-graph cache.
"""
import os
from dataclasses import dataclass

import numpy as np

import config
from pipeline import postprocess


@dataclass
class Detection:
    cls: str
    conf: float
    box: tuple  # (x1, y1, x2, y2) in pixels


class Detector:
    def __init__(self, model_path=None, conf=None, imgsz=None, providers=None):
        import onnxruntime as ort

        self.model_path = model_path or config.resolve_yolo_model()
        if not os.path.exists(self.model_path):
            raise RuntimeError(
                f'ONNX model not found: {self.model_path} '
                f'(run `python export.py --out models`)'
            )
        self.names = config.load_class_names(self.model_path)
        self.conf = config.DETECT_CONF if conf is None else conf
        self.imgsz = imgsz or config.DETECT_IMGSZ

        options = ort.SessionOptions()
        options.graph_optimization_level = (
            ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        )
        options.intra_op_num_threads = config.DETECT_THREADS
        # Cache the host-tuned graph next to the model (per machine, never shipped).
        model_dir = os.path.dirname(os.path.abspath(self.model_path)) or '.'
        if os.access(model_dir, os.W_OK):
            options.optimized_model_filepath = os.path.join(
                model_dir, 'yolo26n.optimized.onnx'
            )

        self.session = ort.InferenceSession(
            self.model_path,
            sess_options=options,
            providers=providers or config.onnx_providers(),
        )
        self.input_name = self.session.get_inputs()[0].name

    def detect(self, frame_bgr: np.ndarray) -> list[Detection]:
        padded, ratio, pad = postprocess.letterbox(
            frame_bgr, (self.imgsz, self.imgsz)
        )
        blob = padded[:, :, ::-1].transpose(2, 0, 1).astype(np.float32) / 255.0
        blob = np.ascontiguousarray(blob[None])

        outputs = self.session.run(None, {self.input_name: blob})
        rows = postprocess.decode(outputs[0], self.conf, config.NMS_IOU)
        if not rows:
            return []

        boxes = postprocess.scale_boxes(
            [row[2] for row in rows], ratio, pad, frame_bgr.shape[:2]
        )
        return [
            Detection(self.names.get(cls_id, str(cls_id)), conf, tuple(box))
            for (cls_id, conf, _), box in zip(rows, boxes)
        ]

