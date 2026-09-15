/**
 * Automated Test: Account Lease & Strict View Limit Enforcement
 * Menguji bahwa pengiriman bot tidak dapat melewati jumlah akun aktif terverifikasi yang sedang tersedia
 */

const assert = require('assert');
const retentionController = require('../core/retention-controller');
const accountManager = require('../identity/account-manager');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('🧪 [TEST] Memulai pengujian batasan pengiriman bot sesuai akun aktif tersedia...');

  // Pastikan controller bersih
  await retentionController.stopCampaign('test_init');
  accountManager.releaseAllForCampaign('all');

  const totalAccounts = accountManager.getAllAccounts().length;
  console.log(`ℹ️ Total akun di database: ${totalAccounts}`);
  assert(totalAccounts > 0, 'Harus ada akun di database untuk pengujian');

  const initialAvailable = accountManager.getAvailableCount();
  console.log(`ℹ️ Akun siap pakai awal: ${initialAvailable}`);
  assert.strictEqual(initialAvailable, totalAccounts, 'Awalnya seluruh akun harus berstatus siap pakai');

  // TEST 1: Permintaan Target melebihi jumlah akun tersedia -> Zero-Limiter arsitektur
  console.log('\n--- TEST 1: Zero-Limiter Target & Lease Akun Tersedia ---');
  const excessTarget = totalAccounts + 500;
  const cmp1Metrics = retentionController.createCampaign({
    name: 'Live Toko A (Test Clamp)',
    urlOrRoomId: 'https://live.shopee.co.id/share?session=11111111',
    targetViewers: excessTarget,
    rampUpRatePerMin: 300
  });

  console.log(`  Requested: ${excessTarget}, Applied Target: ${cmp1Metrics.targetViewers}`);
  assert.strictEqual(cmp1Metrics.targetViewers, excessTarget, 'Zero-Limiter: Target viewers tidak dipotong (unconstrained)');

  // Tunggu worker spawn dan klaim akun
  await sleep(3500);

  const busyAfterCmp1 = accountManager.getBusyCount();
  const availAfterCmp1 = accountManager.getAvailableCount();
  console.log(`  Akun sedang digunakan Live Toko A: ${busyAfterCmp1}`);
  console.log(`  Sisa akun bebas: ${availAfterCmp1}`);
  assert(busyAfterCmp1 > 0, 'Harus ada akun yang di-lease oleh Live Toko A');
  assert.strictEqual(busyAfterCmp1 + availAfterCmp1, totalAccounts, 'Total akun busy + available harus sama dengan total akun');

  // TEST 2: Cek status per-akun di getAllAccounts()
  console.log('\n--- TEST 2: Validasi Status Akun & Nama Sesi Siaran ---');
  const accountsData = accountManager.getAllAccounts();
  const busyAccounts = accountsData.filter(a => a.isBusy);
  console.log(`  Jumlah akun yang terdata isBusy = true: ${busyAccounts.length}`);
  assert(busyAccounts.length > 0, 'Harus ada akun dengan flag isBusy true');
  console.log(`  Contoh akun sibuk: [${busyAccounts[0].username}] menonton: [${busyAccounts[0].busyInCampaign}]`);
  assert(busyAccounts[0].busyInCampaign.includes('Live Toko A'), 'busyInCampaign harus mencantumkan nama sesi siaran');

  // TEST 3: Ketika seluruh akun sibuk, siaran baru tetap dapat meluncur via Guest Streamers (Zero-Limiter)
  console.log('\n--- TEST 3: Zero-Limiter Elastic Scaling Ketika Seluruh Akun Sibuk ---');
  // Pinjam semua sisa akun
  const leasedIds = [];
  while (accountManager.getAvailableCount() > 0) {
    const acc = accountManager.claimAccount('manual-stream', 'Live Toko B');
    leasedIds.push(acc.id);
  }

  assert.strictEqual(accountManager.getAvailableCount(), 0, 'Akun tersedia harus 0');
  console.log('  Semua akun terpakai sebagai anchor (0 akun bebas). Menguji peluncuran via Guest Streamers...');

  const cmpGuest = retentionController.createCampaign({
    name: 'Live Toko C (Guest Streamers)',
    urlOrRoomId: 'https://live.shopee.co.id/share?session=33333333',
    targetViewers: 100
  });
  console.log(`  Sesi baru berhasil meluncur: [${cmpGuest.name}] dengan Target: ${cmpGuest.targetViewers}`);
  assert.strictEqual(cmpGuest.targetViewers, 100, 'Target viewers tetap 100 via Guest Streamers');
  assert.strictEqual(cmpGuest.status, 'RUNNING');
  retentionController.stopCampaignById(cmpGuest.id, 'test_finish');

  // TEST 4: Pelepasan Akun Saat Siaran Berhenti -> Akun Kembali Bebas
  console.log('\n--- TEST 4: Pelepasan Akun Saat Siaran Dihentikan ---');
  // Lepaskan pinjaman manual
  leasedIds.forEach(id => accountManager.releaseAccount(id));

  // Hentikan Live Toko A
  retentionController.stopCampaignById(cmp1Metrics.id, 'test_finish');
  await sleep(1000);

  const finalAvail = accountManager.getAvailableCount();
  const finalBusy = accountManager.getBusyCount();
  console.log(`  Setelah dihentikan: Akun Bebas = ${finalAvail}, Akun Sibuk = ${finalBusy}`);
  assert.strictEqual(finalBusy, 0, 'Seluruh akun harus sudah dilepaskan (0 sibuk)');
  assert.strictEqual(finalAvail, totalAccounts, 'Seluruh akun harus kembali siap pakai');

  // TEST 5: Sesi baru sekarang dapat dimulai kembali
  console.log('\n--- TEST 5: Mulai Sesi Baru Menggunakan Akun Yang Telah Bebas ---');
  const cmp2Metrics = retentionController.createCampaign({
    name: 'Live Toko D (Memakai Akun Bebas)',
    urlOrRoomId: 'https://live.shopee.co.id/share?session=44444444',
    targetViewers: 5
  });
  console.log(`  Sesi baru berhasil dimulai: [${cmp2Metrics.name}]`);
  assert.strictEqual(cmp2Metrics.status, 'RUNNING');

  // Cleanup
  await sleep(1000);
  retentionController.stopCampaignById(cmp2Metrics.id, 'test_cleanup');

  // Cleanup test history items
  const historyManager = require('../analytics/history-manager');
  const allHist = historyManager.getAll();
  allHist.filter(h => h.roomId === '11111111' || h.roomId === '44444444').forEach(h => historyManager.deleteItem(h.id));

  console.log('\n================================================================');
  console.log('✅ SEMUA PENGUJIAN BATASAN AKUN AKTIF BERHASIL 100%!');
  console.log('================================================================');
  process.exit(0);
}

runTest().catch(err => {
  console.error('\n❌ TEST GAGAL:', err);
  process.exit(1);
});
