"""Phase 3 — drive microWakeWord training and produce the streaming model.

microWakeWord (OHF-Voice/micro-wake-word) has NO `micro_wake_word.train` CLI and
is NOT a PyPI package. The supported training driver is its Jupyter notebook
(`notebooks/basic_training_notebook.ipynb`) running against the `microwakeword`
package from the checkout.

This wrapper:
  1. validates that the dataset inputs exist,
  2. translates training_parameters.yaml into a microWakeWord-format config,
  3. executes the notebook headlessly with papermill,
  4. copies the produced <model_name>.tflite (+ .json) into output/.

Usage:
    python3 training/train.py --config training/training_parameters.yaml
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent


def _mw_home() -> Path:
    home = os.environ.get("MICROWAKEWORD_HOME", "/opt/micro-wake-word")
    p = Path(home)
    if not p.exists():
        sys.exit(
            f"[train] microWakeWord checkout not found at {p}.\n"
            "        It is cloned inside the ml-trainer image (see Dockerfile.ml).\n"
            "        Set MICROWAKEWORD_HOME if you cloned it elsewhere."
        )
    return p


def _require_inputs(cfg: dict) -> None:
    missing = []
    for group in ("positives", "traps", "ambient"):
        for rel in cfg.get(group, []) or []:
            d = (ROOT / rel).resolve()
            if not d.exists() or not any(d.rglob("*.wav")):
                missing.append(f"{group}: {rel}")
    if missing:
        sys.exit(
            "[train] missing dataset inputs — run stage1-data / stage2-traps first:\n  - "
            + "\n  - ".join(missing)
        )


def _build_mw_config(cfg: dict, mw_home: Path) -> Path:
    """Translate our YAML into the microWakeWord training config.

    microWakeWord's notebook reads a `training_parameters.yaml` describing the
    feature sets with sampling_weight / penalty_weight / truth flags. We emit a
    best-effort equivalent; the authoritative schema lives in the notebook and
    may evolve, so we keep the mapping in one place here.
    """
    out_dir = (ROOT / cfg.get("output_dir", "output")).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    mw_cfg_dir = out_dir / "mw_config"
    mw_cfg_dir.mkdir(parents=True, exist_ok=True)

    train = cfg.get("training", {}) or {}

    def feature(rel: str, kind: str, truth: bool, penalty: float) -> dict:
        return {
            "features_dir": str((ROOT / rel).resolve()),
            "sampling_weight": 1.0,
            "penalty_weight": penalty,
            "truth": truth,
            "truncation_strategy": "truncate_start" if truth else "random",
            "type": kind,
        }

    features = []
    for rel in cfg.get("positives", []) or []:
        features.append(
            feature(rel, "positive", True, float(train.get("penalty_weight_positive_mistakes", 5.0)))
        )
    for rel in cfg.get("traps", []) or []:
        features.append(feature(rel, "negative", False, float(train.get("negative_class_weight", 5.0))))
    for rel in cfg.get("ambient", []) or []:
        features.append(feature(rel, "ambient", False, float(train.get("negative_class_weight", 5.0))))

    mw_cfg = {
        "window_step_ms": int(cfg.get("window_step_ms", 10)),
        "features": features,
        "model_name": cfg.get("model_name", "charlie"),
        "training": train,
        "false_positive_targets": cfg.get("false_positive_targets", [1.0]),
    }

    yaml_path = mw_cfg_dir / "training_parameters.yaml"
    yaml_path.write_text(yaml.safe_dump(mw_cfg, sort_keys=False))
    return yaml_path


def _run_notebook(mw_home: Path, mw_cfg: Path, model_name: str) -> None:
    notebook = mw_home / "notebooks" / "basic_training_notebook.ipynb"
    if not notebook.exists():
        sys.exit(f"[train] training notebook not found at {notebook}")

    try:
        import papermill as pm  # type: ignore
    except ImportError:
        sys.exit(
            "[train] papermill is required to execute the microWakeWord notebook.\n"
            "        Add `papermill` to requirements.txt and rebuild the image."
        )

    out_nb = mw_cfg.parent / "training_executed.ipynb"
    print(f"[train] executing {notebook}")
    pm.execute_notebook(
        str(notebook),
        str(out_nb),
        parameters={"training_config": str(mw_cfg), "model_name": model_name},
        cwd=str(mw_home),
        kernel_name="python3",
    )


def _collect_outputs(mw_home: Path, cfg: dict) -> None:
    out_dir = (ROOT / cfg.get("output_dir", "output")).resolve()
    model_name = cfg.get("model_name", "charlie")

    # microWakeWord writes into the notebook working dir; search for the result.
    candidates = list(mw_home.rglob(f"{model_name}.tflite")) + list(out_dir.rglob(f"{model_name}.tflite"))
    if not candidates:
        print(f"[train] WARNING: no {model_name}.tflite found — check the notebook output.")
        return

    src = max(candidates, key=lambda p: p.stat().st_mtime)
    dst = out_dir / src.name
    shutil.copy2(src, dst)
    print(f"[train] model → {dst}")

    json_src = src.with_suffix(".tflite.json")
    if json_src.exists():
        shutil.copy2(json_src, out_dir / json_src.name)
        print(f"[train] manifest → {out_dir / json_src.name}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="training/training_parameters.yaml")
    args = parser.parse_args()

    cfg = yaml.safe_load(Path(args.config).read_text())
    model_name = cfg.get("model_name", "charlie")

    _require_inputs(cfg)
    mw_home = _mw_home()
    mw_cfg = _build_mw_config(cfg, mw_home)
    print(f"[train] microWakeWord config → {mw_cfg}")

    _run_notebook(mw_home, mw_cfg, model_name)
    _collect_outputs(mw_home, cfg)


if __name__ == "__main__":
    main()
