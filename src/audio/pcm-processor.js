class PCMProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.processEventCount = 0;
        // Accumulate PCM16 samples and flush in ~20 ms chunks (320 samples at 16 kHz)
        this.int16Queue = [];
        this.chunkSize = 320; // 20 ms at 16 kHz
        this.pendingMaxAmplitude = 0;
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];

        if (input.length > 0) {
            const inputChannel = input[0];
            const outputChannel = output[0];

            this.processEventCount++;

            // Pass-through for output
            for (let i = 0; i < inputChannel.length; i++) {
                outputChannel[i] = inputChannel[i];
            }

            // Track amplitude across flush window
            for (let i = 0; i < inputChannel.length; i++) {
                const amplitude = Math.abs(inputChannel[i]);
                if (amplitude > this.pendingMaxAmplitude) {
                    this.pendingMaxAmplitude = amplitude;
                }
            }

            // Convert to PCM16 and enqueue
            for (let i = 0; i < inputChannel.length; i++) {
                const s = Math.max(-1, Math.min(1, inputChannel[i]));
                const v = s < 0 ? s * 0x8000 : s * 0x7fff;
                this.int16Queue.push(v | 0);
            }

            // Flush fixed-size 20ms chunks
            while (this.int16Queue.length >= this.chunkSize) {
                const slice = this.int16Queue.slice(0, this.chunkSize);
                this.int16Queue = this.int16Queue.slice(this.chunkSize);
                const pcmData = new Int16Array(slice);
                const maxAmplitude = this.pendingMaxAmplitude;
                this.pendingMaxAmplitude = 0;
                this.port.postMessage({
                    type: "audioData",
                    pcmData,
                    maxAmplitude,
                    eventCount: this.processEventCount,
                });
            }
        }

        return true; // Keep processing
    }
}

registerProcessor("pcm-processor", PCMProcessor);
