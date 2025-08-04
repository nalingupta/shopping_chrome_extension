describe('ShoppingAssistant Voice Features', () => {
    let assistant;
    let mockDOM;
    
    beforeEach(() => {
        // Set up mock DOM
        document.body.innerHTML = `
            <div id="messages"></div>
            <textarea id="userInput"></textarea>
            <button id="sendButton"></button>
            <button id="voiceButton"><span class="voice-icon">🎤</span></button>
            <div id="siteUrl"></div>
            <div id="suggestions"></div>
        `;
        
        // Mock chrome API
        global.chrome = {
            runtime: {
                sendMessage: jest.fn(),
                onMessage: { addListener: jest.fn() }
            }
        };
        
        // Mock VoiceInputHandler
        global.VoiceInputHandler = jest.fn(() => ({
            isRecording: false,
            startRecording: jest.fn(() => Promise.resolve(true)),
            stopRecording: jest.fn(),
            mediaRecorder: { onstop: null },
            audioChunks: [],
            processAudio: jest.fn(() => Promise.resolve('Test voice input'))
        }));
        
        assistant = new ShoppingAssistant();
    });
    
    describe('handleVoiceInput', () => {
        test('should start recording when button clicked', async () => {
            const voiceButton = document.getElementById('voiceButton');
            
            await assistant.handleVoiceInput();
            
            expect(assistant.voiceHandler.startRecording).toHaveBeenCalled();
            expect(voiceButton.classList.contains('recording')).toBe(true);
            expect(voiceButton.querySelector('.voice-icon').textContent).toBe('🔴');
        });
        
        test('should stop recording when clicked while recording', async () => {
            assistant.voiceHandler.isRecording = true;
            const voiceButton = document.getElementById('voiceButton');
            voiceButton.classList.add('recording');
            
            await assistant.handleVoiceInput();
            
            expect(assistant.voiceHandler.stopRecording).toHaveBeenCalled();
            expect(voiceButton.classList.contains('recording')).toBe(false);
            expect(voiceButton.querySelector('.voice-icon').textContent).toBe('🎤');
        });
        
        test('should handle microphone permission denied', async () => {
            assistant.voiceHandler.startRecording = jest.fn(() => Promise.resolve(false));
            
            await assistant.handleVoiceInput();
            
            const messages = document.querySelectorAll('.message');
            const lastMessage = messages[messages.length - 1];
            expect(lastMessage.textContent).toContain('Unable to access microphone');
        });
        
        test('should process transcription and add to chat', async () => {
            const transcribedText = 'What are the best deals on this page?';
            assistant.voiceHandler.processAudio = jest.fn(() => Promise.resolve(transcribedText));
            
            // Start recording
            await assistant.handleVoiceInput();
            
            // Simulate recording complete
            const audioBlob = new Blob(['audio'], { type: 'audio/webm' });
            assistant.voiceHandler.audioChunks = [audioBlob];
            await assistant.voiceHandler.mediaRecorder.onstop();
            
            // Check if transcribed text was added as user message
            const userMessages = document.querySelectorAll('.user-message');
            const lastUserMessage = userMessages[userMessages.length - 1];
            expect(lastUserMessage.textContent).toContain(transcribedText);
        });
    });
    
    describe('generateMockResponse', () => {
        test('should generate appropriate response for price queries', () => {
            jest.useFakeTimers();
            
            assistant.generateMockResponse('What is the price of this item?');
            
            // Fast forward past the delay
            jest.advanceTimersByTime(1600);
            
            const assistantMessages = document.querySelectorAll('.assistant-message');
            const lastMessage = assistantMessages[assistantMessages.length - 1];
            expect(lastMessage.textContent).toContain('$49.99');
            expect(lastMessage.textContent).toContain('15% below');
            
            jest.useRealTimers();
        });
        
        test('should generate appropriate response for deal queries', () => {
            jest.useFakeTimers();
            
            assistant.generateMockResponse('Are there any deals available?');
            
            jest.advanceTimersByTime(1600);
            
            const assistantMessages = document.querySelectorAll('.assistant-message');
            const lastMessage = assistantMessages[assistantMessages.length - 1];
            expect(lastMessage.textContent).toContain('20% discount');
            expect(lastMessage.textContent).toContain('SAVE10');
            
            jest.useRealTimers();
        });
        
        test('should show loading state before response', () => {
            assistant.generateMockResponse('Test query');
            
            const loadingMessages = document.querySelectorAll('.loading');
            expect(loadingMessages.length).toBeGreaterThan(0);
        });
    });
    
    describe('getMockResponseForQuery', () => {
        test('should return price-related response for price queries', () => {
            const response = assistant.getMockResponseForQuery('How much does this cost?');
            expect(response).toContain('$49.99');
            expect(response).toContain('market price');
        });
        
        test('should return review-related response for review queries', () => {
            const response = assistant.getMockResponseForQuery('What do the reviews say?');
            expect(response).toContain('4.6/5 star rating');
            expect(response).toContain('1,234 reviews');
        });
        
        test('should return comparison for compare queries', () => {
            const response = assistant.getMockResponseForQuery('Compare with other sellers');
            expect(response).toContain('Comparing with top competitors');
            expect(response).toContain('best value option');
        });
        
        test('should return generic response for unmatched queries', () => {
            const response = assistant.getMockResponseForQuery('Random question');
            expect(response).toContain('analyzing the current page');
            expect(response).toContain('shopping insights');
        });
    });
});