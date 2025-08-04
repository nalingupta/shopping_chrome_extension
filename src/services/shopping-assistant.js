export class ShoppingAssistant {
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

        const intent = this.detectIntent(lowerQuery);
        return this.getResponseForIntent(intent, isShopping, siteName, title);
    }

    static detectIntent(lowerQuery) {
        const intents = {
            price: ["price", "cost"],
            similar: ["similar", "alternative"],
            review: ["review", "rating"],
            product: ["product", "about"],
            compare: ["compare"],
            deal: ["deal", "discount", "sale"]
        };

        return Object.keys(intents).find(key => 
            intents[key].some(keyword => lowerQuery.includes(keyword))
        );
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

        return this.getDefaultResponse(isShopping, siteName, title);
    }

    static getDefaultResponse(isShopping, siteName, title) {
        const baseMessage = `I'm your shopping assistant! I can help you with:
    
📦 Product information and specifications
💰 Price comparisons and deals
🔍 Finding similar or alternative products  
⭐ Review and rating analysis
🛒 General shopping advice

${isShopping ? `You're currently on ${siteName} viewing "${title}". ` : ""}What would you like help with?`;

        return baseMessage;
    }
}