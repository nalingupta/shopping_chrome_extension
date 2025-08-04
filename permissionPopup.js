// JavaScript for the permission popup
const statusDiv = document.getElementById('status');
const allowBtn = document.getElementById('allowBtn');

async function requestPermission() {
    statusDiv.textContent = 'Requesting permission...';
    statusDiv.className = '';
    allowBtn.disabled = true;
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 44100
            }
        });
        
        // Permission granted - stop the stream
        stream.getTracks().forEach(track => track.stop());
        
        statusDiv.textContent = '✓ Permission granted!';
        statusDiv.className = 'success';
        
        // Notify via extension messaging
        chrome.runtime.sendMessage({
            type: 'MIC_PERMISSION_POPUP_RESULT',
            granted: true,
            success: true
        });
        
        // Close popup after a short delay
        setTimeout(() => {
            window.close();
        }, 1000);
        
    } catch (error) {
        console.error('Permission error:', error);
        
        let errorType = 'unknown';
        let message = 'Failed to access microphone';
        
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            errorType = 'permission_denied';
            message = 'Microphone access was denied';
        } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
            errorType = 'no_microphone';
            message = 'No microphone found';
        } else if (error.name === 'NotSupportedError') {
            errorType = 'not_supported';
            message = 'Microphone not supported';
        }
        
        statusDiv.textContent = '✗ ' + message;
        statusDiv.className = 'error';
        allowBtn.disabled = false;
        
        // Notify via extension messaging
        chrome.runtime.sendMessage({
            type: 'MIC_PERMISSION_POPUP_RESULT',
            granted: false,
            success: false,
            error: errorType,
            details: error.message
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    allowBtn.addEventListener('click', requestPermission);
    
    // Auto-request on load if user preference
    if (localStorage.getItem('autoRequestMic') === 'true') {
        requestPermission();
    }
});