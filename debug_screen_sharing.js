// Simple screen sharing test for Chrome extension
// Run this in the browser console to test screen capture

async function testScreenSharing() {
    console.log('🧪 Testing Screen Sharing Capabilities...');
    
    try {
        // Test 1: Check if desktopCapture API is available
        if (typeof chrome !== 'undefined' && chrome.desktopCapture) {
            console.log('✅ Chrome desktopCapture API is available');
        } else {
            console.error('❌ Chrome desktopCapture API not available');
            return;
        }
        
        // Test 2: Request screen capture permission
        console.log('📋 Requesting screen capture permission...');
        const streamId = await new Promise((resolve, reject) => {
            chrome.desktopCapture.chooseDesktopMedia(
                ['screen', 'window', 'tab'],
                (streamId) => {
                    if (streamId) {
                        console.log('✅ Screen capture permission granted, streamId:', streamId);
                        resolve(streamId);
                    } else {
                        console.error('❌ Screen capture permission denied');
                        reject(new Error('Permission denied'));
                    }
                }
            );
        });
        
        // Test 3: Get actual screen stream
        console.log('🎥 Getting screen stream...');
        const screenStream = await navigator.mediaDevices.getUserMedia({
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: streamId,
                    maxWidth: 1280,
                    maxHeight: 720,
                    maxFrameRate: 15
                }
            }
        });
        
        console.log('✅ Screen stream obtained:', screenStream);
        console.log('📊 Video tracks:', screenStream.getVideoTracks().length);
        console.log('🔧 Video track settings:', screenStream.getVideoTracks()[0]?.getSettings());
        
        // Test 4: Create video element to verify stream
        const video = document.createElement('video');
        video.srcObject = screenStream;
        video.autoplay = true;
        video.muted = true;
        video.style.cssText = 'position:fixed;top:10px;right:10px;width:200px;height:150px;border:2px solid red;z-index:9999;';
        document.body.appendChild(video);
        
        console.log('✅ Screen sharing test successful!');
        console.log('🎯 You should see a small video preview in the top-right corner');
        
        // Clean up after 5 seconds
        setTimeout(() => {
            screenStream.getTracks().forEach(track => track.stop());
            video.remove();
            console.log('🧹 Cleaned up test video stream');
        }, 5000);
        
        return {
            success: true,
            streamId,
            videoTracks: screenStream.getVideoTracks().length,
            resolution: screenStream.getVideoTracks()[0]?.getSettings()
        };
        
    } catch (error) {
        console.error('❌ Screen sharing test failed:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { testScreenSharing };
} else {
    window.testScreenSharing = testScreenSharing;
}

console.log('🚀 Screen sharing test loaded. Run testScreenSharing() to test.');