#pragma once
// ---------------------------------------------------------------------------
// WakeWordEngine — microWakeWord streaming inference for ESP32-S3 (Arduino)
//
// Replaces the Edge Impulse classifier previously used by ESP32HomeAssistant.
// Runs two TFLite Micro models, exactly like ESPHome's micro_wake_word:
//
//   1. preprocessor : raw 16 kHz PCM -> 40-channel log-mel features
//   2. streaming    : features -> wake-word probability (stateful, INT8)
//
// The engine is data-driven: it introspects the interpreter tensors, so it
// adapts to the tensor naming/layout produced by the microWakeWord version in
// use (streaming state inputs are matched to outputs by name, as ESPHome does).
// ---------------------------------------------------------------------------

#include <Arduino.h>
#include <cstddef>
#include <cstdint>

// Defaults mirror a microWakeWord v2 manifest (see output/charlie.tflite.json).
// They are overridden by the generated model/charlie_model_config.h when present.
#ifndef WW_SAMPLE_RATE
#define WW_SAMPLE_RATE 16000
#endif
#ifndef WW_FEATURE_STEP_SIZE
#define WW_FEATURE_STEP_SIZE 10
#endif
#ifndef WW_SLIDING_WINDOW_SIZE
#define WW_SLIDING_WINDOW_SIZE 5
#endif
#ifndef WW_TENSOR_ARENA_SIZE
#define WW_TENSOR_ARENA_SIZE 26080
#endif
#ifndef WW_PREPROCESSOR_ARENA_SIZE
#define WW_PREPROCESSOR_ARENA_SIZE 40960
#endif
#ifndef WW_PROBABILITY_CUTOFF
#define WW_PROBABILITY_CUTOFF 0.97f
#endif

namespace tflite {
class MicroInterpreter;
}

class WakeWordEngine {
public:
    struct Config {
        uint32_t sampleRate = 16000;
        uint16_t featureStepSize = WW_FEATURE_STEP_SIZE;   // ms between features
        uint16_t windowSizeMs = 30;                        // preprocessor window
        uint16_t featureSize = 40;                         // log-mel channels
        uint16_t slidingWindowSize = WW_SLIDING_WINDOW_SIZE;
        float probabilityCutoff = WW_PROBABILITY_CUTOFF;
        uint32_t modelArenaSize = WW_TENSOR_ARENA_SIZE;
        uint32_t preprocessorArenaSize = WW_PREPROCESSOR_ARENA_SIZE;
        bool usePsram = true;
    };

    WakeWordEngine();
    ~WakeWordEngine();

    // Loads the model(s). `preprocessorData` may be null when the streaming
    // model already embeds its frontend.
    bool begin(const unsigned char* modelData, unsigned int modelLen,
               const unsigned char* preprocessorData = nullptr,
               unsigned int preprocessorLen = 0);

    void setConfig(const Config& cfg);
    const Config& config() const { return _cfg; }

    // Clears the feature/audio history and the streaming model state.
    void reset();

    // Feeds `count` mono PCM16 samples. Returns true when the wake word fires.
    bool process(const int16_t* samples, size_t count);

    // Latest smoothed probability in [0, 1].
    float probability() const { return _avgProbability; }

    bool ready() const { return _ready; }

private:
    bool _allocateArenas();
    bool _initModel();
    bool _initPreprocessor();
    void _collectStateTensors();
    void _resetStateTensors();
    bool _runPreprocessor();
    float _runStreamingModel();

    Config _cfg;
    bool _ready = false;

    tflite::MicroInterpreter* _model = nullptr;
    tflite::MicroInterpreter* _pre = nullptr;

    uint8_t* _modelArena = nullptr;
    uint8_t* _preArena = nullptr;

    const unsigned char* _modelData = nullptr;
    unsigned int _modelLen = 0;
    const unsigned char* _preData = nullptr;
    unsigned int _preLen = 0;

    // Streaming state inputs that must be fed back from same-named outputs.
    int _stateInputIndex[8] = {0};
    int _stateOutputIndex[8] = {0};
    int _stateCount = 0;

    int _featureInputIndex = -1;

    // Audio ring buffer (raw samples) and feature smoothing window.
    int16_t* _window = nullptr;
    size_t _windowSamples = 0;
    size_t _windowPos = 0;
    size_t _samplesSinceFeature = 0;

    // Sliding window of the last `slidingWindowSize` frame probabilities.
    float* _probHistory = nullptr;
    size_t _probHistoryPos = 0;
    size_t _probHistoryCount = 0;
    float _avgProbability = 0.0f;
};
