// Chrome extension background service worker
class BackgroundService {
    constructor() {
        this.initializeExtension();
        this.setupEventListeners();
        this.setupHotReload();
    }

    initializeExtension() {
        chrome.runtime.onInstalled.addListener(() => {
            chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
        });

        chrome.action.onClicked.addListener(async (tab) => {
            await chrome.sidePanel.open({ tabId: tab.id });
            // Track that side panel is now open
            await chrome.storage.local.set({ sidePanelOpen: true });
        });

        // Restore side panel state after hot reload
        this.restoreStateAfterReload();
    }

    async restoreStateAfterReload() {
        setTimeout(async () => {
            try {
                const result = await chrome.storage.local.get(['hotReloadState', 'sidePanelOpen']);
                const { hotReloadState, sidePanelOpen } = result;
                
                if (hotReloadState?.shouldRestore && sidePanelOpen) {
                    const timeSinceReload = Date.now() - hotReloadState.timestamp;
                    
                    if (timeSinceReload < 10000) {
                        await this.showReloadNotification();
                    }
                    
                    await chrome.storage.local.remove(['hotReloadState']);
                }
            } catch (error) {
                console.error('State restoration error:', error);
            }
        }, 500);
    }

    setupEventListeners() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            const handler = this.getMessageHandler(request.type);
            if (handler) {
                handler(request, sender, sendResponse);
                return true;
            }
        });
    }

    getMessageHandler(type) {
        const handlers = {
            'PAGE_INFO_UPDATE': this.handlePageInfoUpdate.bind(this),
            'GET_CURRENT_TAB_INFO': this.handleGetCurrentTabInfo.bind(this),
            'PROCESS_USER_QUERY': this.handleProcessUserQuery.bind(this),
            'REQUEST_MIC_PERMISSION': this.handleMicPermissionRequest.bind(this),
            'SIDE_PANEL_OPENED': this.handleSidePanelOpened.bind(this),
            'SIDE_PANEL_CLOSED': this.handleSidePanelClosed.bind(this)
        };
        
        return handlers[type] || null;
    }

    handlePageInfoUpdate(request, sender) {
        chrome.runtime.sendMessage({
            type: 'PAGE_INFO_BROADCAST',
            data: request.data,
            tabId: sender.tab?.id,
        });
    }

    async handleGetCurrentTabInfo(request, sender, sendResponse) {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (!tab) {
                sendResponse(null);
                return;
            }

            // Inject content script if needed
            await this.injectContentScript(tab.id, ['content.js']);
            
            // Get page info from content script
            chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_INFO' }, (response) => {
                sendResponse(chrome.runtime.lastError ? null : response);
            });
        } catch (error) {
            console.error('Error getting tab info:', error);
            sendResponse(null);
        }
    }

    async handleProcessUserQuery(request, sender, sendResponse) {
        try {
            const response = await ShoppingAssistant.processQuery(request.data);
            sendResponse(response);
        } catch (error) {
            console.error('Query processing error:', error);
            sendResponse({ 
                success: false,
                error: error.message,
                response: "I'm sorry, I encountered an error while processing your request. Please try again."
            });
        }
    }

    async handleMicPermissionRequest(request, sender, sendResponse) {
        try {
            const result = await MicrophonePermission.request();
            sendResponse(result);
        } catch (error) {
            console.error('Permission request error:', error);
            sendResponse({
                success: false,
                error: 'permission_request_failed',
                details: error.message
            });
        }
    }

    async handleSidePanelOpened(request, sender, sendResponse) {
        try {
            await chrome.storage.local.set({ sidePanelOpen: true });
            sendResponse({ success: true });
        } catch (error) {
            sendResponse({ success: false });
        }
    }

    async handleSidePanelClosed(request, sender, sendResponse) {
        try {
            await chrome.storage.local.set({ sidePanelOpen: false });
            sendResponse({ success: true });
        } catch (error) {
            sendResponse({ success: false });
        }
    }

    async injectContentScript(tabId, files) {
        try {
            await chrome.scripting.executeScript({
                target: { tabId },
                files
            });
        } catch (error) {
            // Script might already be injected
            console.log('Content script injection:', error.message);
        }
    }

    setupHotReload() {
        const startTime = Date.now();
        
        setInterval(async () => {
            try {
                const response = await fetch(chrome.runtime.getURL('.reload-signal'));
                const data = await response.json();
                
                if (data.timestamp > startTime) {
                    await this.handleHotReload();
                }
            } catch (error) {
                // Ignore - reload signal file might not exist
            }
        }, 1000);
    }

    async handleHotReload() {
        try {
            await chrome.storage.local.set({
                hotReloadState: {
                    shouldRestore: true,
                    timestamp: Date.now()
                }
            });
            
            chrome.runtime.reload();
        } catch (error) {
            console.error('Hot reload error:', error);
        }
    }

    async showReloadNotification() {
        try {
            await chrome.action.setBadgeText({ text: "↻" });
            await chrome.action.setBadgeBackgroundColor({ color: "#10b981" });
            
            setTimeout(() => {
                chrome.action.setBadgeText({ text: "" }).catch(() => {});
            }, 3000);
        } catch (error) {
            console.error('Notification error:', error);
        }
    }
}

// Microphone permission handler
class MicrophonePermission {
    static async request() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!tab) {
            return { success: false, error: 'no_active_tab' };
        }

        // Inject permission content script
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['mic-permission.js']
            });
            
            // Wait for initialization
            await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error) {
            console.log('Permission script injection:', error.message);
        }

        // Request permission via content script
        return new Promise((resolve) => {
            chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_MIC_PERMISSION' }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('Content script error:', chrome.runtime.lastError);
                    resolve({
                        success: false,
                        error: 'content_script_failed',
                        details: 'Cannot inject permission iframe on this page'
                    });
                } else {
                    resolve(response || { success: false, error: 'no_response' });
                }
            });
        });
    }
}

// Shopping assistant query processor
class ShoppingAssistant {
    static async processQuery(data) {
        const { query, pageInfo } = data;

        try {
            const response = await this.generateResponse(query, pageInfo);
            return { success: true, response };
        } catch (error) {
            console.error('Query processing error:', error);
            return {
                success: false,
                response: "I'm sorry, I encountered an error while processing your request. Please try again."
            };
        }
    }

    static async generateResponse(query, pageInfo) {
        if (!pageInfo) {
            return "I'm not able to see the current page information. Please make sure you're on a website and try again.";
        }

        const lowerQuery = query.toLowerCase();
        const { title, siteInfo } = pageInfo;
        const isShopping = siteInfo?.type === "shopping";
        const siteName = siteInfo?.name || "this site";

        // Query intent mapping
        const intents = {
            price: ["price", "cost"],
            similar: ["similar", "alternative"],
            review: ["review", "rating"],
            product: ["product", "about"],
            compare: ["compare"],
            deal: ["deal", "discount", "sale"]
        };

        const intent = Object.keys(intents).find(key => 
            intents[key].some(keyword => lowerQuery.includes(keyword))
        );

        return this.getResponseForIntent(intent, isShopping, siteName, title);
    }

    static getResponseForIntent(intent, isShopping, siteName, title) {
        const responses = {
            price: {
                shopping: `I can help you with pricing information on ${siteName}. To get the best price analysis, I'd need to examine the current product page. Are you looking at a specific product right now?`,
                general: "It looks like you're not currently on a shopping site. To help with price comparisons, try visiting a product page on sites like Amazon, eBay, or other retailers."
            },
            similar: {
                shopping: `I can help you find similar products! Based on the current page "${title}", I can suggest alternatives. What specific features or price range are you looking for?`,
                general: "To find similar products, it would be helpful if you're viewing a product page. Try navigating to a specific product on a shopping site first."
            },
            review: {
                shopping: `I can help you analyze reviews and ratings. Since you're on ${siteName}, I can help interpret the reviews and ratings on this page.`,
                general: "I can help you analyze reviews and ratings. For the best review analysis, try visiting the product page on a major retailer."
            },
            product: {
                shopping: `You're currently on ${siteName}. Based on the page "${title}", I can help explain product details, specifications, and features. What would you like to know more about?`,
                general: "I don't see a product page currently. To get detailed product information, try visiting a specific product page on a shopping website."
            },
            compare: {
                shopping: "I can help you compare products! To get started, I'd need to know what type of products you're interested in comparing. Are you looking at any specific items right now?",
                general: "I can help you compare products! To get started, I'd need to know what type of products you're interested in comparing. Are you looking at any specific items right now?"
            },
            deal: {
                shopping: `I can help you find deals and discounts on ${siteName}! I'd recommend checking the current page for any promotional offers, and I can help you understand if it's a good deal.`,
                general: "To find the best deals, try visiting major shopping sites and product pages. I can then help analyze if the prices and discounts are competitive."
            }
        };

        if (intent && responses[intent]) {
            return responses[intent][isShopping ? 'shopping' : 'general'];
        }

        // Default response
        return `I'm your shopping assistant! I can help you with:
    
📦 Product information and specifications
💰 Price comparisons and deals
🔍 Finding similar or alternative products  
⭐ Review and rating analysis
🛒 General shopping advice

${isShopping ? `You're currently on ${siteName} viewing "${title}". ` : ""}What would you like help with?`;
    }
}

// Initialize the background service
new BackgroundService();