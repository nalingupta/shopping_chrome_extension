import { SHOPPING_SITES } from '../utils/constants.js';

export class PageAnalyzer {
    static extractPageInfo() {
        const pageInfo = {
            url: window.location.href,
            domain: window.location.hostname,
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

    static detectShoppingSite(domain = window.location.hostname) {
        // Check exact matches first
        for (const [siteDomain, name] of Object.entries(SHOPPING_SITES)) {
            if (domain.includes(siteDomain)) {
                return { name, type: 'shopping' };
            }
        }

        // Check for shopping-related content
        if (this.hasShoppingIndicators()) {
            return { name: 'Shopping Site', type: 'potential_shopping' };
        }

        return { name: 'General Site', type: 'general' };
    }

    static hasShoppingIndicators() {
        const productKeywords = ['shop', 'store', 'buy', 'cart', 'checkout', 'product', 'price'];
        const pageText = document.body.textContent.toLowerCase();
        const url = window.location.href.toLowerCase();
        
        return productKeywords.some(keyword => 
            pageText.includes(keyword) || url.includes(keyword)
        );
    }

    static getCompletePageInfo() {
        const pageInfo = this.extractPageInfo();
        const siteInfo = this.detectShoppingSite();
        
        return {
            ...pageInfo,
            siteInfo
        };
    }
}