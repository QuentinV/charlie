// AudioWorklet that converts the microphone signal to mono 16-bit PCM at
// 16 kHz — the format the Charlie ASR and voice profiler expect.
//
// The AudioContext is created with `sampleRate: 16000`, but browsers are
// allowed to ignore that hint, so a small linear resampler keeps the output
// at exactly 16 kHz whatever the hardware rate is.

const TARGET_SAMPLE_RATE = 16000;

class PCMWorkletProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.wsOpen = false;
        // > 1 when downsampling (e.g. 48 kHz → 16 kHz).
        this.ratio = sampleRate / TARGET_SAMPLE_RATE;
        this.pos = 0; // fractional read position within the pending buffer
        this.tail = new Float32Array(0); // samples not consumed yet
        this.port.onmessage = (event) => {
            this.wsOpen = !!event.data.wsOpen;
        };
    }

    process(inputs) {
        if (!this.wsOpen) return true;

        const input = inputs[0][0]; // Float32Array (mono)
        if (!input || !input.length) return true;

        // Carry the leftover samples so resampling stays continuous across
        // process() blocks.
        const buf = new Float32Array(this.tail.length + input.length);
        buf.set(this.tail, 0);
        buf.set(input, this.tail.length);

        const outLen = Math.max(
            0,
            Math.floor((buf.length - this.pos) / this.ratio)
        );
        const pcm16 = new Int16Array(outLen);

        let p = this.pos;
        for (let i = 0; i < outLen; i++) {
            const idx = Math.floor(p);
            const frac = p - idx;
            const s0 = buf[idx] ?? 0;
            const s1 = buf[idx + 1] ?? s0;
            let s = s0 + (s1 - s0) * frac;
            s = Math.max(-1, Math.min(1, s));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            p += this.ratio;
        }

        // Keep whatever has not been read yet for the next block.
        const consumed = Math.floor(p);
        this.pos = p - consumed;
        this.tail = buf.slice(consumed);

        // Send to main thread
        if (pcm16.length) this.port.postMessage(pcm16.buffer, [pcm16.buffer]);

        return true;
    }
}

registerProcessor('pcm-worklet', PCMWorkletProcessor);

