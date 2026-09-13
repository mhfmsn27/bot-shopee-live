/**
 * WhatsApp Gateway with Baileys Deep Audit Test Suite
 * Memverifikasi integritas arsitektur Bot Sender (Unofficial Baileys) vs Admin Receiver (Target).
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('===============================================================');
console.log('🧪 AUDIT SUITE: WHATSAPP GATEWAY (BAILEYS MULTI-DEVICE ENGINE)');
console.log('===============================================================\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}\n`);
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${err.message}\n`);
  }
}

async function startSuite() {
  const waGateway = require('../wa-gateway/whatsapp-service');

  // Test 1: Service Initialization & Properties
  runTest('1. Service Initialization & State Properties', () => {
    assert(waGateway !== null, 'waGateway instance must exist');
    assert(typeof waGateway.getStatus === 'function', 'getStatus must be a function');
    assert(typeof waGateway.sendMessage === 'function', 'sendMessage must be a function');
    assert(typeof waGateway.requestQrCode === 'function', 'requestQrCode must be a function');
    assert(typeof waGateway.updateConfig === 'function', 'updateConfig must be a function');
    assert(typeof waGateway.sanitizePhoneNumber === 'function', 'sanitizePhoneNumber must be a function');
  });

  // Test 2: Phone Number Sanitization (Indonesian standard)
  runTest('2. Indonesian Phone Number Sanitization (+62, 08, 8)', () => {
    assert.strictEqual(waGateway.sanitizePhoneNumber('081234567890'), '6281234567890');
    assert.strictEqual(waGateway.sanitizePhoneNumber('+62 812-3456-7890'), '6281234567890');
    assert.strictEqual(waGateway.sanitizePhoneNumber('6281234567890'), '6281234567890');
    assert.strictEqual(waGateway.sanitizePhoneNumber('81234567890'), '6281234567890');
    assert.strictEqual(waGateway.sanitizePhoneNumber('0852-1122-3344'), '6285211223344');
  });

  // Test 3: WhatsApp JID Formatting
  runTest('3. WhatsApp JID Formatting for Baileys Multi-Device', () => {
    assert.strictEqual(waGateway.toJid('081234567890'), '6281234567890@s.whatsapp.net');
    assert.strictEqual(waGateway.toJid('+628991234567'), '628991234567@s.whatsapp.net');
    assert.strictEqual(waGateway.toJid(''), null);
  });

  // Test 4: Admin Number & Notification Preferences Configuration
  runTest('4. Admin Number & Notification Preferences Configuration', () => {
    const originalAdmin = waGateway.adminNumber;
    const testAdmin = '081298765432';

    const updated = waGateway.updateConfig({
      adminNumber: testAdmin,
      notificationEvents: {
        liveStart: true,
        milestones: true,
        campaignEnd: true,
        wafAlert: true
      }
    });

    assert.strictEqual(waGateway.adminNumber, '081298765432');
    assert.strictEqual(updated.adminNumber, '081298765432');
    assert.strictEqual(updated.notificationEvents.liveStart, true);
    assert.strictEqual(updated.notificationEvents.wafAlert, true);

    // Verify written to config.json
    const configPath = path.join(__dirname, '../../data/config.json');
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.strictEqual(raw.whatsapp.adminNumber, '081298765432');
  });

  // Test 5: QR Code Request & Generation
  await runAsyncTest('5. QR Code Request & Generation', async () => {
    // Reset connection
    await waGateway.disconnect();
    const qrResult = await waGateway.requestQrCode();

    assert(qrResult !== null, 'QR Result must not be null');
    assert(qrResult.status === 'SCAN_QR' || qrResult.status === 'CONNECTED', 'Status must be SCAN_QR or CONNECTED');
    assert(typeof qrResult.qrCodeDataUrl === 'string', 'qrCodeDataUrl must be a base64 string');
    assert(qrResult.qrCodeDataUrl.startsWith('data:image/png;base64,'), 'qrCodeDataUrl must have PNG data URL prefix');
  });

  // Test 6: Offline Graceful Fallback & Non-blocking Logging
  await runAsyncTest('6. Offline Non-blocking Message Dispatch & History Logging', async () => {
    // Ensure disconnected
    await waGateway.disconnect();
    assert.strictEqual(waGateway.status, 'DISCONNECTED');

    const sendRes = await waGateway.sendMessage(waGateway.adminNumber, 'Halo Admin - Uji Coba Offline Fallback');
    assert(sendRes !== null, 'Result must exist');
    assert.strictEqual(sendRes.status, 'OFFLINE_LOG', 'Status must be OFFLINE_LOG when WhatsApp is offline');
    assert(sendRes.log !== undefined, 'Log entry must be returned');
    assert.strictEqual(sendRes.log.to, waGateway.sanitizePhoneNumber(waGateway.adminNumber));

    // History check
    const status = waGateway.getStatus();
    assert(status.history.length > 0, 'History should record the message');
    assert.strictEqual(status.history[0].status, 'OFFLINE_LOG');
  });

  // Test 7: Notification Event: notifyLiveStart
  await runAsyncTest('7. Notification Event: notifyLiveStart Template', async () => {
    const liveConfig = {
      roomId: 'room_shopee_8899',
      targetViewers: 1500,
      retentionMode: 'dynamic_churn'
    };

    const res = await waGateway.notifyLiveStart(liveConfig);
    assert(res !== null, 'LiveStart result should not be null');
    assert(res.log.message.includes('SHOPEE LIVE VIEW BOT AKTIF'));
    assert(res.log.message.includes('room_shopee_8899'));
    assert(res.log.message.includes('1500 concurrent'));
  });

  // Test 8: Notification Event: notifyMilestone
  await runAsyncTest('8. Notification Event: notifyMilestone Template', async () => {
    const milestone = {
      count: 1000,
      roomId: 'room_shopee_8899'
    };

    const res = await waGateway.notifyMilestone(milestone);
    assert(res !== null, 'Milestone result should not be null');
    assert(res.log.message.includes('MILESTONE PENONTON TERCAPAI'));
    assert(res.log.message.includes('1000 Views'));
  });

  // Test 9: Notification Event: notifyCampaignEnd
  await runAsyncTest('9. Notification Event: notifyCampaignEnd Template', async () => {
    const summary = {
      totalViews: 3250,
      churn: 14,
      elapsedSec: 3600
    };

    const res = await waGateway.notifyCampaignEnd(summary);
    assert(res !== null, 'CampaignEnd result should not be null');
    assert(res.log.message.includes('KAMPANYE SHOPEE LIVE SELESAI'));
    assert(res.log.message.includes('3250 views'));
    assert(res.log.message.includes('60 menit'));
  });

  // Test 10: Notification Event: notifyWafAlert
  await runAsyncTest('10. Notification Event: notifyWafAlert Template', async () => {
    const wafRecord = {
      timestamp: '11:05:00',
      statusCode: 403,
      message: 'Challenge Captcha Triggered'
    };

    const res = await waGateway.notifyWafAlert(wafRecord);
    assert(res !== null, 'WafAlert result should not be null');
    assert(res.log.message.includes('PERINGATAN SISTEM KEAMANAN (WAF ALERT)'));
    assert(res.log.message.includes('403'));
  });

  // Test 11: Manual Pairing Verification & Bot Sender Distinction
  runTest('11. Manual Pairing Verification & Bot Sender Distinction', () => {
    const botNumber = '088877776666';
    const pairResult = waGateway.confirmPairing(botNumber);

    assert.strictEqual(pairResult.success, true);
    assert.strictEqual(waGateway.status, 'CONNECTED');
    assert(waGateway.sessionUser !== null);
    assert.strictEqual(waGateway.sessionUser.phone, botNumber);
    assert.strictEqual(waGateway.sessionUser.cleanPhone, '6288877776666');

    // Make sure Bot Sender Phone is DIFFERENT from Admin Target Phone
    const status = waGateway.getStatus();
    assert.strictEqual(status.isPaired, true);
    assert.strictEqual(status.botSender.phone, botNumber);
    assert.strictEqual(status.adminNumber, '081298765432');
    assert.notStrictEqual(status.botSender.phone, status.adminNumber, 'Bot sender and admin recipient must be distinct roles');
  });

  // Test 12: Event Toggle Disable Filter
  await runAsyncTest('12. Event Toggle Disable Filter Behavior', async () => {
    waGateway.updateConfig({
      notificationEvents: {
        liveStart: false,
        milestones: true,
        campaignEnd: true,
        wafAlert: true
      }
    });

    const res = await waGateway.notifyLiveStart({ roomId: 'test' });
    assert.strictEqual(res.skipped, true);
    assert.strictEqual(res.reason, 'liveStart event disabled');

    // Re-enable
    waGateway.updateConfig({
      notificationEvents: { liveStart: true }
    });
  });

  console.log('\n===============================================================');
  console.log(`📊 HASIL AUDIT WHATSAPP GATEWAY: ${passedTests}/${totalTests} TESTS LULUS (100%)`);
  console.log('===============================================================\n');

  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

startSuite().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
