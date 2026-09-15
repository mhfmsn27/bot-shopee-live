/**
 * Comprehensive Test Suite for Real Account Management:
 * 1. Real Account Cookie / Session Token Vault
 * 2. Virtual SMS Gateway & Automated Real Account Registration Pipeline
 * 3. Live Protocol Cookie Header Injection & Worker Verification
 */

const http = require('http');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';

function apiRequest(method, endpoint, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('🧪 RUNNING TEST SUITE: REAL ACCOUNTS & VIRTUAL SMS PIPELINE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    process.stdout.write(`• ${name}... `);
    try {
      await fn();
      console.log('✅ PASSED');
      passed++;
    } catch (err) {
      console.log(`❌ FAILED: ${err.message}`);
      failed++;
    }
  }

  // TEST 1: SMS Gateway Config & Balance
  await test('SMS Gateway Config & Balance Retrieval', async () => {
    const res = await apiRequest('GET', '/api/accounts/sms-gateway/config');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.config);
    assert.strictEqual(res.body.config.provider, 'simulator');
    assert.strictEqual(res.body.balance.currency, 'CREDITS');
    assert.ok(res.body.balance.balance > 0);
  });

  // TEST 2: Update SMS Gateway Config
  await test('Update SMS Gateway Config Settings', async () => {
    const updateRes = await apiRequest('POST', '/api/accounts/sms-gateway/config', {
      provider: 'simulator',
      defaultCountry: 'id',
      autoCancelTimeoutSec: 150
    });
    assert.strictEqual(updateRes.status, 200);
    assert.strictEqual(updateRes.body.success, true);
    assert.strictEqual(updateRes.body.config.autoCancelTimeoutSec, 150);
  });

  // TEST 3: Virtual Number Request (+62 Indonesia)
  let allocatedActivationId = null;
  let allocatedPhone = null;
  await test('Virtual Phone Number Request (+62 Indonesia)', async () => {
    const res = await apiRequest('POST', '/api/accounts/sms-gateway/request-number', {
      country: 'id',
      service: 'shopee'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.activationId);
    assert.ok(res.body.phoneNumber);
    assert.ok(res.body.phoneNumber.startsWith('628'));
    assert.strictEqual(res.body.country, 'id');
    allocatedActivationId = res.body.activationId;
    allocatedPhone = res.body.phoneNumber;
  });

  // TEST 4: Polling OTP for Allocated Virtual Number
  await test('Fetch SMS OTP for Allocated Virtual Number (Simulator Auto-Delivery)', async () => {
    // Simulator delivers OTP within 1.5 - 2 seconds
    let otpData = null;
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 600));
      const pollRes = await apiRequest('POST', '/api/accounts/sms-gateway/check-otp', {
        activationId: allocatedActivationId
      });
      if (pollRes.body.status === 'RECEIVED' && pollRes.body.otp) {
        otpData = pollRes.body;
        break;
      }
    }
    assert.ok(otpData, 'OTP harus berhasil diterima sebelum timeout');
    assert.strictEqual(otpData.status, 'RECEIVED');
    assert.strictEqual(otpData.otp.length, 6);
    assert.ok(/^\d{6}$/.test(otpData.otp));
  });

  // TEST 5: Complete Real Registration Pipeline
  let newlyRegisteredAccount = null;
  await test('Initiate & Complete Full Registration Pipeline', async () => {
    // Step 5a: Initiate pipeline
    const initRes = await apiRequest('POST', '/api/accounts/register-pipeline/init', {
      gender: 'female',
      city: 'Bandung'
    });
    assert.strictEqual(initRes.status, 200);
    assert.strictEqual(initRes.body.success, true);
    assert.ok(initRes.body.activationId);
    assert.ok(initRes.body.identity.username);
    assert.strictEqual(initRes.body.identity.city, 'Bandung');

    // Wait for OTP
    let otpCode = null;
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 600));
      const poll = await apiRequest('POST', '/api/accounts/sms-gateway/check-otp', {
        activationId: initRes.body.activationId
      });
      if (poll.body.status === 'RECEIVED') {
        otpCode = poll.body.otp;
        break;
      }
    }
    assert.ok(otpCode, 'OTP Pipeline harus diterima');

    // Step 5b: Complete pipeline
    const compRes = await apiRequest('POST', '/api/accounts/register-pipeline/complete', {
      activationId: initRes.body.activationId,
      phone: initRes.body.phone || initRes.body.phoneNumber,
      phoneNumber: initRes.body.phone || initRes.body.phoneNumber,
      otp: otpCode,
      identity: initRes.body.identity,
      email: initRes.body.identity ? initRes.body.identity.email : initRes.body.email
    });
    assert.strictEqual(compRes.status, 200);
    assert.strictEqual(compRes.body.success, true);
    assert.strictEqual(compRes.body.account.accountType, 'real_registered');
    assert.strictEqual(compRes.body.account.cookieStatus, 'pending_cookie_bind');

    // Bind real cookies
    const bindRes = await apiRequest('POST', `/api/accounts/${compRes.body.account.id}/bind-cookies`, {
      cookies: 'SPC_U=88112233; SPC_EC=spc_ec_authentic_val; SPC_ST=spc_st_authentic_val; SPC_F=spc_f_val;'
    });
    assert.strictEqual(bindRes.status, 200);
    assert.strictEqual(bindRes.body.success, true);
    assert.strictEqual(bindRes.body.account.cookieStatus, 'alive');
    assert.ok(bindRes.body.account.cookies.includes('SPC_EC='));
    newlyRegisteredAccount = bindRes.body.account;
  });

  // TEST 6: Cookie Vault Import (Raw Text with SPC_EC, SPC_ST, SPC_U)
  let importedAccountId = null;
  await test('Import Real Cookies via Cookie Vault', async () => {
    const rawCookiesText = `SPC_U=991827364; SPC_EC=mock_ec_token_778899aabbcc; SPC_ST=mock_session_token_112233; SPC_T_ID=uuid-shopee-client; language=id;`;
    const res = await apiRequest('POST', '/api/accounts/import-cookies', {
      rawText: rawCookiesText
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.count >= 1);
    assert.strictEqual(res.body.accounts[0].accountType, 'real_authenticated');
    assert.strictEqual(res.body.accounts[0].cookieStatus, 'alive');
    importedAccountId = res.body.accounts[0].id;
  });

  // TEST 7: Single Cookie Validation
  await test('Validate Single Session Cookie Endpoint', async () => {
    assert.ok(importedAccountId);
    const res = await apiRequest('POST', `/api/accounts/${importedAccountId}/validate-cookie`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.status, 'alive');
  });

  // TEST 8: Bulk Cookies Validation
  await test('Validate All Session Cookies (Bulk Validation)', async () => {
    const res = await apiRequest('POST', '/api/accounts/validate-cookies');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.totalWithCookies >= 1);
    assert.ok(res.body.alive >= 1);

    // Clean up test accounts
    const accountManager = require('../identity/account-manager');
    if (newlyRegisteredAccount && newlyRegisteredAccount.id) accountManager.deleteAccount(newlyRegisteredAccount.id);
    if (importedAccountId) accountManager.deleteAccount(importedAccountId);
  });

  // TEST 9: Protocol Client Header Injection & Worker Emulation
  await test('Protocol Client Spoofed Headers Injection with Authentic Cookies', () => {
    const { buildSpoofedHeaders } = require('../core/protocol-client');
    const ShopeeLiveWorker = require('../core/shopee-live-worker');

    const testCookie = 'SPC_U=88112233; SPC_EC=spc_ec_authentic_val; SPC_ST=spc_st_authentic_val;';
    const headers = buildSpoofedHeaders({
      roomId: '987654321',
      accountUsername: 'shopee_user_test',
      cookie: testCookie
    });

    assert.ok(headers['Cookie'].includes('SPC_U=88112233'));
    assert.ok(headers['Cookie'].includes('SPC_EC=spc_ec_authentic_val'));
    assert.ok(headers['Cookie'].includes('SPC_ST=spc_st_authentic_val'));
    assert.ok(headers['Cookie'].includes('SPC_F='));
    assert.strictEqual(headers['Origin'], 'https://live.shopee.co.id');
    assert.ok(headers['User-Agent']);

    // Test Worker with authentic account
    const worker = new ShopeeLiveWorker({
      id: 'wrk-test-auth',
      roomId: '987654321',
      account: {
        id: 'acc-test',
        username: 'shopee_user_test',
        name: 'Siti Rahma',
        accountType: 'real_authenticated',
        cookies: testCookie
      }
    });

    return new Promise((resolve) => {
      worker.on('connected', (ev) => {
        assert.strictEqual(ev.workerId, 'wrk-test-auth');
        assert.strictEqual(ev.isAuthenticated, true);
        assert.strictEqual(ev.accountType, 'real_authenticated');
        worker.stop('TEST_DONE');
        resolve();
      });
      worker.start();
    });
  });

  // TEST 10: Accounts Endpoint Verification & Backward Compatibility
  await test('Verify Accounts API Data Structure & Backward Compatibility', async () => {
    const res = await apiRequest('GET', '/api/accounts');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(Array.isArray(res.body.accounts));

    // Ensure real registered and imported accounts appear in the list
    const foundRegistered = res.body.accounts.find(a => a.accountType === 'real_registered');
    const foundImported = res.body.accounts.find(a => a.accountType === 'real_authenticated');
    assert.ok(foundRegistered, 'Akun pendaftaran via SMS harus ada di database');
    assert.ok(foundImported, 'Akun import cookies harus ada di database');

    // Health score audit
    assert.ok(res.body.health);
    assert.ok(res.body.health.averageHealthScore >= 0);
  });

  // TEST 11: Frontend HTML Template Elements Verification
  await test('Frontend HTML Template Elements Verification', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../../frontend/index.html'), 'utf8');

    // Buttons
    assert.ok(html.includes('id="btn-open-cookie-modal"'), 'Tombol Import Real Cookies harus ada di HTML');
    assert.ok(html.includes('id="btn-open-sms-modal"'), 'Tombol Registrasi via SMS harus ada di HTML');

    // Modals
    assert.ok(html.includes('id="modal-import-cookies"'), 'Modal Import Cookies harus ada di HTML');
    assert.ok(html.includes('id="modal-sms-register"'), 'Modal SMS Register harus ada di HTML');

    // Wizard Steps
    assert.ok(html.includes('id="sms-step-1-container"'), 'Step 1 wizard harus ada');
    assert.ok(html.includes('id="sms-step-2-container"'), 'Step 2 wizard harus ada');
    assert.ok(html.includes('id="sms-step-3-container"'), 'Step 3 wizard harus ada');

    // Table Header 7 Columns
    assert.ok(html.includes('<th>Tipe & Kontak</th>'), 'Kolom Tipe & Kontak harus ada di tabel');
  });

  // TEST 12: Frontend JS Logic Verification
  await test('Frontend JS Logic & Badge Rendering Verification', () => {
    const js = fs.readFileSync(path.join(__dirname, '../../../frontend/js/app.js'), 'utf8');

    assert.ok(js.includes('/api/accounts/import-cookies'), 'API endpoint import-cookies harus dipanggil di app.js');
    assert.ok(js.includes('/api/accounts/register-pipeline/init'), 'API endpoint register-pipeline/init harus dipanggil di app.js');
    assert.ok(js.includes('/api/accounts/register-pipeline/complete'), 'API endpoint register-pipeline/complete harus dipanggil di app.js');
    assert.ok(js.includes('🔐 Real Cookie'), 'Badge 🔐 Real Cookie harus ada di app.js');
    assert.ok(js.includes('📱 Real SMS'), 'Badge 📱 Real SMS harus ada di app.js');
    assert.ok(js.includes('● Sesi Cookie Aktif'), 'Indikator cookie aktif harus ada di app.js');
  });

  console.log('\n================================================================');
  console.log(`🏁 TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
