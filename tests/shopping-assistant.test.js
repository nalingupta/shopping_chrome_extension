import { ShoppingAssistant } from '../src/services/shopping-assistant.js';

describe('ShoppingAssistant', () => {
    const mockPageInfo = {
        title: 'Test Product',
        siteInfo: {
            name: 'Amazon',
            type: 'shopping'
        }
    };

    test('should detect price intent', () => {
        const intent = ShoppingAssistant.detectIntent('what is the price of this product');
        expect(intent).toBe('price');
    });

    test('should detect similar product intent', () => {
        const intent = ShoppingAssistant.detectIntent('find similar alternatives');
        expect(intent).toBe('similar');
    });

    test('should detect review intent', () => {
        const intent = ShoppingAssistant.detectIntent('show me reviews and ratings');
        expect(intent).toBe('review');
    });

    test('should generate appropriate response for shopping site', async () => {
        const response = await ShoppingAssistant.generateResponse('price', mockPageInfo);
        expect(response).toContain('Amazon');
        expect(response).toContain('pricing information');
    });

    test('should handle missing page info', async () => {
        const response = await ShoppingAssistant.generateResponse('price', null);
        expect(response).toContain('not able to see the current page information');
    });

    test('should return default response for unknown intent', async () => {
        const response = await ShoppingAssistant.generateResponse('random query', mockPageInfo);
        expect(response).toContain('shopping assistant');
        expect(response).toContain('Product information');
    });

    test('should process query successfully', async () => {
        const result = await ShoppingAssistant.processQuery({
            query: 'price',
            pageInfo: mockPageInfo
        });
        
        expect(result.success).toBe(true);
        expect(result.response).toBeTruthy();
    });
});