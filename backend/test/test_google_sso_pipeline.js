/**
 * Test Google OAuth SSO Pipeline & Endpoints
 * Verifikasi parsing akun bulk, ekstraksi token Shopee, alur status batch, dan integrasi API
 */

const assert = require('assert');
const http = require('http');
const googleSsoPipeline = require('../src/identity/google-sso-pipeline');
const accountManager = require('../src/identity/account-manager');

async function apiRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + 'test_bypass_or_login',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTests() {
  console.log('===============================================================');
  console.log('🧪 TESTING GOOGLE OAUTH SSO PIPELINE SUBSYSTEM');
  console.log('===============================================================\n');

  // Test 1: Module Initial State
  console.log('[Test 1] Verifikasi Inisialisasi Google SSO Pipeline');
  assert.ok(googleSsoPipeline, 'googleSsoPipeline harus terdefinisi');
  assert.strictEqual(typeof googleSsoPipeline.parseBulkText, 'function');
  assert.strictEqual(typeof googleSsoPipeline.formatPuppeteerCookies, 'function');
  assert.strictEqual(typeof googleSsoPipeline.parseShopeeTokens, 'function');
  console.log('  ✅ PASS: Module dan method utama tersedia');

  // Test 2: Bulk Text Parsing
  console.log('\n[Test 2] Verifikasi Parsing Format Teks Bulk (email:pass:recovery)');
  const sampleText = `
    user1@gmail.com:Pass123!
    user2@gmail.com:Pass456!:recovery2@gmail.com
    invalid_line_no_colon
    user3@gmail.com:Pass789!:recovery3@gmail.com
  `;
  const parsed = googleSsoPipeline.parseBulkText(sampleText);
  assert.strictEqual(parsed.length, 3, 'Harus memparsing 3 akun valid');
  assert.strictEqual(parsed[0].email, 'user1@gmail.com');
  assert.strictEqual(parsed[0].password, 'Pass123!');
  assert.strictEqual(parsed[0].recoveryEmail, null);
  assert.strictEqual(parsed[1].recoveryEmail, 'recovery2@gmail.com');
  assert.strictEqual(parsed[2].email, 'user3@gmail.com');
  console.log('  ✅ PASS: Parsing teks bulk akurat');

  // Test 3: Cookie Formatter & Token Extractor
  console.log('\n[Test 3] Verifikasi Formatter Cookie & Ekstraksi Token Shopee');
  const mockCookies = [
    { name: 'SPC_U', value: '1418182283' },
    { name: 'SPC_ST', value: 'sec_st_token_abc123' },
    { name: 'SPC_EC', value: 'sec_ec_token_xyz789' },
    { name: 'SPC_T_ID', value: 'uuid-test-999' }
  ];
  const cookieStr = googleSsoPipeline.formatPuppeteerCookies(mockCookies);
  assert.ok(cookieStr.includes('SPC_U=1418182283'));
  assert.ok(cookieStr.includes('SPC_ST=sec_st_token_abc123'));

  const tokens = googleSsoPipeline.parseShopeeTokens(cookieStr);
  assert.strictEqual(tokens.SPC_U, '1418182283');
  assert.strictEqual(tokens.SPC_ST, 'sec_st_token_abc123');
  assert.strictEqual(tokens.SPC_EC, 'sec_ec_token_xyz789');
  console.log('  ✅ PASS: Formatter cookie dan ekstraksi token bekerja presisi');

  // Test 4: Batch Status Reporting
  console.log('\n[Test 4] Verifikasi Pelaporan Status Batch');
  const status = googleSsoPipeline.getBatchStatus();
  assert.strictEqual(status.active, false);
  assert.strictEqual(typeof status.total, 'number');
  assert.strictEqual(typeof status.successCount, 'number');
  assert.strictEqual(typeof status.logs, 'object');
  console.log('  ✅ PASS: Struktur getBatchStatus valid');

  // Test 5: Account Manager Integration
  console.log('\n[Test 5] Verifikasi Penyimpanan Akun Tipe google_authenticated');
  const testAcc = {
    id: `test-gacc-${Date.now()}`,
    accountType: 'google_authenticated',
    email: 'test_sso@gmail.com',
    username: 'test_sso_shopee',
    name: 'Test SSO User',
    cookies: 'SPC_U=1418182283; SPC_ST=sec_st_token_abc123;',
    cookieStatus: 'alive',
    status: 'ready',
    verified: true,
    note: 'Unit Test SSO Account'
  };
  accountManager.addRealRegisteredAccount(testAcc);
  const found = accountManager.getAllAccounts().find(a => a.id === testAcc.id);
  assert.ok(found, 'Akun Google SSO harus tersimpan di database');
  assert.strictEqual(found.accountType, 'google_authenticated');
  assert.ok(found.assignedProxy, 'Akun Google SSO harus otomatis diikat ke proxy');
  
  // Cleanup test account
  accountManager.deleteAccount(testAcc.id);
  console.log('  ✅ PASS: Akun google_authenticated berhasil disimpan dan diikat proxy');

  console.log('\n===============================================================');
  console.log('🎉 SEMUA PENGUJIAN GOOGLE SSO PIPELINE BERHASIL 100%!');
  console.log('===============================================================\n');
}

runTests().catch(err => {
  console.error('FATAL TEST FAILURE:', err);
  process.exit(1);
});
