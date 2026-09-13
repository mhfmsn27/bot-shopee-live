/**
 * Database Integrity and Dynamic Data Audit (CommonJS)
 * Inspects all tables in shopee_bot.db and compares with JSON snapshots.
 */
const sqliteManager = require('../db/sqlite-manager.js');
const fs = require('fs');
const path = require('path');

const dataDir = path.resolve(__dirname, '../../data');

console.log('--- AUDIT: SHOPEE BOT DATABASE INTEGRITY ---');

// 1. Check Accounts
const accounts = sqliteManager.getAllAccounts();
console.log(`\n[1] Accounts Table: ${accounts.length} total records`);
const testUsers = accounts.filter(a => a.username && a.username.includes('test_'));
const dummyUsers = accounts.filter(a => a.username && (a.username.includes('dummy') || a.username.includes('mock') || a.username.includes('sample')));
console.log(`  - Test usernames found: ${testUsers.length}`);
console.log(`  - Dummy usernames found: ${dummyUsers.length}`);
if (testUsers.length > 0) {
  console.log('  ⚠️ Test users:', testUsers.map(u => u.username));
}
if (dummyUsers.length > 0) {
  console.log('  ⚠️ Dummy users:', dummyUsers.map(u => u.username));
}

// Check sample account details
if (accounts.length > 0) {
  console.log(`  - Sample Account 1: ${accounts[0].name} (@${accounts[0].username}, Type: ${accounts[0].accountType}, Status: ${accounts[0].status})`);
  console.log(`  - Sample Account 2: ${accounts[1].name} (@${accounts[1].username}, Type: ${accounts[1].accountType}, Status: ${accounts[1].status})`);
}

// 2. Check Proxies
const proxies = sqliteManager.getAllProxies();
console.log(`\n[2] Proxies Table: ${proxies.length} total records`);
const deadProxies = proxies.filter(p => p.status === 'dead');
const testProxies = proxies.filter(p => p.ip && (p.ip.includes('99.99') || p.ip.includes('dummy') || p.ip.includes('mock')));
console.log(`  - Dead proxies: ${deadProxies.length}`);
console.log(`  - Mock/test proxy IPs: ${testProxies.length}`);
proxies.forEach((p, i) => {
  console.log(`  - Proxy ${i + 1}: ${p.protocol}://${p.ip}:${p.port} (${p.type}, Country: ${p.country}, Status: ${p.status}, Latency: ${p.latency}ms)`);
});

// 3. Check History
const history = sqliteManager.getAllHistory();
console.log(`\n[3] Campaign History Table: ${history.length} total records`);
const testHistory = history.filter(h => h.name && (h.name.includes('Test') || h.name.includes('Mock') || h.roomId === 'test_room'));
console.log(`  - Test history records: ${testHistory.length}`);
if (testHistory.length > 0) {
  console.log('  ⚠️ Test history:', testHistory.map(h => `${h.name} (${h.roomId})`));
}
if (history.length > 0) {
  const latest = history[0];
  console.log(`  - Latest Session: "${latest.name}" (Room: ${latest.roomId}, Views: ${latest.accumulatedViews}, Likes: ${latest.totalLikes}, Reason: ${latest.stopReason})`);
}

// 4. Check Comment Banks
const allBanks = sqliteManager.getAllCommentBanks();
const categories = ['fashion', 'electronic', 'beauty', 'food', 'general', 'custom'];
console.log(`\n[4] Comment Banks Table:`);
categories.forEach(cat => {
  const comments = allBanks[cat] || [];
  console.log(`  - [${cat}]: ${comments.length} templates (Sample: "${comments[0] || 'empty'}")`);
});

// 5. Check Schedules
const schedules = sqliteManager.getAllSchedules();
console.log(`\n[5] Schedules Table: ${schedules.length} total records`);

// 6. Check Config
console.log(`\n[6] Config Table:`);
['system', 'retention', 'accountGenerator', 'whatsapp', 'interaction', 'smsGateway'].forEach(sec => {
  const cfg = sqliteManager.getConfig(sec);
  console.log(`  - Section '${sec}': ${cfg ? 'OK (' + Object.keys(cfg).length + ' keys)' : 'MISSING'}`);
});

// 7. Verify JSON Snapshot Parity
console.log(`\n[7] JSON Snapshot Parity Check:`);
const accountsJson = JSON.parse(fs.readFileSync(path.join(dataDir, 'accounts.json'), 'utf8'));
const proxiesJson = JSON.parse(fs.readFileSync(path.join(dataDir, 'proxies.json'), 'utf8'));
const historyJson = JSON.parse(fs.readFileSync(path.join(dataDir, 'campaign-history.json'), 'utf8'));
const banksJson = JSON.parse(fs.readFileSync(path.join(dataDir, 'comment-banks.json'), 'utf8'));

console.log(`  - Accounts DB (${accounts.length}) vs JSON (${accountsJson.length}): ${accounts.length === accountsJson.length ? 'MATCH ✅' : 'MISMATCH ❌'}`);
console.log(`  - Proxies DB (${proxies.length}) vs JSON (${proxiesJson.length}): ${proxies.length === proxiesJson.length ? 'MATCH ✅' : 'MISMATCH ❌'}`);
console.log(`  - History DB (${history.length}) vs JSON (${historyJson.length}): ${history.length === historyJson.length ? 'MATCH ✅' : 'MISMATCH ❌'}`);

let bankMatch = true;
categories.forEach(c => {
  const dbCount = (allBanks[c] || []).length;
  const jsonCount = (banksJson[c] || []).length;
  if (dbCount !== jsonCount) bankMatch = false;
});
console.log(`  - Comment Banks DB vs JSON: ${bankMatch ? 'MATCH ✅' : 'MISMATCH ❌'}`);

console.log('\n--- AUDIT COMPLETE ---');
