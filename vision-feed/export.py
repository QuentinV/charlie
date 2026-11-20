"""Export the YOLO26n detector to ONNX — a **build/dev tool**, never a runtime dep.

`ultralytics` (and its torch) live in `requirements-export.txt`; the container
only ever loads the exported `.onnx` through onnxruntime (see the Dockerfile's
builder stage). Run once, on the host or in the builder:

    python export.py --out models

Writes `models/yolo26n.onnx` + `models/yolo26n.names.json`. The graph is portable
— the per-machine tuning happens at load time inside ONNX Runtime.
"""
import argparse
import json
import os
import shutil


def export(
    out_dir: str,
    weights: str = 'yolo26n.pt',
    imgsz: int = 640,
    nms: bool = True,
    int8: bool = False,
) -> str:
    from ultralytics import YOLO

    os.makedirs(out_dir, exist_ok=True)
    model = YOLO(weights)
    kwargs = dict(
        format='onnx',
        imgsz=imgsz,
        simplify=True,
        opset=12,
        nms=nms,
        dynamic=False,
    )
    if int8:
        # ultralytics renamed this to `quantize` in 8.4; `int8` still works (warns).
        kwargs['int8'] = True
    exported = model.export(**kwargs)

    target = os.path.join(out_dir, 'yolo26n.onnx')
    shutil.move(str(exported), target)

    names = {str(k): v for k, v in (model.names or {}).items()}
    with open(
        os.path.join(out_dir, 'yolo26n.names.json'), 'w', encoding='utf-8'
    ) as handle:
        json.dump(names, handle)

    size_mb = os.path.getsize(target) / 1e6
    print(f'exported {target} ({size_mb:.1f} MB) + yolo26n.names.json')
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description='Export YOLO26n to ONNX')
    parser.add_argument('--out', default='models')
    parser.add_argument('--weights', default='yolo26n.pt')
    parser.add_argument('--imgsz', type=int, default=640)
    parser.add_argument(
        '--no-nms', action='store_true', help='keep the raw head (no baked NMS)'
    )
    parser.add_argument('--int8', action='store_true', help='int8 quantisation')
    args = parser.parse_args()
    export(
        args.out,
        args.weights,
        args.imgsz,
        nms=not args.no_nms,
        int8=args.int8,
    )


if __name__ == '__main__':
    main()
