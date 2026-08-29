const fs = require('fs');
const content = fs.readFileSync('electron/renderer/bundle.js', 'utf8');
const icons = ['Send', 'Mic', 'X', 'Copy', 'RotateCw', 'FileText', 'Image', 'Terminal', 'GitBranch', 'Globe', 'Search', 'Settings', 'FolderOpen', 'Maximize2', 'Minimize2', 'Plus', 'Trash2', 'Sparkles', 'MessageSquare', 'Code', 'Layout', 'Wifi', 'RefreshCw'];
icons.forEach(icon => {
  const found = content.includes('"' + icon + '"') || content.includes("'" + icon + "'") || content.includes('exports.' + icon);
  console.log(icon + ': ' + (found ? 'FOUND' : 'NOT FOUND'));
});