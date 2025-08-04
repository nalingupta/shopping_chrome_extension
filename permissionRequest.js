// Script for the permission request page loaded in iframe
// This runs in the extension context and can request microphone permission

console.log('Permission request script loaded');

async function requestMicrophonePermission() {
    console.log('Requesting microphone permission in iframe...');
    
    try {
        // Request microphone permission
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 44100
            } 
        });

        console.log('Permission granted!');
        
        // Permission granted - immediately stop the stream
        stream.getTracks().forEach(track => track.stop());

        // Notify the parent window
        window.parent.postMessage({
            type: 'MIC_PERMISSION_RESULT',
            granted: true
        }, '*');

    } catch (error) {
        console.error('Microphone permission error in iframe:', error);
        
        let errorType = 'unknown';
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            errorType = 'permission_denied';
        } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
            errorType = 'no_microphone';
        } else if (error.name === 'NotSupportedError') {
            errorType = 'not_supported';
        }

        // Notify the parent window about the error
        window.parent.postMessage({
            type: 'MIC_PERMISSION_RESULT',
            granted: false,
            error: errorType,
            details: error.message
        }, '*');
    }
}

// Automatically request permission when the page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('DOM loaded, requesting permission...');
        requestMicrophonePermission();
    });
} else {
    // DOM already loaded
    console.log('DOM already loaded, requesting permission immediately...');
    requestMicrophonePermission();
}