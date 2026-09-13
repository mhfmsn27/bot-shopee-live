/**
 * Purge all test / dummy artifacts from SQLite and dual-sync JSON files
 */
const sqliteManager = require('../db/sqlite-manager');
const fs = require('fs');
const path = require('path');

console.log('--- PURGING DUMMY & TEST DATA ---');

// 1. Clean Proxies: remove proxy 103.245.88.99 (prx-mtvi1bzy-1368)
const proxies = sqliteManager.getAllProxies();
const badProxy = proxies.find(p => p.ip === '103.245.88.99' || p.username === 'test_user_crud');
if (badProxy) {
  console.log(`Removing leftover proxy: ${badProxy.id} (${badProxy.ip})`);
  sqliteManager.deleteProxy(badProxy.id);
}

// 2. Clean Accounts: remove accounts with test usernames or created by tests
const accounts = sqliteManager.getAllAccounts();
const testAccountPatterns = [
  'shopee_user_',
  'shopee_king',
  'shopee_queen',
  'test_',
  'broken_user',
  'bima.susanto69',
  'dewi.santoso53',
  'anisa_siregar91',
  'teguh868',
  'zahra_id84',
  'sarah.hakim45',
  'kurniawan_farhan',
  'lestari_hasan05',
  'daffa_shop41'
];

let deletedAccountsCount = 0;
accounts.forEach(acc => {
  const isTest = testAccountPatterns.some(pat => acc.username && acc.username.includes(pat));
  if (isTest) {
    console.log(`Deleting test account: ${acc.id} (@${acc.username})`);
    sqliteManager.deleteAccount(acc.id);
    deletedAccountsCount++;
  }
});
console.log(`Total test accounts deleted: ${deletedAccountsCount}`);

// Re-assign any accounts that had bad proxy assigned
const updatedAccounts = sqliteManager.getAllAccounts();
const remainingProxies = sqliteManager.getAllProxies();
let reAssignedCount = 0;
updatedAccounts.forEach(acc => {
  if (acc.assignedProxy && acc.assignedProxy.ip === '103.245.88.99') {
    const validProxy = remainingProxies[Math.floor(Math.random() * remainingProxies.length)];
    acc.assignedProxy = {
      id: validProxy.id,
      ip: validProxy.ip,
      port: validProxy.port,
      protocol: validProxy.protocol,
      type: validProxy.type
    };
    sqliteManager.saveAccount(acc);
    reAssignedCount++;
  }
});
if (reAssignedCount > 0) {
  console.log(`Re-assigned ${reAssignedCount} accounts from bad proxy to valid proxies.`);
}

// 3. Clean History: remove test history records
const history = sqliteManager.getAllHistory();
const testHistoryKeywords = ['Test', 'Clamp', 'Bypass', 'Audit', 'test_cleanup', 'test_room'];
let deletedHistoryCount = 0;
history.forEach(h => {
  const isTestHist = testHistoryKeywords.some(kw => 
    (h.name && h.name.includes(kw)) || 
    (h.stopReason && h.stopReason.includes(kw)) ||
    h.roomId === '11111111' ||
    h.roomId === '44444444' ||
    h.roomId === '88776655' ||
    h.roomId === '77889900' ||
    h.roomId === 'test_room'
  );
  if (isTestHist) {
    console.log(`Deleting test history: ${h.id} ("${h.name}")`);
    sqliteManager.deleteHistory(h.id);
    deletedHistoryCount++;
  }
});
console.log(`Total test history records deleted: ${deletedHistoryCount}`);

// 4. Export all snapshots
sqliteManager.exportAllSnapshots();

console.log('--- PURGE COMPLETE ---');
console.log(`Remaining accounts: ${sqliteManager.getAccountsCount()}`);
console.log(`Remaining proxies: ${sqliteManager.getProxiesCount()}`);
console.log(`Remaining history: ${sqliteManager.getAllHistory().length}`);
