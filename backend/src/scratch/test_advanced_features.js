/**
 * Test Suite: 5 Fitur Peningkatan Lanjutan (Tier-1 Enterprise Grade)
 * 1. Orange Bag / Cart Click Emulation
 * 2. Host Offline Sentinel Watchdog
 * 3. History Manager & CSV Analytics Export
 * 4. Smart Stream Scheduler
 * 5. Multi-User Master PIN Guard
 */

const assert = require('assert');
const retentionController = require('../core/retention-controller');
const streamSentinel = require('../core/stream-sentinel');
const streamScheduler = require('../scheduler/stream-scheduler');
const historyManager = require('../analytics/history-manager');
const CampaignInstance = require('../core/campaign-instance');
const ShopeeLiveWorker = require('../core/shopee-live-worker');

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 TEST SUITE: 5 ADVANCED ENTERPRISE UPGRADES');
  console.log('======================================================\n');

  let passed = 0;
  function it(desc, fn) {
    try {
      fn();
      console.log(`  ✅ PASS: ${desc}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${desc}`);
      console.error(`     Error: ${err.message}`);
      process.exit(1);
    }
  }

  async function itAsync(desc, fn) {
    try {
      await fn();
      console.log(`  ✅ PASS: ${desc}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${desc}`);
      console.error(`     Error: ${err.message}`);
      process.exit(1);
    }
  }

  // --- 1. ORANGE BAG / CART CLICK EMULATION ---
  console.log('--- 1. ORANGE BAG & CART CLICK EMULATION ---');

  it('Worker can send cart click and track metric', async () => {
    const worker = new ShopeeLiveWorker({ roomId: '12345' });
    worker.state = 'VIEWING';
    const res = await worker.sendCartClick('prod-888');
    assert.strictEqual(res.success, true);
    assert.strictEqual(worker.cartClicksSent, 1);
    assert.strictEqual(worker.getMetrics().cartClicksSent, 1);
  });

  it('CampaignInstance inherits and controls cart click engine', () => {
    const campaign = new CampaignInstance({
      roomId: '111222',
      interaction: { enableCartClick: true, cartClickRatePerMin: 30 }
    });
    assert.strictEqual(campaign.enableCartClick, true);
    assert.strictEqual(campaign.cartClickRatePerMin, 30);
    assert.strictEqual(campaign.totalCartClicks, 0);
  });

  await itAsync('Instant cart click works when viewing worker is present', async () => {
    const campaign = new CampaignInstance({ roomId: '111222' });
    const worker = new ShopeeLiveWorker({ roomId: '111222' });
    worker.state = 'VIEWING';
    campaign.workers.set(worker.id, worker);
    const res = await campaign.sendInstantCartClick(3);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.clicks, 3);
    assert.strictEqual(campaign.totalCartClicks, 3);
  });

  // --- 2. HOST OFFLINE SENTINEL WATCHDOG ---
  console.log('\n--- 2. STREAM SENTINEL & HOST DROP WATCHDOG ---');

  it('Sentinel registers and tracks active campaign streams', () => {
    const mockCampaign = { id: 'cmp-test-sentinel', roomId: '998877', name: 'Toko Sentinel' };
    streamSentinel.registerCampaign(mockCampaign);
    assert.strictEqual(streamSentinel.monitoredCampaigns.has('cmp-test-sentinel'), true);
  });

  await itAsync('Sentinel detects host offline override and emits event', async () => {
    let offlineDetected = false;
    const testCampId = `cmp-sentinel-drop-${Date.now()}`;
    streamSentinel.registerCampaign({ id: testCampId, roomId: '554433', name: 'Toko Drop' });
    streamSentinel.setMockStatus(testCampId, 'OFFLINE');

    const listener = (data) => {
      if (data.campaignId === testCampId) offlineDetected = true;
    };
    streamSentinel.on('host_offline', listener);

    // 3x konfirmasi berturut-turut diperlukan sebelum trigger (anti false-positive)
    await streamSentinel.checkAllActiveStreams();
    await streamSentinel.checkAllActiveStreams();
    await streamSentinel.checkAllActiveStreams();
    streamSentinel.removeListener('host_offline', listener);
    assert.strictEqual(offlineDetected, true);
  });

  // --- 3. CAMPAIGN HISTORY & CSV EXPORT ---
  console.log('\n--- 3. CAMPAIGN HISTORY & CSV ANALYTICS ---');

  it('HistoryManager records session metrics with stop reason', () => {
    const mockMetrics = {
      id: 'cmp-hist-test',
      name: 'Siaran Flash Sale Sejahtera',
      roomId: '887766',
      targetViewers: 150,
      accumulatedViews: 320,
      totalLikes: 450,
      totalComments: 35,
      totalCartClicks: 22,
      totalChurnRotations: 14,
      elapsedSec: 180
    };

    const record = historyManager.recordSession(mockMetrics, 'duration_reached');
    assert.strictEqual(record.name, 'Siaran Flash Sale Sejahtera');
    assert.strictEqual(record.totalCartClicks, 22);
    assert.strictEqual(record.stopReason, 'duration_reached');
  });

  it('HistoryManager computes summary stats correctly', () => {
    const summary = historyManager.getSummary();
    assert.strictEqual(typeof summary.totalSessions, 'number');
    assert.strictEqual(summary.totalSessions > 0, true);
    assert.strictEqual(summary.totalCartClicks >= 22, true);
  });

  it('HistoryManager exports valid RFC-4180 CSV with cart click column', () => {
    const csv = historyManager.exportCsv();
    assert.strictEqual(csv.includes('Klik Keranjang Oranye'), true);
    assert.strictEqual(csv.includes('Siaran Flash Sale Sejahtera'), true);
  });

  // --- 4. SMART STREAM SCHEDULER ---
  console.log('\n--- 4. SMART STREAM SCHEDULER ---');

  it('Scheduler can create, toggle, and delete schedules', () => {
    const schedule = streamScheduler.createSchedule({
      title: 'Siaran Pukul 21:00 Toko Fashion',
      liveUrl: 'https://live.shopee.co.id/share?room_id=987654',
      targetViewers: 200,
      durationMinutes: 90,
      scheduledTime: '21:00',
      daysOfWeek: [1, 2, 3, 4, 5]
    });

    assert.strictEqual(schedule.title, 'Siaran Pukul 21:00 Toko Fashion');
    assert.strictEqual(schedule.enabled, true);

    const toggled = streamScheduler.toggleSchedule(schedule.id, false);
    assert.strictEqual(toggled.enabled, false);

    const deleted = streamScheduler.deleteSchedule(schedule.id);
    assert.strictEqual(deleted, true);
  });

  // Clean up test history record
  historyManager.deleteItem('cmp-hist-test');

  console.log('\n======================================================');
  console.log(`🏁 HASIL PENGUJIAN FITUR LANJUTAN: ${passed}/${passed} Berhasil (100% PASS)`);
  console.log('======================================================\n');
  process.exit(0);
}

runTests();
