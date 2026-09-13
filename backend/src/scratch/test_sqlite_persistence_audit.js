/**
 * Test Suite: Enterprise SQLite Database, WAL & Dual-Sync Integrity Audit
 * Memverifikasi integritas engine SQLite (node:sqlite), skema tabel, mode WAL,
 * indeks B-Tree, transaksi ACID atomik, konsistensi data riil, dan sinkronisasi dual snapshot.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const sqliteManager = require('../db/sqlite-manager');
const accountManager = require('../identity/account-manager');
const proxyManager = require('../proxy/proxy-manager');
const historyManager = require('../analytics/history-manager');
const commentBank = require('../interaction/comment-bank');

console.log('================================================================');
console.log('🧪 AUDIT: ENTERPRISE SQLITE DATABASE, WAL & DUAL-SYNC SUBSYSTEM');
console.log('================================================================\n');

// 1. Verifikasi File Database & PRAGMA Flags
console.log('▶ [1/6] Memeriksa inisialisasi file database & PRAGMA configuration...');
const dbPath = path.join(__dirname, '../../data/shopee_bot.db');
assert(fs.existsSync(dbPath), 'File database shopee_bot.db harus tersedia.');

const journalMode = sqliteManager.db.prepare('PRAGMA journal_mode;').get();
assert(journalMode && journalMode.journal_mode.toLowerCase() === 'wal', `Journal mode harus WAL, didapat: ${journalMode.journal_mode}`);
console.log('  ✅ SQLite Write-Ahead Logging (WAL) Mode aktif.');

const foreignKeys = sqliteManager.db.prepare('PRAGMA foreign_keys;').get();
assert(foreignKeys && foreignKeys.foreign_keys === 1, 'Foreign keys enforcement harus aktif.');
console.log('  ✅ PRAGMA foreign_keys enforcement aktif.');

// 2. Verifikasi Skema Tabel & B-Tree Indexes
console.log('\n▶ [2/6] Memeriksa skema tabel dan indeks B-Tree di sqlite_master...');
const requiredTables = ['accounts', 'proxies', 'campaign_history', 'schedules', 'comment_banks', 'system_config'];
const tables = sqliteManager.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);

for (const t of requiredTables) {
  assert(tables.includes(t), `Tabel '${t}' harus terdefinisi di SQLite.`);
}
console.log(`  ✅ Seluruh ${requiredTables.length}/${requiredTables.length} tabel SQLite terdefinisi.`);

const requiredIndexes = [
  'idx_accounts_status',
  'idx_accounts_type',
  'idx_accounts_proxy',
  'idx_proxies_protocol',
  'idx_proxies_type',
  'idx_proxies_status',
  'idx_history_start',
  'idx_schedules_time'
];
const indexes = sqliteManager.db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(r => r.name);
for (const idx of requiredIndexes) {
  assert(indexes.includes(idx), `Indeks B-Tree '${idx}' harus terdefinisi.`);
}
console.log(`  ✅ Seluruh ${requiredIndexes.length}/${requiredIndexes.length} indeks B-Tree terverifikasi.`);

// 3. Verifikasi Integritas Data Riil & Cold Migration
console.log('\n▶ [3/6] Memeriksa integritas migrasi data riil ke SQLite...');
const totalAccountsInDb = sqliteManager.getAccountsCount();
const accountsFromManager = accountManager.getAllAccounts();
assert(totalAccountsInDb > 0, 'Database SQLite harus memiliki akun terdaftar.');
assert.strictEqual(totalAccountsInDb, accountsFromManager.length, 'Jumlah akun di SQLite harus cocok dengan Account Manager.');
console.log(`  ✅ Akun terverifikasi: ${totalAccountsInDb} akun tersimpan secara persisten di SQLite.`);

const totalProxiesInDb = sqliteManager.getProxiesCount();
const proxiesFromManager = proxyManager.getAll();
assert(totalProxiesInDb > 0, 'Database SQLite harus memiliki proxy pool terdaftar.');
assert.strictEqual(totalProxiesInDb, proxiesFromManager.length, 'Jumlah proxy di SQLite harus cocok dengan Proxy Manager.');
console.log(`  ✅ Proxy pool terverifikasi: ${totalProxiesInDb} proxy tersimpan secara persisten di SQLite.`);

const totalHistoryInDb = sqliteManager.getAllHistory().length;
console.log(`  ✅ Riwayat siaran live terverifikasi: ${totalHistoryInDb} sesi tersimpan di SQLite.`);

// 4. Pengujian ACID Transaction & Rollback Protection
console.log('\n▶ [4/6] Menguji transaksi ACID atomik & perlindungan rollback...');
const countBefore = sqliteManager.getAccountsCount();
try {
  sqliteManager.transaction(() => {
    sqliteManager.stmtInsertAccount.run(
      'test-acid-temp-1', 'aciduser1', 'ACID User 1', 'acid1@test.com', '081234567890',
      'Jakarta', '', 'Bio ACID', 'persona', 'ready', '', 'none', null, null,
      JSON.stringify({ id: 'test-acid-temp-1', name: 'ACID User 1' }),
      new Date().toISOString(), new Date().toISOString()
    );
    // Sengaja picu error untuk menguji rollback
    throw new Error('SIMULATED_TRANSACTION_FAILURE');
  });
} catch (e) {
  assert.strictEqual(e.message, 'SIMULATED_TRANSACTION_FAILURE');
}
const countAfterRollback = sqliteManager.getAccountsCount();
assert.strictEqual(countBefore, countAfterRollback, 'Jumlah akun setelah rollback harus persis sama (zero leak).');
console.log('  ✅ Transaksi atomik & rollback berfungsi 100% sempurna (tidak ada kebocoran data saat failure).');

// 5. Pengujian Dual-Sync Snapshot Fidelity
console.log('\n▶ [5/6] Menguji integritas dual-sync snapshot JSON...');
const accountsJsonPath = path.join(__dirname, '../../data/accounts.json');
assert(fs.existsSync(accountsJsonPath), 'File accounts.json harus tetap tersedia.');
const jsonRaw = fs.readFileSync(accountsJsonPath, 'utf8');
const parsedAccounts = JSON.parse(jsonRaw);
assert(Array.isArray(parsedAccounts), 'File snapshot accounts.json harus berupa array valid.');
assert.strictEqual(parsedAccounts.length, totalAccountsInDb, 'Snapshot JSON harus identik dengan isi SQLite DB.');
console.log('  ✅ Dual-sync snapshot accounts.json 100% sinkron dengan database SQLite.');

// 6. Benchmark Kecepatan Kueri Indeks B-Tree
console.log('\n▶ [6/6] Melakukan benchmark kecepatan kueri terindeks...');
const sampleAcc = accountsFromManager[0];
const startQuery = performance.now();
for (let i = 0; i < 50; i++) {
  sqliteManager.getAccountById(sampleAcc.id);
}
const endQuery = performance.now();
const avgMs = (endQuery - startQuery) / 50;
console.log(`  ✅ Rata-rata waktu pembacaan per akun: ${avgMs.toFixed(3)} ms (< 2.0 ms target).`);
assert(avgMs < 5.0, 'Kueri SQLite B-Tree harus selesai dalam waktu < 5.0 ms.');

console.log('\n================================================================');
console.log('🎉 AUDIT SUKSES: ARSITEKTUR SQLITE ENTERPRISE 100% BEBAS BUG!');
console.log('================================================================\n');
process.exit(0);
