"""Benchmark the cascade tiers on a live source.

    python bench.py --source webcam --seconds 15

Times the gate and the detector on real frames. The detector is timed *ungated*
(every frame) — that is the worst case, since the pipeline only runs it on
motion. The first `detect()` call downloads/loads the model, so it is warmed up
before timing.
"""
import argparse
import time

import cv2

from pipeline.detect import Detector
from pipeline.gate import MotionGate
from pipeline.sources import open_source


def main() -> None:
    p = argparse.ArgumentParser(description='vision-feed tier benchmark')
    p.add_argument('--source', default='webcam')
    p.add_argument('--seconds', type=float, default=15.0)
    p.add_argument('--frames', type=int, default=30)
    args = p.parse_args()

    src = open_source(args.source)
    gate = MotionGate(warmup=5)
    detector = Detector()

    first = src.read()
    if first is None:
        raise SystemExit('no frame from the source')
    detector.detect(first)  # warm-up (download/load)
    gate.update(cv2.cvtColor(first, cv2.COLOR_BGR2GRAY))

    g_ms = d_ms = 0.0
    n = 0
    t_end = time.monotonic() + args.seconds
    while n < args.frames and time.monotonic() < t_end:
        frame = src.read()
        if frame is None:
            break
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        t0 = time.perf_counter()
        gate.update(gray)
        g_ms += (time.perf_counter() - t0) * 1000

        t1 = time.perf_counter()
        detector.detect(frame)
        d_ms += (time.perf_counter() - t1) * 1000
        n += 1
    src.close()

    print(
        f'gate {g_ms / max(1, n):.2f} ms/frame; '
        f'detect {d_ms / max(1, n):.2f} ms/frame over {n} frames'
    )


if __name__ == '__main__':
    main()
