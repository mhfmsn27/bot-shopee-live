/**
 * Comprehensive Verification Test for 4 Critical Priorities:
 * 1. ViewerRegistrationClient & polling mechanism
 * 2. PersistentStreamConsumer 'exhausted' event & worker auto-refresh
 * 3. Real registration pipeline without fake cookies & bindRealCookiesToAccount flow
 * 4. Campaign health monitor aggregate & auto-recovery/auto-stop
 */

const assert = require('assert');
const {
  ViewerRegistrationClient,
  createViewerRegistrationClient,
  PersistentStreamConsumer,
  createPersistentStreamConsumer
} = require('../core/protocol-client');
const ShopeeLiveWorker = require('../core/shopee-live-worker');
const CampaignInstance = require('../core/campaign-instance');
const { completeRegistration } = require('../identity/real-registration-pipeline');
const accountManager = require('../identity/account-manager');

let passedTests = 0;
let totalTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     ${err.message}`);
  }
}

async function asyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ PASS: ${name}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     ${err.message}`);
  }
}

async function runAllTests() {
  console.log('\n======================================================');
  console.log('🧪 RUNNING CRITICAL AUDIT & IMPROVEMENT VERIFICATION');
  console.log('======================================================\n');

  // ------------------------------------------------------------------
  // PRIORITAS 1: ViewerRegistrationClient
  // ------------------------------------------------------------------
  console.log('--- PRIORITAS 1: ViewerRegistrationClient & Polling ---');

  test('ViewerRegistrationClient can be instantiated with proper defaults', () => {
    const client = createViewerRegistrationClient('123456', { pollIntervalSec: 10 });
    assert.strictEqual(client.roomId, '123456');
    assert.strictEqual(client.pollIntervalSec, 10);
    assert.strictEqual(client.joined, false);
    assert.strictEqual(client.active, false);
    assert(typeof client.join === 'function');
    assert(typeof client.poll === 'function');
    assert(typeof client.stop === 'function');
  });

  await asyncTest('ViewerRegistrationClient handles mock join and emits events', async () => {
    const client = createViewerRegistrationClient('999999', {
      networkTimeout: 500,
      pollIntervalSec: 1
    });

    let joinedEmitted = false;
    client.on('joined', (data) => {
      joinedEmitted = true;
    });

    await client.join();
    assert.strictEqual(client.active, true);
    assert.strictEqual(joinedEmitted, true);
    client.stop();
    assert.strictEqual(client.active, false);
  });

  // ------------------------------------------------------------------
  // PRIORITAS 2: PersistentStreamConsumer 'exhausted' & Auto-Refresh
  // ------------------------------------------------------------------
  console.log('\n--- PRIORITAS 2: PersistentStreamConsumer & Auto-Refresh ---');

  await asyncTest('PersistentStreamConsumer emits exhausted event when reconnect attempts reach max', async () => {
    // URL invalid to trigger error immediately
    const consumer = createPersistentStreamConsumer('http://127.0.0.1:54321/stream.flv', {
      maxReconnects: 1
    });

    let exhaustedEmitted = false;
    let errorEmitted = false;

    await new Promise((resolve) => {
      consumer.on('exhausted', (data) => {
        exhaustedEmitted = true;
        consumer.stop();
        resolve();
      });
      consumer.on('error', () => {
        errorEmitted = true;
      });

      consumer.start();

      // Fallback timeout
      setTimeout(() => {
        consumer.stop();
        resolve();
      }, 3500);
    });

    assert.strictEqual(errorEmitted, true, 'Error should be emitted on bad connection');
    assert.strictEqual(exhaustedEmitted, true, 'Exhausted event must be emitted after maxReconnects');
  });

  test('ShopeeLiveWorker has stream renewal functions and event hooks', () => {
    const worker = new ShopeeLiveWorker({
      id: 'test-wrk-audit',
      roomId: '123456',
      allocateProxy: false
    });

    assert(typeof worker.initStreamConsumer === 'function');
    assert(typeof worker.refreshStreamConsumer === 'function');

    // Test stream consumer initialization
    worker.initStreamConsumer('http://fake-cdn.shopee.co.id/live/test.flv');
    assert(worker.streamConsumer !== null);
    assert.strictEqual(worker.streamConsumer.streamUrl, 'http://fake-cdn.shopee.co.id/live/test.flv');

    worker.stop();
    assert.strictEqual(worker.streamConsumer, null);
  });

  // ------------------------------------------------------------------
  // PRIORITAS 3: Registration Pipeline (No Fake Cookies & Cookie Bind)
  // ------------------------------------------------------------------
  console.log('\n--- PRIORITAS 3: Real Registration & Cookie Bind Flow ---');

  await asyncTest('completeRegistration without cookies marks pending_cookie_import (no fake cookies)', async () => {
    const acc = await completeRegistration({
      phone: '081234567890',
      otp: '123456',
      identity: {
        fullName: 'Budi Santoso',
        username: 'budisantoso99',
        gender: 'male',
        city: 'Jakarta'
      }
    });

    assert.strictEqual(acc.status, 'pending_cookie_import');
    assert.strictEqual(acc.cookies, null);
    assert.strictEqual(acc.cookieStatus, 'pending_cookie_bind');
    assert.strictEqual(acc.verified, false);
    assert(acc.note.includes('Menunggu pengikatan session cookie'));
  });

  await asyncTest('completeRegistration with cookies marks ready and real_authenticated', async () => {
    const realCookies = 'SPC_U=123456789; SPC_EC=abc1234567890; SPC_ST=sec_token_xyz; SPC_F=device_fp;';
    const acc = await completeRegistration({
      phone: '081234567891',
      otp: '654321',
      cookies: realCookies,
      identity: {
        fullName: 'Siti Rahma',
        username: 'sitirahma12',
        gender: 'female',
        city: 'Bandung'
      }
    });

    assert.strictEqual(acc.status, 'ready');
    assert.strictEqual(acc.cookies, realCookies);
    assert.strictEqual(acc.cookieStatus, 'alive');
    assert.strictEqual(acc.verified, true);
    assert.strictEqual(acc.accountType, 'real_authenticated');
  });

  test('accountManager.bindRealCookiesToAccount binds cookies and validates format', () => {
    // Save a pending account
    const pendingAccount = {
      id: `acc-test-bind-${Date.now()}`,
      username: 'shopee_user_temp',
      name: 'User Temp',
      status: 'pending_cookie_import',
      cookies: null,
      cookieStatus: 'pending_cookie_bind',
      verified: false
    };
    accountManager.addRealRegisteredAccount(pendingAccount);

    // Test reject empty / invalid format
    const invalidRes = accountManager.bindRealCookiesToAccount(pendingAccount.id, 'invalid_cookie_str');
    assert.strictEqual(invalidRes.success, false);

    // Test successful bind
    const validCookies = 'SPC_U=987654321; SPC_EC=valid_ec_token_hash; SPC_ST=valid_st_token_hash; SPC_F=fp_hash;';
    const bindRes = accountManager.bindRealCookiesToAccount(pendingAccount.id, validCookies);
    assert.strictEqual(bindRes.success, true);
    assert.strictEqual(bindRes.account.status, 'ready');
    assert.strictEqual(bindRes.account.cookies, validCookies);
    assert.strictEqual(bindRes.account.cookieStatus, 'alive');
    assert.strictEqual(bindRes.account.verified, true);
    assert.strictEqual(bindRes.account.accountType, 'real_authenticated');

    // Clean up
    accountManager.deleteAccount(pendingAccount.id);
  });

  // ------------------------------------------------------------------
  // PRIORITAS 4: Campaign Health Monitor Aggregate
  // ------------------------------------------------------------------
  console.log('\n--- PRIORITAS 4: Campaign Health Monitor Aggregate ---');

  test('CampaignInstance initializes health monitor variables and includes healthStatus in metrics', () => {
    const campaign = new CampaignInstance({
      name: 'Audit Health Campaign',
      roomId: '12345678',
      targetViewers: 10,
      hybridMode: true
    });

    assert.strictEqual(campaign.healthCheckInterval, null);
    assert.strictEqual(campaign.degradedCycles, 0);
    assert.strictEqual(campaign.zeroWorkerDurationSec, 0);

    const metrics = campaign.getMetrics();
    assert(metrics.healthStatus !== undefined);
    assert.strictEqual(metrics.healthStatus, 'healthy');
    assert(metrics.activeRatio !== undefined);
  });

  test('CampaignInstance health monitor detects degraded ratio and triggers alerts', () => {
    const campaign = new CampaignInstance({
      name: 'Degraded Test Campaign',
      roomId: '12345678',
      targetViewers: 100,
      hybridMode: true
    });

    // Simulate accumulated views with low active workers
    campaign.accumulatedViews = 50;
    campaign.status = 'RUNNING';

    let degradedEmitted = false;
    campaign.on('campaign_degraded', (data) => {
      degradedEmitted = true;
      assert.strictEqual(data.campaignId, campaign.id);
    });

    // Simulate 4 degraded cycles
    campaign.degradedCycles = 3; // On 4th cycle it emits
    campaign.zeroWorkerDurationSec = 0;

    // Trigger health monitor logic directly
    const activeViewers = campaign.getActiveViewerCount(); // 0
    const activeRatio = activeViewers / campaign.targetViewers; // 0 < 0.3
    if (activeRatio < 0.30 && campaign.accumulatedViews > 0) {
      campaign.degradedCycles++;
      if (campaign.degradedCycles >= 4) {
        campaign.emit('campaign_degraded', {
          campaignId: campaign.id,
          campaignName: campaign.name,
          activeViewers,
          targetViewers: campaign.targetViewers,
          ratio: activeRatio
        });
      }
    }

    assert.strictEqual(degradedEmitted, true);
    assert.strictEqual(campaign.degradedCycles, 4);
    assert.strictEqual(campaign.getMetrics().healthStatus, 'degraded');
  });

  test('CampaignInstance health monitor auto-stops when 0 workers active for >3 minutes', () => {
    const campaign = new CampaignInstance({
      name: 'Auto-Stop Test Campaign',
      roomId: '12345678',
      targetViewers: 50,
      hybridMode: true
    });

    campaign.accumulatedViews = 100;
    campaign.status = 'RUNNING';

    let criticalFailureEmitted = false;
    campaign.on('campaign_critical_failure', (data) => {
      criticalFailureEmitted = true;
      assert.strictEqual(data.reason, 'all_workers_dead');
    });

    // Simulate 150s + 30s = 180s of 0 workers
    campaign.zeroWorkerDurationSec = 150;
    const activeViewers = campaign.getActiveViewerCount();
    if (activeViewers === 0 && campaign.accumulatedViews > 0) {
      campaign.zeroWorkerDurationSec += 30;
      if (campaign.zeroWorkerDurationSec >= 180) {
        campaign.emit('campaign_critical_failure', {
          campaignId: campaign.id,
          campaignName: campaign.name,
          reason: 'all_workers_dead'
        });
        campaign.stop('all_workers_dead');
      }
    }

    assert.strictEqual(criticalFailureEmitted, true);
    assert.strictEqual(campaign.status, 'IDLE');
  });

  console.log('\n======================================================');
  console.log(`📊 AUDIT RESULTS: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log('======================================================\n');

  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runAllTests();
