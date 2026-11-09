#!/bin/sh
# Charlie LLM service — llama.cpp router mode.
#
# One container serves *several* models: every model under $MODEL_DIR is exposed
# by the router, loaded on demand as soon as a request names it (the `model`
# field of /v1/chat/completions) and kept warm afterwards — a loaded model is
# only evicted when another one needs the memory (--models-max,
# --models-memory-margin) or when the optional idle sleep fires. The brain asks
# for the 4B (conversation) or the 1.7B (background jobs, e.g. the shopping
# list). See llm/README.md.
set -e

MODEL_DIR="${MODEL_DIR:-/app/models}"

# Download one model: download_model <id> <hf-repo> <file.gguf>
download_model() {
    name="$1"
    repo="$2"
    file="$3"
    dir="${MODEL_DIR}/${name}"
    path="${dir}/${file}"

    if [ -f "${path}" ]; then
        echo "[entrypoint] Model found: ${path}, skipping download"
        return
    fi

    # Reuse a model downloaded by the previous single-model layout.
    legacy="${MODEL_DIR}/${file}"
    if [ -f "${legacy}" ]; then
        echo "[entrypoint] Reusing ${legacy} for ${name}"
        mkdir -p "${dir}"
        mv "${legacy}" "${path}"
        return
    fi

    echo "[entrypoint] Downloading ${file} from ${repo}..."
    mkdir -p "${dir}"
    curl -L \
        --progress-bar \
        --retry 5 \
        --retry-delay 5 \
        --retry-connrefused \
        -o "${path}.tmp" \
        "https://huggingface.co/${repo}/resolve/main/${file}"
    mv "${path}.tmp" "${path}"
    echo "[entrypoint] Download complete: ${path}"
}

# MODELS: "<id>=<hf-repo>/<file.gguf>", separated by spaces or commas. Each id
# gets its own folder: llama-server keys a router-served model (and its preset)
# on that folder name, so the ids stay stable for LLM_MODEL /
# LLM_SMALL_TASK_MODEL and for llm/presets/charlie.ini.
FIRST_ID=""
FIRST_FILE=""
MODEL_IDS=""
for entry in $(echo "${MODELS}" | tr ',' ' '); do
    if [ -z "${entry}" ]; then
        continue
    fi
    name="${entry%%=*}"
    rest="${entry#*=}"
    repo="${rest%/*}"
    file="${rest##*/}"
    download_model "${name}" "${repo}" "${file}"
    MODEL_IDS="${MODEL_IDS} ${name}"
    if [ -z "${FIRST_ID}" ]; then
        FIRST_ID="${name}"
        FIRST_FILE="${file}"
    fi
done

echo "[entrypoint] Starting llama-server..."

# Optional GPU offload: set LLAMA_ARG_N_GPU_LAYERS (or LLAMA_N_GPU_LAYERS) to
# offload layers to the GPU. Left unset on CPU-only builds so behavior is
# unchanged.
GPU_ARGS=""
N_GPU_LAYERS="${LLAMA_ARG_N_GPU_LAYERS:-${LLAMA_N_GPU_LAYERS:-}}"
if [ -n "${N_GPU_LAYERS}" ]; then
    echo "[entrypoint] GPU offload requested: --n-gpu-layers ${N_GPU_LAYERS}"
    GPU_ARGS="--n-gpu-layers ${N_GPU_LAYERS}"
fi

# Optional idle sleep: unload a model after N seconds without a request, and
# reload it on the next one (useful to give RAM/VRAM back between sessions).
SLEEP_ARGS=""
if [ -n "${LLAMA_SLEEP_IDLE_SECONDS:-}" ]; then
    echo "[entrypoint] Idle sleep enabled: ${LLAMA_SLEEP_IDLE_SECONDS}s"
    SLEEP_ARGS="--sleep-idle-seconds ${LLAMA_SLEEP_IDLE_SECONDS}"
fi

COMMON_ARGS="--host 0.0.0.0 --port ${LLAMA_PORT} --jinja --cache-type-k q8_0 --cache-type-v q8_0 --prio 1 --reasoning off ${SLEEP_ARGS} ${GPU_ARGS}"

# Probe the binary once: both the router flags and the option names used to
# validate the preset file come from its help output.
LLAMA_HELP="$(/app/llama-server --help 2>&1 || true)"

has_flag() {
    case "${LLAMA_HELP}" in
        *"$1"*) return 0 ;;
        *) return 1 ;;
    esac
}

# Per-model arguments (INI presets). On by default: llama-server builds one
# preset per folder under --models-dir and merges the matching INI section over
# it (name-based cascade), so `[qwen3-1.7b]` only tunes that model.
# This file is the only definition of the per-model tuning: no ctx/batch/threads
# default is passed on the command line. MODELS_PRESET="" disables it, another
# path replaces the file — both then mean "llama.cpp defaults", i.e. the model's
# native context (262144 for the shipped 4B) and its much larger KV cache.
#
# The file is validated before being passed: a section that matches no served
# model, or a key this build does not know (which would make llama-server exit),
# makes the entrypoint ignore the file instead of failing to start.
preset_sections_ok() {
    for section in $(sed -n 's/^[[:space:]]*\[\(.*\)\].*/\1/p' "$1"); do
        case " ${MODEL_IDS} " in
            *" ${section} "*) ;;
            *)
                echo "${section}"
                return 1
                ;;
        esac
    done
    return 0
}

preset_keys_ok() {
    keys="$(sed -n 's/^[[:space:]]*\([A-Za-z_][A-Za-z0-9_]*\)[[:space:]]*=.*/\1/p' "$1")"
    for key in ${keys}; do
        if ! has_flag "${key}"; then
            echo "${key}"
            return 1
        fi
    done
    return 0
}

PRESET_ARGS=""
MODELS_PRESET_FILE="${MODELS_PRESET-/app/presets/charlie.ini}"
if [ -n "${MODELS_PRESET_FILE}" ] && [ -f "${MODELS_PRESET_FILE}" ]; then
    bad_section="$(preset_sections_ok "${MODELS_PRESET_FILE}" || true)"
    bad_key=""
    if [ -z "${bad_section}" ]; then
        bad_key="$(preset_keys_ok "${MODELS_PRESET_FILE}" || true)"
    fi
    if [ -n "${bad_section}" ]; then
        echo "[entrypoint] WARNING: preset section [${bad_section}] matches no served model, ignoring ${MODELS_PRESET_FILE}"
    elif [ -n "${bad_key}" ]; then
        echo "[entrypoint] WARNING: preset key '${bad_key}' unknown to this build, ignoring ${MODELS_PRESET_FILE}"
    else
        echo "[entrypoint] Using per-model presets from ${MODELS_PRESET_FILE}"
        PRESET_ARGS="--models-preset ${MODELS_PRESET_FILE}"
    fi
fi

# Router mode needs a recent llama.cpp build. Fall back to a single-model server
# (chat model) instead of dying at startup when the flags are missing.
if has_flag '--models-dir'; then
    echo "[entrypoint] Router mode, serving: $(echo "${MODELS}" | tr ',' ' ')"
    # shellcheck disable=SC2086
    exec /app/llama-server \
        --models-dir "${MODEL_DIR}" \
        --models-max "${MODELS_MAX:-2}" \
        ${PRESET_ARGS} \
        ${COMMON_ARGS}
fi

echo "[entrypoint] WARNING: this build has no router mode, serving ${FIRST_ID} only"
# shellcheck disable=SC2086
exec /app/llama-server \
    -m "${MODEL_DIR}/${FIRST_ID}/${FIRST_FILE}" \
    -a "${FIRST_ID}" \
    ${COMMON_ARGS}
