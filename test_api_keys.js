// Simple test to validate API keys configuration
import { API_CONFIG } from './src/config/api-keys.js';

console.log('🧪 Testing API Keys Configuration...');
console.log('=====================================');

// Test each key individually
console.log('📋 Checking individual keys:');
console.log(`GEMINI_API_KEY: ${API_CONFIG.GEMINI_API_KEY ? '✅ Present' : '❌ Missing'}`);
console.log(`DAILY_API_KEY: ${API_CONFIG.DAILY_API_KEY ? '✅ Present' : '❌ Missing'}`);
console.log(`PIPECAT_PUBLIC_API_KEY: ${API_CONFIG.PIPECAT_PUBLIC_API_KEY ? '✅ Present' : '❌ Missing'}`);
console.log(`PIPECAT_AGENT_NAME: ${API_CONFIG.PIPECAT_AGENT_NAME ? '✅ Present' : '❌ Missing'}`);

// Test the validation logic
console.log('\n🔍 Testing validation logic:');
const allKeysPresent = API_CONFIG.GEMINI_API_KEY && API_CONFIG.DAILY_API_KEY && API_CONFIG.PIPECAT_PUBLIC_API_KEY;

if (allKeysPresent) {
    console.log('✅ All required API keys are present!');
    console.log('🎉 Configuration is valid - Chrome extension should work');
} else {
    console.log('❌ Some API keys are missing');
    console.log('🚨 Chrome extension will show error');
}

// Show configuration summary
console.log('\n📊 Configuration Summary:');
console.log(`API URL: ${API_CONFIG.PIPECAT_CLOUD_API_URL}`);
console.log(`Agent Name: ${API_CONFIG.PIPECAT_AGENT_NAME}`);
console.log(`Streaming Enabled: ${API_CONFIG.ENABLE_REAL_TIME_STREAMING}`);
console.log(`Connection Timeout: ${API_CONFIG.CONNECTION_TIMEOUT}ms`);

console.log('\n🔧 Next steps if working:');
console.log('1. Reload Chrome extension');
console.log('2. Test on a shopping website');
console.log('3. Check browser console for success messages');