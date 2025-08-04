// Application constants
export const APP_CONFIG = {
    NAME: 'Shopping Assistant',
    VERSION: '1.0',
    DESCRIPTION: 'AI-powered shopping assistant that helps users with product recommendations and price comparisons'
};

export const VOICE_CONFIG = {
    LANGUAGE: 'en-US',
    RESTART_DELAY: 1000,
    PERMISSION_TIMEOUT: 30000
};

export const SHOPPING_SITES = {
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

export const MESSAGE_TYPES = {
    PAGE_INFO_UPDATE: 'PAGE_INFO_UPDATE',
    PAGE_INFO_BROADCAST: 'PAGE_INFO_BROADCAST',
    GET_CURRENT_TAB_INFO: 'GET_CURRENT_TAB_INFO',
    GET_PAGE_INFO: 'GET_PAGE_INFO',
    PROCESS_USER_QUERY: 'PROCESS_USER_QUERY',
    REQUEST_MIC_PERMISSION: 'REQUEST_MIC_PERMISSION',
    SIDE_PANEL_OPENED: 'SIDE_PANEL_OPENED',
    SIDE_PANEL_CLOSED: 'SIDE_PANEL_CLOSED',
    AUDIO_RECORDED: 'AUDIO_RECORDED',
    MIC_PERMISSION_RESULT: 'MIC_PERMISSION_RESULT'
};

export const ERROR_MESSAGES = {
    'no-speech': "No speech detected. Please speak clearly and try again.",
    'audio-capture': "Microphone not found. Please check your microphone connection.",
    'not-allowed': "Microphone access denied. Click the microphone icon in your browser's address bar to allow access.",
    'network': "Network error occurred. Please check your internet connection.",
    'not_supported': "Voice input requires Chrome or Edge browser. Please switch browsers or use text input.",
    'content_script_failed': "Voice input unavailable on this page. Try refreshing or visit a different website.",
    'permission_timeout': "Permission request timed out. Please try again.",
    'initialization_failed': "Voice recognition failed to start. Please refresh and try again."
};

export const ERROR_RECOVERY = {
    'no-speech': 'Try speaking louder or closer to your microphone',
    'audio-capture': 'Check microphone settings in your system preferences',
    'not-allowed': 'Enable microphone permissions for this site',
    'network': 'Reconnect to the internet and try again',
    'not_supported': 'Use the text input field below instead',
    'content_script_failed': 'Voice input works on most websites - try a different page'
};