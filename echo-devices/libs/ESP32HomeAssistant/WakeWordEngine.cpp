// ---------------------------------------------------------------------------
// WakeWordEngine implementation (see WakeWordEngine.h)
// ---------------------------------------------------------------------------

#include "WakeWordEngine.h"

#include <cstring>

#include <TensorFlowLite_ESP32.h>
#include "esp_heap_caps.h"
#include "esp32-hal-psram.h"

#include "tensorflow/lite/micro/micro_error_reporter.h"
#include "tensorflow/lite/micro/micro_interpreter.h"
#include "tensorflow/lite/micro/micro_mutable_op_resolver.h"
#include "tensorflow/lite/schema/schema_generated.h"

namespace {
constexpr int kMaxStateTensors = 8;

// The op set used by microWakeWord preprocessor + streaming models.
// Registering a superset keeps us robust across microWakeWord versions.
template <typename Resolver>
void registerWakeWordOps(Resolver& r) {
    r.AddConv2D();
    r.AddDepthwiseConv2D();
    r.AddFullyConnected();
    r.AddReshape();
    r.AddSoftmax();
    r.AddLogistic();
    r.AddAdd();
    r.AddSub();
    r.AddMul();
    r.AddDiv();
    r.AddMean();
    r.AddPad();
    r.AddMaximum();
    r.AddMinimum();
    r.AddQuantize();
    r.AddDequantize();
    r.AddTranspose();
    r.AddSplit();
    r.AddStridedSlice();
    r.AddAveragePool2D();
    r.AddMaxPool2D();
    r.AddRelu();
    r.AddRelu6();
}

void* allocateArena(size_t size, bool preferPsram) {
    if (preferPsram && psramFound()) {
        void* p = heap_caps_malloc(size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
        if (p) {
            return p;
        }
    }
    return heap_caps_malloc(size, MALLOC_CAP_8BIT);
}

bool tensorHasFeatureSize(const TfLiteTensor* t, uint16_t featureSize) {
    return t->dims->size >= 1 && t->dims->data[t->dims->size - 1] == featureSize;
}
}  // namespace

WakeWordEngine::WakeWordEngine() {}

WakeWordEngine::~WakeWordEngine() {
    delete _model;
    delete _pre;
    if (_modelArena) heap_caps_free(_modelArena);
    if (_preArena) heap_caps_free(_preArena);
    if (_window) heap_caps_free(_window);
    if (_probHistory) heap_caps_free(_probHistory);
}

void WakeWordEngine::setConfig(const Config& cfg) {
    _cfg = cfg;
}

bool WakeWordEngine::begin(const unsigned char* modelData, unsigned int modelLen,
                           const unsigned char* preprocessorData,
                           unsigned int preprocessorLen) {
    _modelData = modelData;
    _modelLen = modelLen;
    _preData = preprocessorData;
    _preLen = preprocessorLen;

    _windowSamples = (_cfg.windowSizeMs * _cfg.sampleRate) / 1000;   // 480 @ 16 kHz / 30 ms
    _window = static_cast<int16_t*>(heap_caps_malloc(_windowSamples * sizeof(int16_t), MALLOC_CAP_8BIT));
    if (!_window) {
        Serial.println("[ww] failed to allocate audio window");
        return false;
    }
    memset(_window, 0, _windowSamples * sizeof(int16_t));

    _probHistory = static_cast<float*>(
        heap_caps_malloc(_cfg.slidingWindowSize * sizeof(float), MALLOC_CAP_8BIT));
    if (!_probHistory) {
        Serial.println("[ww] failed to allocate probability history");
        return false;
    }
    memset(_probHistory, 0, _cfg.slidingWindowSize * sizeof(float));

    if (!_allocateArenas()) {
        return false;
    }

    if (_preData && _preLen) {
        if (!_initPreprocessor()) {
            return false;
        }
    } else {
        Serial.println("[ww] no preprocessor model supplied — assuming the streaming model embeds its frontend");
    }

    if (!_initModel()) {
        return false;
    }

    reset();
    _ready = true;
    Serial.printf("[ww] engine ready (cutoff=%.2f, window=%u, arena=%u)\n", _cfg.probabilityCutoff,
                  _cfg.slidingWindowSize, _cfg.modelArenaSize);
    return true;
}

bool WakeWordEngine::_allocateArenas() {
    _modelArena = static_cast<uint8_t*>(allocateArena(_cfg.modelArenaSize, _cfg.usePsram));
    if (!_modelArena) {
        Serial.println("[ww] failed to allocate model tensor arena");
        return false;
    }
    if (_preData && _preLen) {
        _preArena = static_cast<uint8_t*>(allocateArena(_cfg.preprocessorArenaSize, _cfg.usePsram));
        if (!_preArena) {
            Serial.println("[ww] failed to allocate preprocessor tensor arena");
            return false;
        }
    }
    return true;
}

bool WakeWordEngine::_initPreprocessor() {
    // The resolver must outlive the interpreter, hence `static`.
    static tflite::MicroMutableOpResolver<24> preResolver;
    static tflite::MicroErrorReporter preError;
    registerWakeWordOps(preResolver);

    _pre = new tflite::MicroInterpreter(tflite::GetModel(_preData), preResolver, _preArena,
                                        _cfg.preprocessorArenaSize, &preError);
    if (_pre->AllocateTensors() != kTfLiteOk) {
        Serial.println("[ww] preprocessor AllocateTensors failed — increase WW_PREPROCESSOR_ARENA_SIZE");
        return false;
    }

    const TfLiteTensor* in = _pre->input(0);
    const TfLiteTensor* out = _pre->output(0);
    Serial.printf("[ww] preprocessor in: %s dims=%d dtype=%d | out: dims=%d dtype=%d\n", in->name,
                  in->dims->size, in->type, out->dims->size, out->type);
    return true;
}

bool WakeWordEngine::_initModel() {
    static tflite::MicroMutableOpResolver<24> modelResolver;
    static tflite::MicroErrorReporter modelError;
    registerWakeWordOps(modelResolver);

    _model = new tflite::MicroInterpreter(tflite::GetModel(_modelData), modelResolver, _modelArena,
                                          _cfg.modelArenaSize, &modelError);
    if (_model->AllocateTensors() != kTfLiteOk) {
        Serial.println("[ww] model AllocateTensors failed — increase WW_TENSOR_ARENA_SIZE");
        return false;
    }

    _collectStateTensors();
    _resetStateTensors();

    Serial.printf("[ww] model: %d input(s), %d output(s), %d streaming state tensor(s)\n",
                  _model->inputs_size(), _model->outputs_size(), _stateCount);
    return true;
}

void WakeWordEngine::_collectStateTensors() {
    _stateCount = 0;
    _featureInputIndex = -1;

    // The feature input is the one whose innermost dimension is the mel count.
    for (int i = 0; i < _model->inputs_size(); i++) {
        if (tensorHasFeatureSize(_model->input(i), _cfg.featureSize)) {
            _featureInputIndex = i;
            break;
        }
    }
    if (_featureInputIndex < 0 && _model->inputs_size() > 0) {
        _featureInputIndex = 0;  // fallback for exotic layouts
    }

    // Every other input is streaming state: pair it with the same-named output
    // (this is how ESPHome feeds microWakeWord's recurrent state back).
    for (int i = 0; i < _model->inputs_size(); i++) {
        if (i == _featureInputIndex) continue;
        const TfLiteTensor* in = _model->input(i);
        for (int o = 0; o < _model->outputs_size(); o++) {
            const TfLiteTensor* out = _model->output(o);
            bool sameShape = out->dims->size == in->dims->size &&
                             memcmp(out->dims->data, in->dims->data,
                                    in->dims->size * sizeof(int)) == 0;
            bool sameName = strcmp(out->name, in->name) == 0;
            if (sameShape && sameName && _stateCount < kMaxStateTensors) {
                _stateInputIndex[_stateCount] = i;
                _stateOutputIndex[_stateCount] = o;
                _stateCount++;
                break;
            }
        }
    }
}

void WakeWordEngine::_resetStateTensors() {
    if (!_model) return;
    for (int s = 0; s < _stateCount; s++) {
        TfLiteTensor* t = _model->input(_stateInputIndex[s]);
        size_t bytes = t->bytes;
        if (t->type == kTfLiteInt8) {
            memset(t->data.int8, 0, bytes);
        } else if (t->type == kTfLiteFloat32) {
            memset(t->data.f, 0, bytes);
        } else if (t->type == kTfLiteInt32) {
            memset(t->data.i32, 0, bytes);
        } else {
            memset(t->data.raw, 0, bytes);
        }
    }
}

bool WakeWordEngine::_runPreprocessor() {
    if (!_pre) {
        return false;
    }
    TfLiteTensor* in = _pre->input(0);

    size_t expected = 1;
    for (int d = 0; d < in->dims->size; d++) {
        expected *= static_cast<size_t>(in->dims->data[d]);
    }
    size_t n = expected < _windowSamples ? expected : _windowSamples;
    size_t offset = _windowSamples - n;  // most recent n samples

    for (size_t i = 0; i < n; i++) {
        int16_t s = _window[(_windowPos + offset + i) % _windowSamples];
        switch (in->type) {
            case kTfLiteInt16: in->data.i16[i] = s; break;
            case kTfLiteInt8: in->data.int8[i] = static_cast<int8_t>(s >> 8); break;
            case kTfLiteFloat32: in->data.f[i] = s / 32768.0f; break;
            default: break;
        }
    }
    for (size_t i = n; i < expected; i++) {
        switch (in->type) {
            case kTfLiteInt16: in->data.i16[i] = 0; break;
            case kTfLiteInt8: in->data.int8[i] = 0; break;
            case kTfLiteFloat32: in->data.f[i] = 0.0f; break;
            default: break;
        }
    }

    return _pre->Invoke() == kTfLiteOk;
}

namespace {
size_t tensorNumElements(const TfLiteTensor* t) {
    size_t n = 1;
    for (int d = 0; d < t->dims->size; d++) {
        n *= static_cast<size_t>(t->dims->data[d]);
    }
    return n;
}

float tensorMaxDequantized(const TfLiteTensor* t) {
    size_t n = tensorNumElements(t);
    float best = -1e9f;
    switch (t->type) {
        case kTfLiteInt8:
            for (size_t i = 0; i < n; i++) {
                float v = (t->data.int8[i] - t->params.zero_point) * t->params.scale;
                if (v > best) best = v;
            }
            break;
        case kTfLiteInt16:
            for (size_t i = 0; i < n; i++) {
                float v = (t->data.i16[i] - t->params.zero_point) * t->params.scale;
                if (v > best) best = v;
            }
            break;
        case kTfLiteFloat32:
            for (size_t i = 0; i < n; i++) {
                if (t->data.f[i] > best) best = t->data.f[i];
            }
            break;
        default:
            break;
    }
    return best;
}
}  // namespace

float WakeWordEngine::_runStreamingModel() {
    if (!_model || _featureInputIndex < 0) {
        return 0.0f;
    }

    // Feature input <- preprocessor output.
    if (_pre) {
        const TfLiteTensor* src = _pre->output(0);
        TfLiteTensor* dst = _model->input(_featureInputIndex);
        size_t n = tensorNumElements(src) < tensorNumElements(dst) ? tensorNumElements(src)
                                                                   : tensorNumElements(dst);
        if (src->type == dst->type) {
            memcpy(dst->data.raw, src->data.raw, n * (src->bytes / tensorNumElements(src)));
        } else {
            for (size_t i = 0; i < n; i++) {
                float v = 0.0f;
                if (src->type == kTfLiteInt8) v = (src->data.int8[i] - src->params.zero_point) * src->params.scale;
                else if (src->type == kTfLiteInt16) v = (src->data.i16[i] - src->params.zero_point) * src->params.scale;
                else if (src->type == kTfLiteFloat32) v = src->data.f[i];
                if (dst->type == kTfLiteInt8) {
                    dst->data.int8[i] = static_cast<int8_t>(v / dst->params.scale + dst->params.zero_point);
                } else if (dst->type == kTfLiteInt16) {
                    dst->data.i16[i] = static_cast<int16_t>(v / dst->params.scale + dst->params.zero_point);
                } else {
                    dst->data.f[i] = v;
                }
            }
        }
    }

    if (_model->Invoke() != kTfLiteOk) {
        return 0.0f;
    }

    // Feed streaming state back (output -> same-named input).
    for (int s = 0; s < _stateCount; s++) {
        TfLiteTensor* dst = _model->input(_stateInputIndex[s]);
        const TfLiteTensor* src = _model->output(_stateOutputIndex[s]);
        size_t bytes = dst->bytes < src->bytes ? dst->bytes : src->bytes;
        memcpy(dst->data.raw, src->data.raw, bytes);
    }

    // The wake-word probability is the non-state output with the highest value.
    float best = 0.0f;
    for (int o = 0; o < _model->outputs_size(); o++) {
        bool isState = false;
        for (int s = 0; s < _stateCount; s++) {
            if (_stateOutputIndex[s] == o) {
                isState = true;
                break;
            }
        }
        if (isState) continue;
        float v = tensorMaxDequantized(_model->output(o));
        if (v > best) best = v;
    }
    return best;
}

void WakeWordEngine::reset() {
    if (_window) {
        memset(_window, 0, _windowSamples * sizeof(int16_t));
    }
    _windowPos = 0;
    _samplesSinceFeature = 0;
    if (_probHistory) {
        memset(_probHistory, 0, _cfg.slidingWindowSize * sizeof(float));
    }
    _probHistoryPos = 0;
    _probHistoryCount = 0;
    _avgProbability = 0.0f;
    _resetStateTensors();
}

bool WakeWordEngine::process(const int16_t* samples, size_t count) {
    if (!_ready || !_window || !_probHistory) {
        return false;
    }

    // The streaming model needs a preprocessor to turn PCM into features.
    if (!_pre) {
        return false;
    }

    const size_t stepSamples = (static_cast<size_t>(_cfg.featureStepSize) * _cfg.sampleRate) / 1000;

    for (size_t i = 0; i < count; i++) {
        _window[_windowPos] = samples[i];
        _windowPos = (_windowPos + 1) % _windowSamples;

        if (++_samplesSinceFeature < stepSamples) {
            continue;
        }
        _samplesSinceFeature = 0;

        if (!_runPreprocessor()) {
            continue;
        }

        float p = _runStreamingModel();

        // Sliding-window smoothing: average the last N frame probabilities.
        _probHistory[_probHistoryPos] = p;
        _probHistoryPos = (_probHistoryPos + 1) % _cfg.slidingWindowSize;
        if (_probHistoryCount < _cfg.slidingWindowSize) {
            _probHistoryCount++;
        }

        float sum = 0.0f;
        for (size_t k = 0; k < _probHistoryCount; k++) {
            sum += _probHistory[k];
        }
        _avgProbability = sum / static_cast<float>(_probHistoryCount);

        if (_probHistoryCount >= _cfg.slidingWindowSize && _avgProbability >= _cfg.probabilityCutoff) {
            return true;
        }
    }

    return false;
}
