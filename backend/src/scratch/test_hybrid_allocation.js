/**
 * Automated Test: Smart Hybrid Allocation (Anchor Viewers + Guest Persistent Streamers)
 */

const assert = require('assert');
const retentionController = require('../core/retention-controller');
const accountManager = require('../identity/account-manager');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('🧪 [TEST] Memulai pengujian Smart Hybrid Allocation Mode...');

  // Reset all campaigns and accounts
  await retentionController.stopCampaign('test_init');
  accountManager.releaseAllForCampaign('all');

  const totalAccounts = accountManager.getAllAccounts().length;
  console.log(`ℹ️ Total akun di database: ${totalAccounts}`);

  // TEST 1: Kampanye Hybrid Mode dengan target viewers melebihi akun yang tersedia
  console.log('\n--- TEST 1: Kampanye Hybrid Mode Melebihi Akun Tersedia ---');
  const targetExcess = totalAccounts + 50;
  const cmpMetrics = retentionController.createCampaign({
    name: 'Live Toko Hybrid (Test Boost)',
    urlOrRoomId: 'https://live.shopee.co.id/share?session=88888888',
    targetViewers: targetExcess,
    hybridMode: true,
    rampUpRatePerMin: 300
  });

  assert.strictEqual(cmpMetrics.hybridMode, true, 'hybridMode harus true');
  assert.strictEqual(cmpMetrics.targetViewers, targetExcess, 'Target viewers pada Hybrid Mode TIDAK BOLEH di-clamp ke batas akun');
  console.log(`    Requested: ${targetExcess} Viewers -> Applied Target: ${cmpMetrics.targetViewers} (TETAP UTUH ${cmpMetrics.targetViewers}!)`);

  // Tunggu workers spawn
  await sleep(2500);

  const activeCmp = retentionController.campaigns.get(cmpMetrics.id);
  assert(activeCmp, 'Kampanye harus aktif di retentionController');
  const workerCount = activeCmp.workers.size;
  console.log(`    Workers spawned so far: ${workerCount}`);
  assert(workerCount > 0, 'Harus ada worker yang di-spawn');

  // Periksa bahwa akun diklaim sebagai Anchor Viewers
  const busyCount = accountManager.getBusyCount();
  console.log(`    Anchor Viewers (Akun Terklaim): ${busyCount}`);
  assert(busyCount > 0, 'Harus ada akun yang diklaim sebagai anchor viewer');

  // TEST 2: Stop Kampanye Hybrid -> Pastikan semua akun dan worker dilepaskan
  console.log('\n--- TEST 2: Stop Kampanye Hybrid & Cleanup ---');
  retentionController.stopCampaignById(cmpMetrics.id, 'test_finish');
  await sleep(1000);

  const finalBusy = accountManager.getBusyCount();
  console.log(`    Setelah stop: Akun Sibuk = ${finalBusy}`);
  assert.strictEqual(finalBusy, 0, 'Seluruh akun harus dilepaskan setelah kampanye hybrid selesai');

  // TEST 3: Mode Standar Non-Hybrid (Strict Mode) tetap clamp
  console.log('\n--- TEST 3: Mode Standar Tetap Enforce Strict Limit ---');
  const cmpStrict = retentionController.createCampaign({
    name: 'Live Toko Strict (Test Clamp)',
    urlOrRoomId: 'https://live.shopee.co.id/share?session=99999999',
    targetViewers: totalAccounts + 100,
    hybridMode: false
  });

  assert.strictEqual(cmpStrict.hybridMode, false);
  assert.strictEqual(cmpStrict.targetViewers, totalAccounts, 'Mode standar harus tetap clamp target ke total akun');
  console.log(`    Mode Standar Target: ${cmpStrict.targetViewers} (di-clamp sesuai ${totalAccounts} akun)`);

  retentionController.stopCampaignById(cmpStrict.id, 'test_finish');
  await sleep(500);

  console.log('\n================================================================');
  console.log('🎉 PENGUJIAN SMART HYBRID ALLOCATION PASS 100% (ZERO BUG)!');
  console.log('================================================================\n');
}

runTests().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
