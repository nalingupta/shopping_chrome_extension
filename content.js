let currentUrl = window.location.href;
let currentDomain = window.location.hostname;

function extractPageInfo() {
    const pageInfo = {
        url: currentUrl,
        domain: currentDomain,
        title: document.title,
        timestamp: Date.now()
    };

    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
        pageInfo.description = metaDescription.content;
    }

    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) {
        pageInfo.ogTitle = ogTitle.content;
    }

    const ogImage = document.querySelector('meta[property="og:image"]');
    if (ogImage) {
        pageInfo.ogImage = ogImage.content;
    }

    return pageInfo;
}

function detectShoppingSite() {
    const shoppingSites = {
        'amazon.com': 'Amazon',
        'amazon.co.uk': 'Amazon UK',
        'amazon.ca': 'Amazon Canada',
        'amazon.de': 'Amazon Germany',
        'ebay.com': 'eBay',
        'walmart.com': 'Walmart',
        'target.com': 'Target',
        'bestbuy.com': 'Best Buy',
        'costco.com': 'Costco',
        'homedepot.com': 'Home Depot',
        'lowes.com': 'Lowe\'s',
        'macys.com': 'Macy\'s',
        'nordstrom.com': 'Nordstrom',
        'wayfair.com': 'Wayfair',
        'overstock.com': 'Overstock',
        'etsy.com': 'Etsy',
        'aliexpress.com': 'AliExpress',
        'shopify.com': 'Shopify Store',
        'bigcommerce.com': 'BigCommerce Store'
    };

    for (const [domain, name] of Object.entries(shoppingSites)) {
        if (currentDomain.includes(domain)) {
            return { name, type: 'shopping' };
        }
    }

    const productKeywords = ['shop', 'store', 'buy', 'cart', 'checkout', 'product', 'price'];
    const pageText = document.body.textContent.toLowerCase();
    const hasProductKeywords = productKeywords.some(keyword => 
        pageText.includes(keyword) || currentUrl.toLowerCase().includes(keyword)
    );

    if (hasProductKeywords) {
        return { name: 'Shopping Site', type: 'potential_shopping' };
    }

    return { name: 'General Site', type: 'general' };
}

function sendPageInfoToSidebar() {
    const pageInfo = extractPageInfo();
    const siteInfo = detectShoppingSite();
    
    chrome.runtime.sendMessage({
        type: 'PAGE_INFO_UPDATE',
        data: {
            ...pageInfo,
            siteInfo
        }
    });
}

function observeUrlChanges() {
    let lastUrl = currentUrl;
    
    const observer = new MutationObserver(() => {
        if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            currentUrl = lastUrl;
            currentDomain = window.location.hostname;
            
            setTimeout(() => {
                sendPageInfoToSidebar();
            }, 1000);
        }
    });
    
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

sendPageInfoToSidebar();

window.addEventListener('load', () => {
    sendPageInfoToSidebar();
});

observeUrlChanges();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'GET_PAGE_INFO') {
        const pageInfo = extractPageInfo();
        const siteInfo = detectShoppingSite();
        sendResponse({
            ...pageInfo,
            siteInfo
        });
    }
    
    if (request.type === 'REQUEST_MICROPHONE_ACCESS') {
        handleMicrophoneRequest(sendResponse);
        return true; // Keep the message channel open for async response
    }
});

async function handleMicrophoneRequest(sendResponse) {
    try {
        // Check if we're in a secure context
        if (!window.isSecureContext) {
            sendResponse({
                success: false,
                error: 'not_secure_context',
                details: 'Microphone access requires a secure context (HTTPS)'
            });
            return;
        }
        
        // Check if getUserMedia is available
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            sendResponse({
                success: false,
                error: 'getusermedia_not_supported',
                details: 'getUserMedia API not supported in this context'
            });
            return;
        }
        
        // Request microphone access
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                sampleRate: 44100
            }
        });
        
        // Create a MediaRecorder to capture the audio
        const mimeType = MediaRecorder.isTypeSupported('audio/webm') 
            ? 'audio/webm' 
            : 'audio/ogg';
        
        const mediaRecorder = new MediaRecorder(stream, { mimeType });
        const audioChunks = [];
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };
        
        mediaRecorder.onstop = () => {
            const audioBlob = new Blob(audioChunks, { type: mimeType });
            // Send the audio data back to the extension
            chrome.runtime.sendMessage({
                type: 'AUDIO_RECORDED',
                audioBlob: audioBlob
            });
        };
        
        // Start recording
        mediaRecorder.start();
        
        // Store the recorder and stream for later use
        window.voiceRecorder = {
            mediaRecorder: mediaRecorder,
            stream: stream,
            audioChunks: audioChunks
        };
        
        sendResponse({
            success: true,
            message: 'Recording started'
        });
        
    } catch (error) {
        console.error('Microphone request error:', error);
        
        let errorType = 'unknown';
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            errorType = 'permission_denied';
        } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
            errorType = 'no_microphone';
        } else if (error.name === 'NotSupportedError') {
            errorType = 'not_supported';
        }
        
        sendResponse({
            success: false,
            error: errorType,
            details: error.message
        });
    }
}