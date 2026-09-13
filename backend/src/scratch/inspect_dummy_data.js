const fs = require('fs');
const path = require('path');

console.log('--- 1. SCANNING FRONTEND INDEX.HTML FOR HARDCODED VALUES ---');
const html = fs.readFileSync('frontend/index.html', 'utf8');
const lines = html.split('\n');
lines.forEach((line, idx) => {
  const trimmed = line.trim();
  if (trimmed.includes('value=') && !trimmed.includes('value=""') && !trimmed.includes("value=''")) {
    console.log(`Line ${idx + 1}: ${trimmed}`);
  }
});

console.log('\n--- 2. SCANNING FRONTEND APP.JS FOR HARDCODED DUMMY VALUES ---');
const appJs = fs.readFileSync('frontend/js/app.js', 'utf8');
const appLines = appJs.split('\n');
appLines.forEach((line, idx) => {
  const trimmed = line.trim();
  if (
    trimmed.includes('dummy') ||
    trimmed.includes('sample') ||
    trimmed.includes('mock') ||
    trimmed.includes('contoh') ||
    trimmed.includes('081298765432') ||
    trimmed.includes('999888') ||
    trimmed.includes('123456') ||
    trimmed.includes('test_user')
  ) {
    if (!trimmed.startsWith('//') && !trimmed.startsWith('*')) {
      console.log(`app.js L${idx + 1}: ${trimmed.slice(0, 100)}`);
    }
  }
});

console.log('\n--- 3. SCANNING CHARTS.JS FOR DUMMY DATA ---');
const chartsJs = fs.readFileSync('frontend/js/charts.js', 'utf8');
const chartLines = chartsJs.split('\n');
chartLines.forEach((line, idx) => {
  const trimmed = line.trim();
  if (trimmed.includes('data:') && (trimmed.includes('[') || trimmed.includes('0'))) {
    console.log(`charts.js L${idx + 1}: ${trimmed.slice(0, 100)}`);
  }
});

console.log('\n--- 4. SCANNING ACCOUNTS TABLE IN DATABASE ---');
const accs = JSON.parse(fs.readFileSync('backend/data/accounts.json', 'utf8'));
console.log('Total accounts:', accs.length);
accs.slice(0, 5).forEach((a, i) => console.log(`Account ${i+1}: ${a.username} (${a.name})`));
const broken = accs.filter(a => a.username === 'broken_user' || a.id.includes('broken'));
console.log('Broken accounts found:', broken.length);

console.log('\n--- 5. SCANNING PROXIES ---');
const proxies = JSON.parse(fs.readFileSync('backend/data/proxies.json', 'utf8'));
console.log('Total proxies:', proxies.length);
proxies.forEach(p => console.log(`Proxy: ${p.protocol}://${p.ip}:${p.port} (${p.type}, user: ${p.username})`));

console.log('\n--- 6. SCANNING HISTORY ---');
const hist = JSON.parse(fs.readFileSync('backend/data/campaign-history.json', 'utf8'));
console.log('Total history sessions:', hist.length);
if (hist.length > 0) {
  console.log('Sample session:', hist[0].name, 'Room:', hist[0].roomId, 'Likes:', hist[0].totalLikes);
}

console.log('\n--- 7. SCANNING CONFIG ---');
const config = JSON.parse(fs.readFileSync('backend/data/config.json', 'utf8'));
console.log('Admin WhatsApp:', config.whatsapp?.adminNumber);
console.log('SMS Provider:', config.smsGateway?.provider);
