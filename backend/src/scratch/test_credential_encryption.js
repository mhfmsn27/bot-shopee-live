/**
 * Unit Test: Credential Security & AES-256-GCM At-Rest Encryption
 * Menjamin cookie akun dan password proxy terenkripsi secara aman di SQLite dengan transparansi penuh.
 */

const assert = require('assert');
const sqliteManager = require('../db/sqlite-manager');
const { encryptSensitiveData, decryptSensitiveData } = sqliteManager;

async function runTest() {
  console.log('--- START TEST: Credential Security & AES-256-GCM At-Rest Encryption ---');

  const testAccountId = `acc-sec-test-${Date.now()}`;
  const testProxyId = `prx-sec-test-${Date.now()}`;
  const secretCookie = 'SPC_EC=secret_ec_998877; SPC_F=super_secret_device_fingerprint; SPC_T_ID=token_xyz;';
  const secretProxyPass = 'super_secure_proxy_p@ssw0rd!#';

  try {
    // 1. Direct AES-256-GCM Encryption / Decryption Helper
    console.log('[1] Verifikasi Helper Enkripsi Simetris AES-256-GCM...');
    const encrypted = encryptSensitiveData(secretCookie);
    assert(encrypted.startsWith('enc:v1:'), 'Hasil enkripsi harus memiliki prefix enc:v1:');
    const parts = encrypted.split(':');
    assert.strictEqual(parts.length, 5, 'Format ciphertext harus enc:v1:iv:tag:data (5 parts)');
    assert.notStrictEqual(encrypted, secretCookie, 'Ciphertext tidak boleh sama dengan plaintext');

    const decrypted = decryptSensitiveData(encrypted);
    assert.strictEqual(decrypted, secretCookie, 'Hasil dekripsi harus identik dengan plaintext awal');

    // Uji backward compatibility dengan data plaintext lama
    const legacyPlain = 'legacy_plaintext_cookie_sample';
    assert.strictEqual(decryptSensitiveData(legacyPlain), legacyPlain, 'Data plaintext lama harus dikembalikan as-is tanpa error');
    console.log('    Sample Ciphertext:', encrypted.slice(0, 42) + '...');
    console.log('    ✅ PASS: AES-256-GCM Enkripsi & Dekripsi bekerja presisi.');

    // 2. Accounts At-Rest Encryption in SQLite Table
    console.log('[2] Verifikasi At-Rest Encryption Akun di SQLite...');
    const testAccount = {
      id: testAccountId,
      username: 'sec_test_user',
      name: 'Security Test Persona',
      cookies: secretCookie,
      cookieStatus: 'authenticated',
      accountType: 'persona',
      status: 'ready'
    };

    sqliteManager.saveAccount(testAccount);

    // Query langsung baris mentah di SQLite (bypass getter)
    const rawRow = sqliteManager.db.prepare('SELECT cookies, raw_json FROM accounts WHERE id = ?').get(testAccountId);
    assert(rawRow, 'Baris akun harus tersimpan di SQLite');
    assert(rawRow.cookies.startsWith('enc:v1:'), 'Kolom cookies di database SQLite HARUS terenkripsi (dimulai dengan enc:v1:)');
    assert(!rawRow.cookies.includes('secret_ec_998877'), 'Plaintext cookie TIDAK boleh tersimpan dalam database');
    console.log('    Raw DB Stored Cookie Column:', rawRow.cookies.slice(0, 45) + '...');

    // Ambil via sqliteManager API (harus otomatis didekripsi transparan untuk runtime)
    const retrievedAccount = sqliteManager.getAccountById(testAccountId);
    assert.strictEqual(retrievedAccount.cookies, secretCookie, 'API getAccountById harus transparan mengembalikan cookie yang telah didekripsi');

    const allAccounts = sqliteManager.getAllAccounts();
    const foundInAll = allAccounts.find(a => a.id === testAccountId);
    assert(foundInAll, 'Akun harus ditemukan di getAllAccounts');
    assert.strictEqual(foundInAll.cookies, secretCookie, 'getAllAccounts harus transparan mendekripsi cookie');
    console.log('    ✅ PASS: Cookies akun terenkripsi di SQLite dan transparan pada level aplikasi.');

    // 3. Proxies At-Rest Encryption in SQLite Table
    console.log('[3] Verifikasi At-Rest Encryption Password Proxy di SQLite...');
    const testProxy = {
      id: testProxyId,
      ip: '103.147.20.99',
      port: 8080,
      protocol: 'http',
      type: 'datacenter',
      username: 'proxy_admin_user',
      password: secretProxyPass,
      city: 'Jakarta',
      country: 'ID',
      status: 'alive',
      latency: 50
    };

    sqliteManager.saveProxy(testProxy);

    // Query langsung baris mentah di SQLite
    const rawProxyRow = sqliteManager.db.prepare('SELECT password, raw_json FROM proxies WHERE id = ?').get(testProxyId);
    assert(rawProxyRow, 'Baris proxy harus tersimpan di SQLite');
    assert(rawProxyRow.password.startsWith('enc:v1:'), 'Kolom password di database SQLite HARUS terenkripsi');
    assert(!rawProxyRow.password.includes(secretProxyPass), 'Plaintext password proxy TIDAK boleh tersimpan di database');
    console.log('    Raw DB Stored Proxy Password:', rawProxyRow.password.slice(0, 45) + '...');

    // Ambil via sqliteManager API
    const retrievedProxy = sqliteManager.getProxyById(testProxyId);
    assert.strictEqual(retrievedProxy.password, secretProxyPass, 'API getProxyById harus transparan mengembalikan password terdekripsi');

    const allProxies = sqliteManager.getAllProxies();
    const foundProxyInAll = allProxies.find(p => p.id === testProxyId);
    assert(foundProxyInAll, 'Proxy harus ditemukan di getAllProxies');
    assert.strictEqual(foundProxyInAll.password, secretProxyPass, 'getAllProxies harus transparan mendekripsi password proxy');
    console.log('    ✅ PASS: Password proxy terenkripsi di SQLite dan transparan pada level aplikasi.');

  } finally {
    // 4. Guaranteed Teardown Cleanup
    console.log('[4] Membersihkan entri akun dan proxy pengujian...');
    sqliteManager.deleteAccount(testAccountId);
    sqliteManager.deleteProxy(testProxyId);

    assert(!sqliteManager.getAccountById(testAccountId), 'Akun uji coba harus bersih');
    assert(!sqliteManager.getProxyById(testProxyId), 'Proxy uji coba harus bersih');
    console.log('    ✅ CLEANUP: Zero test data leakage verified.');
  }

  console.log('🎉 ALL CREDENTIAL SECURITY & ENCRYPTION TESTS PASSED (100% OK)');
}

runTest().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
