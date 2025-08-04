// Service worker for managing the extension

chrome.runtime.onInstalled.addListener(() => {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
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
            
        case 'REQUEST_MIC_PERMISSION':
            handleMicPermissionRequest(sendResponse);
            return true;
    }
});

async function handleMicPermissionRequest(sendResponse) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!tab) {
            sendResponse({ success: false, error: 'no_active_tab' });
            return;
        }
        
        // Inject the content script if not already loaded
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['micPermission.js']
            });
            console.log('Injected micPermission.js into tab');
            
            // Wait for script to initialize
            await new Promise(resolve => setTimeout(resolve, 200));
        } catch (injectError) {
            console.log('Content script might already be injected:', injectError.message);
        }
        
        // Send message to content script to request permission via iframe
        chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_MIC_PERMISSION' }, (response) => {
            if (chrome.runtime.lastError) {
                console.error('Content script communication error:', chrome.runtime.lastError);
                sendResponse({ 
                    success: false, 
                    error: 'content_script_failed',
                    details: 'Cannot inject permission iframe on this page'
                });
            } else {
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