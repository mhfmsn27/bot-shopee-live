const fs = require('fs');

const content = fs.readFileSync('PANDUAN_PENGOPERASIAN_BOT.html', 'utf8');
const lines = content.split('\n');

console.log('Total lines:', lines.length);

const inlineColorLines = [];
lines.forEach((l, i) => {
  if (i > 772 && (l.includes('style="') || l.includes("style='"))) {
    if (l.includes('#') || l.includes('rgb') || l.includes('color:') || l.includes('background:')) {
      inlineColorLines.push({ line: i + 1, text: l.trim() });
    }
  }
});

console.log('Inline color lines found:', inlineColorLines.length);
inlineColorLines.slice(0, 30).forEach(item => console.log(`${item.line}: ${item.text.slice(0, 100)}`));
