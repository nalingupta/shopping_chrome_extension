const chokidar = require('chokidar');
const fs = require('fs');

console.log('🚀 Starting Chrome Extension Hot Reload...');

const watcher = chokidar.watch([
  '*.js',
  '*.html',
  '*.css',
  '*.json',
  'icons/**/*'
], {
  ignored: ['node_modules/**', 'watch.js', '.reload-signal'],
  persistent: true
});

let reloadTimeout;

function triggerReload() {
  clearTimeout(reloadTimeout);
  
  reloadTimeout = setTimeout(() => {
    const reloadSignal = {
      timestamp: Date.now(),
      message: 'reload'
    };
    
    fs.writeFileSync('.reload-signal', JSON.stringify(reloadSignal));
    console.log('📝 Hot reload triggered');
  }, 100);
}

watcher
  .on('change', (filePath) => {
    console.log(`🔄 File changed: ${filePath}`);
    triggerReload();
  })
  .on('add', (filePath) => {
    console.log(`➕ File added: ${filePath}`);
    triggerReload();
  })
  .on('unlink', (filePath) => {
    console.log(`➖ File removed: ${filePath}`);
    triggerReload();
  });

console.log('✅ Hot reload is active. Make changes to your extension files to see auto-reload in action!');
console.log('💡 Make sure to run "Load unpacked" in Chrome Extensions first, then any changes will auto-reload.');