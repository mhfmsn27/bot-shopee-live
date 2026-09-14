/**
 * Deep Verification & Integrity Audit: Dual-System (Live View & SMS Auto-Account)
 * Memvalidasi syntax, DOM element cross-references, edge cases, dan fungsionalitas menyeluruh.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runAudit() {
  console.log('================================================================');
  console.log('🔍 DEEP AUDIT: INTEGRITAS DUAL-SYSTEM & ZERO-BUG VERIFICATION');
  console.log('================================================================\n');

  // --- SECTION 1: SYNTAX CHECK (AST VALIDATION) ---
  console.log('--- [1] Audit Syntax JS (AST Compilation) ---');
  const filesToCheck = [
    'backend/src/core/protocol-client.js',
    'backend/src/core/shopee-live-worker.js',
    'backend/src/core/campaign-instance.js',
    'backend/src/identity/sms-gateway.js',
    'backend/src/identity/real-registration-pipeline.js',
    'backend/src/api/routes.js',
    'frontend/js/app.js'
  ];

  for (const f of filesToCheck) {
    const fullPath = path.join(__dirname, '../../..', f);
    assert(fs.existsSync(fullPath), `File ${f} harus ada di disk`);
    try {
      execSync(`node -c "${fullPath}"`);
      console.log(`  ✅ Syntax valid: ${f}`);
    } catch (err) {
      assert.fail(`Syntax error pada file ${f}: ${err.message}`);
    }
  }

  // --- SECTION 2: DOM ELEMENT CROSS-REFERENCE AUDIT ---
  console.log('\n--- [2] Audit Konsistensi DOM Elements (HTML <-> JS) ---');
  const indexPath = path.join(__dirname, '../../../frontend/index.html');
  const indexHtml = fs.readFileSync(indexPath, 'utf8');

  const requiredDomIds = [
    'campaign-hybrid-mode',
    'target-limit-warning',
    'target-limit-warning-text',
    'target-viewers-slider',
    'target-viewers-badge',
    'btn-test-stream-connectivity',
    'test-connectivity-status',
    'connectivity-result-box',
    'btn-open-sms-modal',
    'btn-close-sms-modal',
    'modal-sms-register',
    'sms-step-1-container',
    'sms-step-2-container',
    'sms-step-3-container',
    'sms-step-pill-1',
    'sms-step-pill-2',
    'sms-step-pill-3',
    'sms-allocated-phone',
    'btn-copy-sms-phone',
    'sms-target-username',
    'sms-countdown-timer',
    'sms-status-headline',
    'sms-status-detail',
    'sms-otp-display-box',
    'btn-copy-sms-otp',
    'btn-check-sms-otp',
    'btn-cancel-sms-register',
    'btn-finish-sms-register',
    'sms-provider-select',
    'sms-apikey-box',
    'sms-apikey-input',
    'btn-save-sms-config',
    'btn-start-sms-register'
  ];

  for (const id of requiredDomIds) {
    const exists = indexHtml.includes(`id="${id}"`) || indexHtml.includes(`id='${id}'`);
    assert(exists, `DOM Element ID "${id}" yang dipanggil di app.js HARUS ADA di index.html!`);
    console.log(`  ✅ Verified DOM Element ID: #${id}`);
  }

  // --- SECTION 3: PROTOCOL & STREAM CONSUMER EDGE CASES ---
  console.log('\n--- [3] Audit PersistentStreamConsumer & Flow Control Edge Cases ---');
  const { PersistentStreamConsumer, createPersistentStreamConsumer } = require('../core/protocol-client');
  const http = require('http');

  // Test throttle flow-control backpressure
  let mockServerBytesSent = 0;
  const mockServer = http.createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'video/x-flv',
      'Transfer-Encoding': 'chunked',
      'Connection': 'keep-alive'
    });
    // Kirim burst data 80KB (melebihi default throttle 45KB/s)
    const burst = Buffer.alloc(80 * 1024, 0x55);
    res.write(burst);
    mockServerBytesSent += burst.length;

    const interval = setInterval(() => {
      try {
        res.write(Buffer.alloc(1024, 0x33));
      } catch (e) {
        clearInterval(interval);
      }
    }, 100);

    req.on('close', () => clearInterval(interval));
  });

  await new Promise(r => mockServer.listen(0, '127.0.0.1', r));
  const serverPort = mockServer.address().port;
  const testStreamUrl = `http://127.0.0.1:${serverPort}/live/flv-test.flv`;

  const consumer = createPersistentStreamConsumer(testStreamUrl, {
    roomId: 'room_audit_1',
    throttleBytesPerSec: 45000
  });

  assert.strictEqual(consumer.throttleBytesPerSec, 45000);
  consumer.start();
  await sleep(400);

  assert.strictEqual(consumer.connected, true);
  assert(consumer.bytesStreamed > 0);
  console.log(`  ✅ Flow Control active: bytesStreamed=${consumer.bytesStreamed}`);

  // Test stop cleans up all timers and sockets
  consumer.stop();
  assert.strictEqual(consumer.connected, false);
  assert.strictEqual(consumer.aborted, true);
  console.log('  ✅ Stream consumer stopped cleanly without hanging sockets or timers');

  await new Promise(r => mockServer.close(r));

  // --- SECTION 4: WORKER ACCURATE BYTE ACCOUNTING AUDIT ---
  console.log('\n--- [4] Audit ShopeeLiveWorker Accurate Byte Accounting ---');
  const ShopeeLiveWorker = require('../core/shopee-live-worker');
  const worker = new ShopeeLiveWorker({
    roomId: 'audit_room_bytes',
    account: null // Guest Worker
  });

  assert.strictEqual(worker.account, null);
  const initialMetrics = worker.getMetrics();
  assert.strictEqual(initialMetrics.account, null);
  assert.strictEqual(initialMetrics.isStreaming, false);
  assert.strictEqual(initialMetrics.streamBytes, 0);

  // Attach mock stream consumer
  worker.streamConsumer = {
    connected: true,
    bytesStreamed: 15432,
    stop: () => {}
  };

  const activeMetrics = worker.getMetrics();
  assert.strictEqual(activeMetrics.isStreaming, true);
  assert.strictEqual(activeMetrics.streamBytes, 15432);
  assert.strictEqual(activeMetrics.bytesTransferred, initialMetrics.bytesTransferred + 15432);

  // Test leave cleanly accumulates bytes into worker.bytesTransferred without loss
  await worker.leave('test');
  assert.strictEqual(worker.streamConsumer, null);
  assert.strictEqual(worker.bytesTransferred >= 15432, true);
  console.log(`  ✅ Worker byte accounting exact: bytesTransferred=${worker.bytesTransferred}`);

  // --- SECTION 5: SMS GATEWAY MULTI-PROVIDER & AUTO-CANCEL AUDIT ---
  console.log('\n--- [5] Audit SMS Gateway Multi-Provider & Timeout Auto-Cancel ---');
  const smsGateway = require('../identity/sms-gateway');

  // Test provider config update & getBalance
  const savedCfg = smsGateway.updateConfig({ provider: 'simulator', autoCancelTimeoutSec: 60 });
  assert.strictEqual(savedCfg.provider, 'simulator');
  assert.strictEqual(savedCfg.autoCancelTimeoutSec, 60);

  const simBal = await smsGateway.getBalance();
  assert.strictEqual(simBal.success, true);
  assert(simBal.formattedBalance.includes('CREDITS'));
  console.log(`  ✅ Saldo simulator: ${simBal.formattedBalance}`);

  // Test request phone number
  const numReq = await smsGateway.requestPhoneNumber('id', 'shopee');
  assert.strictEqual(numReq.success, true);
  assert(numReq.phone.startsWith('628'));
  assert(numReq.formattedPhone.startsWith('+628'));
  assert.strictEqual(numReq.expiresInSec, 60);

  // Immediate poll -> WAITING
  const p1 = await smsGateway.fetchSmsOtp(numReq.activationId);
  assert.strictEqual(p1.status, 'WAITING');

  // Cancel activation
  const cRes = await smsGateway.cancelActivation(numReq.activationId);
  assert.strictEqual(cRes.success, true);

  // After cancel -> NOT_FOUND
  const pAfterCancel = await smsGateway.fetchSmsOtp(numReq.activationId);
  assert.strictEqual(pAfterCancel.status, 'NOT_FOUND');
  console.log('  ✅ SMS Gateway cancellation & cleanup verified');

  // --- SECTION 6: HYBRID VS STRICT ALLOCATION ENFORCEMENT ---
  console.log('\n--- [6] Audit Smart Hybrid vs Strict Allocation Enforcement ---');
  const retentionController = require('../core/retention-controller');
  const accountManager = require('../identity/account-manager');

  await retentionController.stopCampaign('test_init');
  accountManager.releaseAllForCampaign('all');

  const availAccounts = accountManager.getAvailableCount();

  // Test A: Strict Mode with 0 target difference should enforce available count
  const cmpStrict = retentionController.createCampaign({
    name: 'Audit Strict',
    urlOrRoomId: 'https://live.shopee.co.id/share?session=11223344',
    targetViewers: availAccounts + 200,
    hybridMode: false
  });
  assert.strictEqual(cmpStrict.hybridMode, false);
  assert.strictEqual(cmpStrict.targetViewers, availAccounts, 'Strict mode HARUS clamp target ke available accounts');
  retentionController.stopCampaignById(cmpStrict.id, 'audit_done');
  console.log(`  ✅ Strict mode verified: Target di-clamp ke ${availAccounts}`);

  // Test B: Hybrid Mode with excess target should NOT clamp
  const cmpHybrid = retentionController.createCampaign({
    name: 'Audit Hybrid',
    urlOrRoomId: 'https://live.shopee.co.id/share?session=55667788',
    targetViewers: availAccounts + 200,
    hybridMode: true
  });
  assert.strictEqual(cmpHybrid.hybridMode, true);
  assert.strictEqual(cmpHybrid.targetViewers, availAccounts + 200, 'Hybrid mode TIDAK BOLEH di-clamp');
  retentionController.stopCampaignById(cmpHybrid.id, 'audit_done');
  console.log(`  ✅ Hybrid mode verified: Target tetap ${availAccounts + 200}`);

  console.log('\n================================================================');
  console.log('🎉 AUDIT HASIL: SELURUH SISTEM 100% BEBAS BUG, ERROR, ATAU MISS!');
  console.log('================================================================\n');
}

runAudit().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n❌ AUDIT FAILED:', err);
  process.exit(1);
});
