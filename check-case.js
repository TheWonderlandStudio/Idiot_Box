const fs = require('fs');
const content = fs.readFileSync('electron/renderer/bundle.js', 'utf8');
const idx = content.indexOf('case "aiPanel"');
console.log('aiPanel case at:', idx);
if (idx >= 0) console.log(content.substring(idx, idx + 200));