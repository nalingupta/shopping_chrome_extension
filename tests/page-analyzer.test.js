import { PageAnalyzer } from '../src/services/page-analyzer.js';

// Mock DOM for testing
global.document = {
    title: 'Test Product Page',
    body: { textContent: 'buy now product price shopping cart' },
    querySelector: (selector) => {
        const mockElements = {
            'meta[name="description"]': { content: 'Test product description' },
            'meta[property="og:title"]': { content: 'Test OG Title' },
            'meta[property="og:image"]': { content: 'https://example.com/image.jpg' }
        };
        return mockElements[selector] || null;
    }
};

global.window = {
    location: {
        href: 'https://amazon.com/test-product',
        hostname: 'amazon.com'
    }
};

describe('PageAnalyzer', () => {
    test('should extract basic page info', () => {
        const pageInfo = PageAnalyzer.extractPageInfo();
        
        expect(pageInfo.title).toBe('Test Product Page');
        expect(pageInfo.url).toBe('https://amazon.com/test-product');
        expect(pageInfo.domain).toBe('amazon.com');
        expect(pageInfo.description).toBe('Test product description');
    });

    test('should detect Amazon as shopping site', () => {
        const siteInfo = PageAnalyzer.detectShoppingSite('amazon.com');
        
        expect(siteInfo.name).toBe('Amazon');
        expect(siteInfo.type).toBe('shopping');
    });

    test('should detect shopping indicators', () => {
        const hasIndicators = PageAnalyzer.hasShoppingIndicators();
        expect(hasIndicators).toBe(true);
    });

    test('should return complete page info', () => {
        const completeInfo = PageAnalyzer.getCompletePageInfo();
        
        expect(completeInfo.title).toBe('Test Product Page');
        expect(completeInfo.siteInfo.name).toBe('Amazon');
        expect(completeInfo.siteInfo.type).toBe('shopping');
    });
});