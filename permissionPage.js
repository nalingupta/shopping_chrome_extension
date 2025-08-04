// JavaScript for the permission page
const enableBtn = document.getElementById('enableBtn');
const statusDiv = document.getElementById('status');

async function requestMicPermission() {
    enableBtn.disabled = true;
    statusDiv.textContent = 'Requesting permission...';
    statusDiv.className = 'info';
    
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
        
        statusDiv.textContent = '✓ Microphone access granted!';
        statusDiv.className = 'success';
        
        // Store permission state
        localStorage.setItem('micPermissionGranted', 'true');
        
        // Notify background script
        chrome.runtime.sendMessage({
            type: 'MIC_PERMISSION_GRANTED',
            success: true
        });
        
        // Redirect back or close after delay
        setTimeout(() => {
            if (window.history.length > 1) {
                window.history.back();
            } else {
                window.close();
            }
        }, 1500);
        
    } catch (error) {
        console.error('Microphone permission error:', error);
        
        let message = 'Failed to access microphone';
        if (error.name === 'NotAllowedError') {
            message = 'Microphone access was denied. Please check your browser settings.';
        } else if (error.name === 'NotFoundError') {
            message = 'No microphone found. Please connect a microphone.';
        }
        
        statusDiv.textContent = '✗ ' + message;
        statusDiv.className = 'error';
        enableBtn.disabled = false;
        enableBtn.textContent = 'Try Again';
    }
}

// Check if already granted on page load
document.addEventListener('DOMContentLoaded', () => {
    enableBtn.addEventListener('click', requestMicPermission);
    
    // Check if already granted
    if (localStorage.getItem('micPermissionGranted') === 'true') {
        statusDiv.textContent = 'Checking existing permission...';
        statusDiv.className = 'info';
        
        // Verify permission is still valid
        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(stream => {
                stream.getTracks().forEach(track => track.stop());
                statusDiv.textContent = '✓ Microphone access already granted!';
                statusDiv.className = 'success';
                
                chrome.runtime.sendMessage({
                    type: 'MIC_PERMISSION_GRANTED',
                    success: true
                });
                
                setTimeout(() => {
                    window.history.back();
                }, 1000);
            })
            .catch(() => {
                statusDiv.textContent = '';
                enableBtn.disabled = false;
            });
    }
});