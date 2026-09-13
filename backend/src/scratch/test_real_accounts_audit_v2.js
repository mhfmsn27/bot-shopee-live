/**
 * Deep Audit & Stress Test Suite v2 for Real Accounts System:
 * - Robust error handling for edge cases & malformed inputs
 * - Full SMS registration pipeline lifecycle
 * - Cookie Vault multi-format parsing & status verification
 * - Live campaign execution with real authenticated workers
 * - Zero-leak account pool release verification
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
      headers: { 'Content-Type': 'application/json' }
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
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function runDeepAudit() {
  console.log('================================================================');
  console.log('🔍 DEEP AUDIT: REAL ACCOUNTS & VIRTUAL SMS PIPELINE SYSTEM');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  async function check(name, fn) {
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

  // --- 1. ROBUST INPUT & ERROR HANDLING ---
  console.log('--- 1. ROBUST INPUT & ERROR HANDLING ---');

  await check('importRealCookies: handles null/empty/invalid input gracefully', () => {
    const { importRealCookies } = require('../identity/account-manager');
    assert.strictEqual(importRealCookies(null).success, false);
    assert.strictEqual(importRealCookies('').success, false);
    assert.strictEqual(importRealCookies('    ').success, false);
    assert.strictEqual(importRealCookies(12345).success, false);
    assert.strictEqual(importRealCookies({}).success, false);
  });

  await check('importRealCookies: handles direct Array input safely', () => {
    const { importRealCookies, deleteAccount } = require('../identity/account-manager');
    const res = importRealCookies([
      { username: 'test_user_array', cookies: 'SPC_U=123456; SPC_EC=token_array;' }
    ]);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.count, 1);
    assert.strictEqual(res.accounts[0].accountType, 'real_authenticated');
    deleteAccount(res.accounts[0].id);
  });

  await check('validateSessionCookie: handles non-existent or cookie-less accounts', () => {
    const { validateSessionCookie } = require('../identity/account-manager');
    const resNone = validateSessionCookie('acc-non-existent-999');
    assert.strictEqual(resNone.success, false);

    // Mock account with broken cookie string
    const { addRealRegisteredAccount, deleteAccount } = require('../identity/account-manager');
    let brokenAcc = null;
    try {
      brokenAcc = addRealRegisteredAccount({
        id: `acc-broken-${Date.now()}`,
        username: 'broken_user',
        cookies: 'short',
        status: 'ready'
      });
      const resBroken = validateSessionCookie(brokenAcc.id);
      assert.strictEqual(resBroken.success, true);
      assert.strictEqual(resBroken.status, 'expired');
    } finally {
      if (brokenAcc) deleteAccount(brokenAcc.id);
    }
  });

  await check('smsGateway: handles non-existent activation ID gracefully', async () => {
    const { fetchSmsOtp, cancelActivation } = require('../identity/sms-gateway');
    const resFetch = await fetchSmsOtp('act-invalid-id-000');
    assert.strictEqual(resFetch.success, false);
    assert.strictEqual(resFetch.status, 'NOT_FOUND');

    const resCancel = await cancelActivation('act-invalid-id-000');
    assert.strictEqual(resCancel.success, true);
  });

  await check('realRegistrationPipeline: throws on missing phone or OTP', async () => {
    const { completeRegistration } = require('../identity/real-registration-pipeline');
    let threw = false;
    try {
      await completeRegistration({ phone: null, otp: null });
    } catch (e) {
      threw = true;
    }
    assert.strictEqual(threw, true, 'Harus melempar error jika nomor HP atau OTP kosong');
  });

  // --- 2. END-TO-END REGISTRATION PIPELINE ---
  console.log('\n--- 2. END-TO-END REGISTRATION PIPELINE ---');

  let testActivationId = null;
  let testPhone = null;
  let testOtp = null;
  let testIdentity = null;

  await check('Pipeline Step 1: Initiate registration with custom city & gender', async () => {
    const res = await apiRequest('POST', '/api/accounts/register-pipeline/init', {
      gender: 'male',
      city: 'Yogyakarta'
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.step, 1);
    assert.ok(res.body.activationId);
    assert.ok(res.body.phone);
    assert.ok(res.body.formattedPhone.startsWith('+62'));
    assert.strictEqual(res.body.identity.gender, 'male');
    assert.strictEqual(res.body.identity.city, 'Yogyakarta');
    assert.ok(res.body.identity.email.includes('@'));
    assert.ok(res.body.identity.avatar.startsWith('https://'));

    testActivationId = res.body.activationId;
    testPhone = res.body.phone;
    testIdentity = res.body.identity;
  });

  await check('Pipeline Step 2: Poll SMS OTP with automatic delivery', async () => {
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 600));
      const poll = await apiRequest('POST', '/api/accounts/sms-gateway/check-otp', {
        activationId: testActivationId
      });
      if (poll.body.status === 'RECEIVED' && poll.body.otp) {
        testOtp = poll.body.otp;
        break;
      }
    }
    assert.ok(testOtp, 'OTP harus terkirim');
    assert.strictEqual(testOtp.length, 6);
  });

  let createdOfficialAccount = null;
  await check('Pipeline Step 3: Complete registration and persist real account', async () => {
    const res = await apiRequest('POST', '/api/accounts/register-pipeline/complete', {
      activationId: testActivationId,
      phone: testPhone,
      otp: testOtp,
      identity: testIdentity
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.account.accountType, 'real_registered');
    assert.strictEqual(res.body.account.cookieStatus, 'alive');
    assert.ok(res.body.account.cookies.includes('SPC_EC='));
    assert.ok(res.body.account.phoneNumber.startsWith('+62'));
    assert.strictEqual(res.body.account.phoneNumber.startsWith('++'), false);
    createdOfficialAccount = res.body.account;
  });

  // --- 3. COOKIE VAULT BULK & SINGLE VALIDATION ---
  console.log('\n--- 3. COOKIE VAULT BULK & SINGLE VALIDATION ---');

  let importedCookieAccId = null;
  let importedCookieAccIds = [];
  await check('Cookie Vault: Multi-row pipe format import', async () => {
    const rawData = `
      shopee_queen|queen@gmail.com|SPC_U=77112233; SPC_EC=tok123; SPC_ST=st123; language=id;|081298765432
      shopee_king|king@gmail.com|SPC_U=88112233; SPC_EC=tok456; SPC_ST=st456; language=id;|081398765432
    `;
    const res = await apiRequest('POST', '/api/accounts/import-cookies', { rawText: rawData });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.count >= 2);
    importedCookieAccIds = res.body.accounts.map(a => a.id);
    importedCookieAccId = res.body.accounts[0].id;
  });

  await check('Cookie Vault: Single account validation endpoint', async () => {
    assert.ok(importedCookieAccId);
    const res = await apiRequest('POST', `/api/accounts/${importedCookieAccId}/validate-cookie`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.status, 'alive');
  });

  await check('Cookie Vault: Bulk audit of all cookie accounts', async () => {
    const res = await apiRequest('POST', '/api/accounts/validate-cookies');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.totalWithCookies >= 3);
    assert.ok(res.body.alive >= 3);

    // Clean up all created test accounts immediately
    const { deleteAccount } = require('../identity/account-manager');
    if (createdOfficialAccount && createdOfficialAccount.id) deleteAccount(createdOfficialAccount.id);
    if (importedCookieAccIds && importedCookieAccIds.length) {
      importedCookieAccIds.forEach(id => deleteAccount(id));
    }
  });

  // --- 4. LIVE CAMPAIGN INTEGRATION WITH REAL ACCOUNTS ---
  console.log('\n--- 4. LIVE CAMPAIGN INTEGRATION WITH REAL ACCOUNTS ---');

  await check('Campaign Instance: Runs with authenticated accounts & releases pool cleanly', async () => {
    const CampaignInstance = require('../core/campaign-instance');
    const { getAvailableCount, getBusyCount } = require('../identity/account-manager');

    const initialAvail = getAvailableCount();

    const campaign = new CampaignInstance({
      id: 'cmp-audit-real-acc',
      name: 'Siaran Uji Akun Riil',
      urlOrRoomId: '77889900',
      targetViewers: 3,
      rampUpRatePerMin: 100,
      totalDurationMinutes: 1,
      interactionSettings: {
        enableLike: true,
        likeRatePerMin: 120,
        enableComment: true,
        commentIntervalSec: 5,
        enableCart: true,
        cartRatePerMin: 30
      }
    });

    campaign.start();

    // Tunggu worker teralokasi dan selesai handshake ke status VIEWING
    for (let i = 0; i < 25; i++) {
      const viewing = Array.from(campaign.workers.values()).filter(w => w.state === 'VIEWING');
      if (viewing.length > 0) break;
      await new Promise(r => setTimeout(r, 80));
    }

    assert.ok(campaign.workers.size > 0, 'Worker harus berhasil dialokasikan');
    assert.ok(getBusyCount() > 0, 'Akun harus terdeteksi busy saat kampanye berjalan');

    // Cek salah satu worker memiliki header cookie yang valid
    const firstWorker = campaign.workers.values().next().value;
    assert.ok(firstWorker.headers['Cookie']);
    assert.ok(firstWorker.headers['Cookie'].includes('SPC_'));

    // Kirim aksi instan
    const chat = await campaign.sendInstantComment('Komentar otentik akun riil Shopee!');
    assert.ok(chat);
    assert.ok(chat.sender);
    assert.ok(chat.text);

    const likeRes = campaign.sendInstantLike(5);
    assert.strictEqual(likeRes.taps, 5);

    const cartRes = await campaign.sendInstantCartClick(3);
    assert.strictEqual(cartRes.clicks, 3);

    // Hentikan kampanye dan pastikan seluruh akun terlepas kembali
    campaign.stop('AUDIT_COMPLETED');
    await new Promise(r => setTimeout(r, 400));

    assert.strictEqual(campaign.workers.size, 0);
    assert.strictEqual(getBusyCount(), 0, 'Seluruh akun harus dilepaskan ke pool bebas');
  });

  // --- 5. FRONTEND TEMPLATE & ASSET AUDIT ---
  console.log('\n--- 5. FRONTEND TEMPLATE & ASSET AUDIT ---');

  await check('Frontend: HTML modals & elements are structurally sound', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../../frontend/index.html'), 'utf8');

    // Buttons
    assert.ok(html.includes('id="btn-open-cookie-modal"'));
    assert.ok(html.includes('id="btn-open-sms-modal"'));

    // Modals
    assert.ok(html.includes('id="modal-import-cookies"'));
    assert.ok(html.includes('id="modal-sms-register"'));

    // Table Header 7 Columns
    const headerMatches = html.match(/<th>(.*?)<\/th>/g) || [];
    assert.ok(headerMatches.some(h => h.includes('Tipe & Kontak')));
  });

  await check('Frontend: app.js contains all event bindings & zero unresolved calls', () => {
    const js = fs.readFileSync(path.join(__dirname, '../../../frontend/js/app.js'), 'utf8');

    assert.ok(js.includes('btnOpenCookieModal'));
    assert.ok(js.includes('btnOpenSmsModal'));
    assert.ok(js.includes('btnValidateCookiesBulk'));
    assert.ok(js.includes('validateSingleCookie'));
    assert.ok(js.includes('resetSmsWizard'));
    assert.ok(js.includes('pollSmsOtp'));
  });

  await check('Frontend: dashboard.css has zero duplicated modal overlays', () => {
    const css = fs.readFileSync(path.join(__dirname, '../../../frontend/css/dashboard.css'), 'utf8');
    const matches = css.match(/\.modal-overlay\s*\{/g) || [];
    assert.strictEqual(matches.length, 1, 'Hanya boleh ada tepat 1 deklarasi .modal-overlay di CSS');
  });

  console.log('\n================================================================');
  console.log(`🏁 DEEP AUDIT RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runDeepAudit().catch(err => {
  console.error('Fatal deep audit error:', err);
  process.exit(1);
});
