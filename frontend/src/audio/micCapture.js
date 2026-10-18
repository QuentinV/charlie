// Browser microphone capture for the Charlie ASR pipeline.
//
// Captures the microphone, converts it to mono 16-bit PCM at 16 kHz through
// the `pcm-worklet` AudioWorklet (see /audio-worklet-processor.js) and drives
// a small energy-based VAD so an utterance can be framed as
// start → chunks → end, exactly like the echo devices do.

const SPEECH_RMS = 0.015; // energy threshold that opens an utterance
const SILENCE_MS = 800; // silence that closes it (keep short: it delays ASR)
const MAX_UTTERANCE_MS = 15000; // hard cap so a stuck VAD can't run forever

/** Root-mean-square of an Int16 PCM block, normalised to [0, 1]. */
function rmsOf(pcm) {
    let sum = 0;
    for (let i = 0; i < pcm.length; i++) {
        const v = pcm[i] / 0x8000;
        sum += v * v;
    }
    return pcm.length ? Math.sqrt(sum / pcm.length) : 0;
}

export class MicCapture {
    /**
     * @param {object} [handlers]
     * @param {(info: {manual: boolean}) => void} [handlers.onStart]
     * @param {(chunk: ArrayBuffer) => void} [handlers.onChunk]
     * @param {() => void} [handlers.onEnd]
     * @param {(rms: number) => void} [handlers.onLevel]
     * @param {(error: Error) => void} [handlers.onError]
     */
    constructor(handlers = {}) {
        this.onStart = handlers.onStart ?? (() => {});
        this.onChunk = handlers.onChunk ?? (() => {});
        this.onEnd = handlers.onEnd ?? (() => {});
        this.onLevel = handlers.onLevel ?? (() => {});
        this.onError = handlers.onError ?? (() => {});

        this.ctx = null;
        this.stream = null;
        this.node = null;
        this.source = null;

        /** @type {'idle'|'auto'|'manual'} */
        this.mode = 'idle';
        this.speaking = false;
        this.manual = false;
        this.silenceTimer = null;
        this.maxTimer = null;
    }

    get running() {
        return !!this.node;
    }

    /** Open the microphone and start streaming PCM to the handlers. */
    async start() {
        if (this.node) return true;

        const media = navigator.mediaDevices;
        if (!media?.getUserMedia) {
            this.onError(new Error('insecure-context'));
            return false;
        }

        try {
            this.stream = await media.getUserMedia({
                audio: {
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            });

            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) throw new Error('no-audio-context');

            this.ctx = new Ctx({ sampleRate: 16000 });
            await this.ctx.audioWorklet.addModule(
                '/audio-worklet-processor.js'
            );
            this.node = new AudioWorkletNode(this.ctx, 'pcm-worklet');
            this.node.port.onmessage = (event) => this._onPcm(event.data);
            this.source = this.ctx.createMediaStreamSource(this.stream);
            this.source.connect(this.node);
            // Let the worklet forward PCM to the main thread.
            this.node.port.postMessage({ wsOpen: true });
            if (this.ctx.state === 'suspended') await this.ctx.resume();
            return true;
        } catch (error) {
            this.onError(error);
            await this.stop();
            return false;
        }
    }

    /** Release the microphone. */
    async stop() {
        this._clearTimers();
        this.speaking = false;
        this.manual = false;
        this.mode = 'idle';

        try {
            this.node?.port.postMessage({ wsOpen: false });
        } catch {
            /* best effort */
        }
        try {
            if (this.node) this.node.port.onmessage = null;
            this.node?.disconnect();
        } catch {
            /* best effort */
        }
        try {
            this.source?.disconnect();
        } catch {
            /* best effort */
        }
        try {
            this.stream?.getTracks().forEach((track) => track.stop());
        } catch {
            /* best effort */
        }
        try {
            await this.ctx?.close();
        } catch {
            /* best effort */
        }

        this.node = null;
        this.source = null;
        this.stream = null;
        this.ctx = null;
    }

    /**
     * Set the capture mode:
     * - `'auto'`   — VAD frames utterances (hotword mode);
     * - `'manual'` — push-to-talk, framed by begin()/end();
     * - `'idle'`   — muted (playback, or no listening session).
     */
    setMode(mode) {
        this.mode = mode;
        if (mode === 'idle') this._endUtterance();
    }

    /** Force-open an utterance (push-to-talk press). */
    begin() {
        this.mode = 'manual';
        this._beginUtterance(true);
    }

    /** Force-close the current utterance (push-to-talk release). */
    end() {
        this._endUtterance();
    }

    _onPcm(buffer) {
        if (this.mode === 'idle') return;

        const pcm = new Int16Array(buffer);
        const rms = rmsOf(pcm);
        this.onLevel(rms);

        if (this.mode === 'manual') {
            if (!this.speaking) this._beginUtterance(true);
            this.onChunk(buffer);
            return;
        }

        // auto (hotword): open on speech, close after a silence.
        if (!this.speaking) {
            if (rms >= SPEECH_RMS) {
                this._beginUtterance(false);
                this.onChunk(buffer);
            }
            return;
        }

        this.onChunk(buffer);
        if (rms < SPEECH_RMS) this._resetSilenceTimer();
        else this._clearSilenceTimer();
    }

    _beginUtterance(manual) {
        this._clearTimers();
        this.speaking = true;
        this.manual = manual;
        this.onStart({ manual });
        this.maxTimer = setTimeout(() => this._endUtterance(), MAX_UTTERANCE_MS);
    }

    _endUtterance() {
        if (!this.speaking) return;
        this._clearTimers();
        this.speaking = false;
        const wasManual = this.manual;
        this.manual = false;
        if (wasManual && this.mode === 'manual') this.mode = 'idle';
        this.onEnd();
    }

    _resetSilenceTimer() {
        this._clearSilenceTimer();
        this.silenceTimer = setTimeout(() => this._endUtterance(), SILENCE_MS);
    }

    _clearSilenceTimer() {
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
        }
    }

    _clearTimers() {
        this._clearSilenceTimer();
        if (this.maxTimer) {
            clearTimeout(this.maxTimer);
            this.maxTimer = null;
        }
    }
}
