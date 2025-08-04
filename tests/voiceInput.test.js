describe('VoiceInputHandler', () => {
    let voiceHandler;
    let mockMediaRecorder;
    let mockStream;
    
    beforeEach(() => {
        // Mock MediaRecorder
        mockMediaRecorder = {
            start: jest.fn(),
            stop: jest.fn(),
            state: 'inactive'
        };
        
        global.MediaRecorder = jest.fn(() => mockMediaRecorder);
        
        // Mock getUserMedia
        mockStream = {
            getTracks: jest.fn(() => [{ stop: jest.fn() }])
        };
        
        global.navigator.mediaDevices = {
            getUserMedia: jest.fn(() => Promise.resolve(mockStream))
        };
        
        // Mock fetch for Cartesia API
        global.fetch = jest.fn();
        
        voiceHandler = new VoiceInputHandler();
    });
    
    afterEach(() => {
        jest.clearAllMocks();
    });
    
    describe('startRecording', () => {
        test('should successfully start recording', async () => {
            const result = await voiceHandler.startRecording();
            
            expect(result).toBe(true);
            expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
            expect(mockMediaRecorder.start).toHaveBeenCalled();
            expect(voiceHandler.isRecording).toBe(true);
        });
        
        test('should handle permission denied', async () => {
            navigator.mediaDevices.getUserMedia.mockRejectedValue(new Error('Permission denied'));
            
            const result = await voiceHandler.startRecording();
            
            expect(result).toBe(false);
            expect(voiceHandler.isRecording).toBe(false);
        });
    });
    
    describe('stopRecording', () => {
        test('should stop recording and release microphone', async () => {
            await voiceHandler.startRecording();
            voiceHandler.stopRecording();
            
            expect(mockMediaRecorder.stop).toHaveBeenCalled();
            expect(voiceHandler.isRecording).toBe(false);
            expect(mockStream.getTracks()[0].stop).toHaveBeenCalled();
        });
        
        test('should handle stop when not recording', () => {
            voiceHandler.stopRecording();
            expect(mockMediaRecorder.stop).not.toHaveBeenCalled();
        });
    });
    
    describe('blobToBase64', () => {
        test('should convert blob to base64', async () => {
            const mockBlob = new Blob(['test audio data'], { type: 'audio/webm' });
            const mockBase64 = 'dGVzdCBhdWRpbyBkYXRh';
            
            global.FileReader = jest.fn(() => ({
                readAsDataURL: jest.fn(function() {
                    this.result = `data:audio/webm;base64,${mockBase64}`;
                    this.onloadend();
                })
            }));
            
            const result = await voiceHandler.blobToBase64(mockBlob);
            expect(result).toBe(mockBase64);
        });
    });
    
    describe('transcribeWithCartesia', () => {
        test('should successfully transcribe audio', async () => {
            const mockTranscription = 'Show me the best deals';
            fetch.mockResolvedValue({
                ok: true,
                json: async () => ({ transcription: mockTranscription })
            });
            
            const result = await voiceHandler.transcribeWithCartesia('base64audio');
            
            expect(fetch).toHaveBeenCalledWith(
                voiceHandler.CARTESIA_API_URL,
                expect.objectContaining({
                    method: 'POST',
                    headers: expect.objectContaining({
                        'Content-Type': 'application/json',
                        'Authorization': expect.stringContaining('Bearer')
                    })
                })
            );
            expect(result).toBe(mockTranscription);
        });
        
        test('should fall back to mock on API error', async () => {
            fetch.mockRejectedValue(new Error('Network error'));
            
            const result = await voiceHandler.transcribeWithCartesia('base64audio');
            
            expect(result).toBeTruthy();
            expect(typeof result).toBe('string');
        });
    });
    
    describe('getMockTranscription', () => {
        test('should return a mock transcription', () => {
            const result = voiceHandler.getMockTranscription();
            
            expect(result).toBeTruthy();
            expect(typeof result).toBe('string');
            expect(result.length).toBeGreaterThan(0);
        });
    });
});