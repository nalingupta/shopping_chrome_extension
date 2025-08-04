class PCMProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.processEventCount = 0;
    }
    
    
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];
        
        if (input.length > 0) {
            const inputChannel = input[0];
            const outputChannel = output[0];
            
            this.processEventCount++;
            
            // Copy input to output
            for (let i = 0; i < inputChannel.length; i++) {
                outputChannel[i] = inputChannel[i];
            }
            
            // Calculate max amplitude for monitoring
            let maxAmplitude = 0;
            for (let i = 0; i < inputChannel.length; i++) {
                const amplitude = Math.abs(inputChannel[i]);
                maxAmplitude = Math.max(maxAmplitude, amplitude);
            }
            
            // Send ALL audio data continuously - let server handle speech detection completely
            const pcmData = new Int16Array(inputChannel.length);
            for (let i = 0; i < inputChannel.length; i++) {
                const sample = Math.max(-1, Math.min(1, inputChannel[i]));
                pcmData[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            }
            
            this.port.postMessage({
                type: 'audioData',
                pcmData: pcmData,
                maxAmplitude: maxAmplitude,
                eventCount: this.processEventCount
            });
        }
        
        return true; // Keep processing
    }
}

registerProcessor('pcm-processor', PCMProcessor);