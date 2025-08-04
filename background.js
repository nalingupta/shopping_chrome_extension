// Service worker for managing the extension
let offscreenDocumentCreated = false;

chrome.runtime.onInstalled.addListener(() => {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onStartup.addListener(async () => {
    offscreenDocumentCreated = false;
});

chrome.action.onClicked.addListener(async (tab) => {
    await chrome.sidePanel.open({ tabId: tab.id });
});

// Message handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Background received message:', request.type);
    
    switch(request.type) {
        case 'PAGE_INFO_UPDATE':
            chrome.runtime.sendMessage({
                type: 'PAGE_INFO_BROADCAST',
                data: request.data,
                tabId: sender.tab?.id,
            });
            break;
            
        case 'GET_CURRENT_TAB_INFO':
            chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
                if (tabs[0]) {
                    try {
                        // Try to inject content script first
                        await chrome.scripting.executeScript({
                            target: { tabId: tabs[0].id },
                            files: ['content.js']
                        }).catch(() => {
                            // Script might already be injected
                        });
                        
                        chrome.tabs.sendMessage(
                            tabs[0].id,
                            { type: 'GET_PAGE_INFO' },
                            (response) => {
                                if (chrome.runtime.lastError) {
                                    // Return null if content script is not available
                                    sendResponse(null);
                                } else {
                                    sendResponse(response);
                                }
                            }
                        );
                    } catch (error) {
                        sendResponse(null);
                    }
                } else {
                    sendResponse(null);
                }
            });
            return true;
            
        case 'PROCESS_USER_QUERY':
            processUserQuery(request.data)
                .then((response) => sendResponse(response))
                .catch((error) => sendResponse({ error: error.message }));
            return true;
            
        case 'AUDIO_RECORDED':
            console.log('Background: Audio recorded received from offscreen', {
                dataLength: request.audioData?.length,
                mimeType: request.mimeType
            });
            // Forward the audio data to the side panel
            chrome.runtime.sendMessage({
                type: 'AUDIO_DATA_RECEIVED',
                audioData: request.audioData,
                mimeType: request.mimeType,
            });
            console.log('Background: Audio data forwarded to sidepanel');
            break;
            
        case 'REQUEST_MIC_PERMISSION':
            handleMicPermissionRequest(sendResponse);
            return true;
            
        case 'START_VOICE_RECORDING':
            handleStartVoiceRecording(sendResponse);
            return true;
            
        case 'STOP_VOICE_RECORDING':
            handleStopVoiceRecording(sendResponse);
            return true;
            
        case 'CHECK_OFFSCREEN_STATUS':
            checkOffscreenStatus().then(sendResponse);
            return true;
    }
});

async function handleMicPermissionRequest(sendResponse) {
    try {
        // Get the active tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!tab) {
            sendResponse({ success: false, error: 'no_active_tab' });
            return;
        }
        
        // First, try to inject the content script if not already loaded
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['micPermission.js']
            });
            console.log('Injected micPermission.js into tab');
            
            // Wait a bit for the script to initialize
            await new Promise(resolve => setTimeout(resolve, 200));
        } catch (injectError) {
            // Script might already be injected, continue
            console.log('Content script might already be injected:', injectError.message);
        }
        
        // Send message to content script to request permission
        chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_MIC_PERMISSION' }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('Content script communication error:', chrome.runtime.lastError);
                
                // Try direct popup approach
                console.log('Opening permission popup directly...');
                chrome.windows.create({
                    url: chrome.runtime.getURL('permissionPopup.html'),
                    type: 'popup',
                    width: 400,
                    height: 200,
                    focused: true
                }, (window) => {
                    // Listen for result from popup
                    const messageHandler = (request, sender) => {
                        if (request.type === 'MIC_PERMISSION_POPUP_RESULT' && 
                            sender.tab && sender.tab.windowId === window.id) {
                            chrome.runtime.onMessage.removeListener(messageHandler);
                            chrome.windows.remove(window.id);
                            sendResponse(request);
                        }
                    };
                    chrome.runtime.onMessage.addListener(messageHandler);
                    
                    // Timeout after 30 seconds
                    setTimeout(() => {
                        chrome.runtime.onMessage.removeListener(messageHandler);
                        chrome.windows.remove(window.id).catch(() => {});
                        sendResponse({ success: false, error: 'timeout' });
                    }, 30000);
                });
            } else {
                console.log('Content script response:', response);
                sendResponse(response || { success: false, error: 'no_response' });
            }
        });
    } catch (error) {
        console.error('Error handling mic permission request:', error);
        sendResponse({ 
            success: false, 
            error: 'permission_request_failed',
            details: error.message 
        });
    }
}

async function createOffscreenDocument() {
    // Check if document already exists
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL('offscreen.html')]
    });
    
    if (existingContexts.length > 0) {
        console.log('Offscreen document already exists');
        return;
    }
    
    try {
        console.log('Creating new offscreen document...');
        await chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['AUDIO_PLAYBACK'],
            justification: 'Recording audio for voice input feature'
        });
        
        // Wait for initialization
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Verify the offscreen document is ready
        const pingResponse = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ type: 'PING' }, (response) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(response);
                }
            });
        });
        
        if (pingResponse && pingResponse.ready) {
            console.log('Offscreen document created and verified');
        }
    } catch (error) {
        console.error('Error creating offscreen document:', error);
        throw error;
    }
}

async function handleMicPermissionRequestInternal() {
    try {
        console.log('Opening permission page...');
        
        // Create a new tab with the permission page
        const tab = await chrome.tabs.create({
            url: chrome.runtime.getURL('permissionPage.html'),
            active: true
        });
        
        // Wait for permission result
        return new Promise((resolve) => {
            const messageHandler = (request, sender) => {
                if (request.type === 'MIC_PERMISSION_GRANTED' && 
                    sender.tab && sender.tab.id === tab.id) {
                    chrome.runtime.onMessage.removeListener(messageHandler);
                    
                    // Close the permission tab
                    chrome.tabs.remove(tab.id).catch(() => {});
                    
                    resolve({ success: true });
                }
            };
            
            chrome.runtime.onMessage.addListener(messageHandler);
            
            // Timeout after 60 seconds
            setTimeout(() => {
                chrome.runtime.onMessage.removeListener(messageHandler);
                chrome.tabs.remove(tab.id).catch(() => {});
                resolve({ 
                    success: false, 
                    error: 'timeout',
                    details: 'Permission request timed out' 
                });
            }, 60000);
        });
    } catch (error) {
        return { 
            success: false, 
            error: 'permission_request_failed',
            details: error.message 
        };
    }
}

async function checkOffscreenStatus() {
    try {
        const contexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT'],
            documentUrls: [chrome.runtime.getURL('offscreen.html')]
        });
        
        if (contexts.length === 0) {
            return { exists: false };
        }
        
        // Check if it's responsive
        const statusResponse = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: 'CHECK_STATUS' }, (response) => {
                if (chrome.runtime.lastError) {
                    resolve({ exists: true, responsive: false });
                } else {
                    resolve({ exists: true, responsive: true, ...response });
                }
            });
        });
        
        return statusResponse;
    } catch (error) {
        console.error('Error checking offscreen status:', error);
        return { exists: false, error: error.message };
    }
}

async function handleStartVoiceRecording(sendResponse) {
    try {
        console.log('Background: Starting voice recording...');
        
        // Ensure offscreen document exists
        await createOffscreenDocument();
        
        // First initialize audio if needed
        const initResponse = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: 'INIT_AUDIO' }, (response) => {
                if (chrome.runtime.lastError) {
                    resolve({ 
                        success: false, 
                        error: 'init_failed',
                        details: chrome.runtime.lastError.message 
                    });
                } else {
                    resolve(response || { success: false, error: 'no_response' });
                }
            });
        });
        
        if (!initResponse.success && initResponse.error === 'permission_denied') {
            // Permission was denied in offscreen, need to request via content script
            console.log('Permission denied in offscreen, requesting via content script...');
            
            const permissionResponse = await handleMicPermissionRequestInternal();
            if (!permissionResponse.success) {
                sendResponse(permissionResponse);
                return;
            }
            
            // Try to initialize audio again after permission granted
            const retryInitResponse = await new Promise((resolve) => {
                chrome.runtime.sendMessage({ type: 'INIT_AUDIO' }, (response) => {
                    if (chrome.runtime.lastError) {
                        resolve({ 
                            success: false, 
                            error: 'init_failed',
                            details: chrome.runtime.lastError.message 
                        });
                    } else {
                        resolve(response || { success: false, error: 'no_response' });
                    }
                });
            });
            
            if (!retryInitResponse.success) {
                sendResponse(retryInitResponse);
                return;
            }
        }
        
        if (!initResponse.success) {
            sendResponse(initResponse);
            return;
        }
        
        // Now start recording
        const recordResponse = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: 'START_RECORDING' }, (response) => {
                if (chrome.runtime.lastError) {
                    resolve({ 
                        success: false, 
                        error: 'recording_failed',
                        details: chrome.runtime.lastError.message 
                    });
                } else {
                    resolve(response || { success: false, error: 'no_response' });
                }
            });
        });
        
        sendResponse(recordResponse);
    } catch (error) {
        console.error('Error starting voice recording:', error);
        sendResponse({ 
            success: false, 
            error: 'offscreen_error',
            details: error.message 
        });
    }
}

async function handleStopVoiceRecording(sendResponse) {
    try {
        const response = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, (response) => {
                if (chrome.runtime.lastError) {
                    resolve({ 
                        success: false, 
                        error: 'communication_error',
                        details: chrome.runtime.lastError.message 
                    });
                } else {
                    resolve(response || { success: false, error: 'no_response' });
                }
            });
        });
        
        sendResponse(response);
    } catch (error) {
        console.error('Error stopping voice recording:', error);
        sendResponse({ 
            success: false, 
            error: 'offscreen_error',
            details: error.message 
        });
    }
}

async function processUserQuery(data) {
    const { query, pageInfo } = data;

    try {
        const response = await generateResponse(query, pageInfo);
        return { success: true, response };
    } catch (error) {
        console.error('Error processing query:', error);
        return {
            success: false,
            response: "I'm sorry, I encountered an error while processing your request. Please try again.",
        };
    }
}

async function generateResponse(query, pageInfo) {
    const lowerQuery = query.toLowerCase();
    
    // Handle null or undefined pageInfo
    if (!pageInfo) {
        return "I'm not able to see the current page information. Please make sure you're on a website and try again.";
    }
    
    const { domain, title, siteInfo } = pageInfo;

    if (lowerQuery.includes("price") || lowerQuery.includes("cost")) {
        if (siteInfo.type === "shopping") {
            return `I can help you with pricing information on ${siteInfo.name}. To get the best price analysis, I'd need to examine the current product page. Are you looking at a specific product right now?`;
        } else {
            return `It looks like you're not currently on a shopping site. To help with price comparisons, try visiting a product page on sites like Amazon, eBay, or other retailers.`;
        }
    }

    if (lowerQuery.includes("similar") || lowerQuery.includes("alternative")) {
        if (siteInfo.type === "shopping") {
            return `I can help you find similar products! Based on the current page "${title}", I can suggest alternatives. What specific features or price range are you looking for?`;
        } else {
            return `To find similar products, it would be helpful if you're viewing a product page. Try navigating to a specific product on a shopping site first.`;
        }
    }

    if (lowerQuery.includes("review") || lowerQuery.includes("rating")) {
        return `I can help you analyze reviews and ratings. ${
            siteInfo.type === "shopping"
                ? "Since you're on " +
                  siteInfo.name +
                  ", I can help interpret the reviews and ratings on this page."
                : "For the best review analysis, try visiting the product page on a major retailer."
        }`;
    }

    if (lowerQuery.includes("product") || lowerQuery.includes("about")) {
        if (siteInfo.type === "shopping") {
            return `You're currently on ${siteInfo.name}. Based on the page "${title}", I can help explain product details, specifications, and features. What would you like to know more about?`;
        } else {
            return `I don't see a product page currently. To get detailed product information, try visiting a specific product page on a shopping website.`;
        }
    }

    if (lowerQuery.includes("compare")) {
        return `I can help you compare products! To get started, I'd need to know what type of products you're interested in comparing. Are you looking at any specific items right now?`;
    }

    if (
        lowerQuery.includes("deal") ||
        lowerQuery.includes("discount") ||
        lowerQuery.includes("sale")
    ) {
        if (siteInfo.type === "shopping") {
            return `I can help you find deals and discounts on ${siteInfo.name}! I'd recommend checking the current page for any promotional offers, and I can help you understand if it's a good deal.`;
        } else {
            return `To find the best deals, try visiting major shopping sites and product pages. I can then help analyze if the prices and discounts are competitive.`;
        }
    }

    return `I'm your shopping assistant! I can help you with:
    
📦 Product information and specifications
💰 Price comparisons and deals
🔍 Finding similar or alternative products  
⭐ Review and rating analysis
🛒 General shopping advice

${
    siteInfo.type === "shopping"
        ? `You're currently on ${siteInfo.name} viewing "${title}". `
        : ""
}What would you like help with?`;
}