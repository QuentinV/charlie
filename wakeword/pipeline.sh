#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Charlie wake-word pipeline orchestrator
#
# Usage:
#   ./pipeline.sh {stage1-data|stage2-traps|stage3-train|stage4-export|stage5-verify|all|help}
#
# Environment:
#   ML_BASE=cpu            build/run the trainer without GPU support
#   CUDA_VISIBLE_DEVICES=0 select the GPU
# ---------------------------------------------------------------------------
set -euo pipefail

STAGE="${1:-help}"

# Resolve the directory containing this script so the pipeline can be invoked
# from anywhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ML="docker compose run --rm ml-trainer"

run_ml() {
    # shellcheck disable=SC2086
    $ML "$@"
}

case "$STAGE" in
    stage1-data)
        echo "=== [Phase 1/5] Generating positive dataset & ingesting user samples ==="
        run_ml python3 dataset_gen/generate_positives.py
        run_ml python3 dataset_gen/ingest_user_samples.py
        ;;

    stage2-traps)
        echo "=== [Phase 2/5] Generating phonetic traps, negatives & augmentations ==="
        run_ml python3 dataset_gen/generate_phonetic_traps.py
        run_ml python3 dataset_gen/download_negative_datasets.py
        run_ml python3 dataset_gen/augment.py
        ;;

    stage3-train)
        echo "=== [Phase 3/5] Training the streaming model (streaming + INT8 is produced by microWakeWord) ==="
        run_ml python3 training/train.py --config training/training_parameters.yaml
        ;;

    stage4-export)
        echo "=== [Phase 4/5] Exporting C headers into the echo-devices library ==="
        run_ml python3 training/export_headers.py
        ;;

    stage5-verify)
        echo "=== [Phase 5/5] Host-side streaming parity & model sanity checks ==="
        run_ml python3 training/verify.py
        ;;

    all)
        echo "=== Running full pipeline end-to-end ==="
        "$0" stage1-data
        "$0" stage2-traps
        "$0" stage3-train
        "$0" stage4-export
        "$0" stage5-verify
        ;;

    help|*)
        echo "Usage: ./pipeline.sh {stage1-data|stage2-traps|stage3-train|stage4-export|stage5-verify|all}"
        exit 1
        ;;
esac
