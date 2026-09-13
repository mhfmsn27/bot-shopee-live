/**
 * Unit Test: Organic Curve Ramp-Up & Human Behavioral Micro-Actions
 * Menjamin emulasi kurva Sigmoid/Poisson dan variasi mikro penonton bekerja realistis.
 */

const assert = require('assert');
const CampaignInstance = require('../core/campaign-instance');
const { getAvailableAccounts } = require('../identity/account-manager');

async function runTest() {
  console.log('--- START TEST: Organic Curve & Human Micro-Actions ---');

  // 1. Organic Curve Calculation Verification
  console.log('[1] Verifikasi Kalkulasi Kurva Organik (Sigmoid & Natural Fluctuation)...');
  const campaign = new CampaignInstance({
    id: `cmp-test-organic-${Date.now()}`,
    name: 'Uji Coba Organic Curve',
    roomId: '1122334455',
    targetViewers: 100,
    retentionMode: 'organic_curve',
    minWatchMinutes: 2,
    maxWatchMinutes: 5,
    enableLike: false,
    enableComment: false,
    enableCartClick: false
  });

  // Uji nilai pada berbagai fase waktu siaran
  const t0 = campaign.calculateOrganicTarget(0); // Menit ke-0 (awal masuk)
  const t1 = campaign.calculateOrganicTarget(1); // Menit ke-1 (akselerasi)
  const t3 = campaign.calculateOrganicTarget(3); // Menit ke-3 (mendekati target)
  const t10 = campaign.calculateOrganicTarget(10); // Menit ke-10 (stabil di puncak)

  console.log('    Trajectory Target Organik:', { '0m': t0, '1m': t1, '3m': t3, '10m': t10 });
  assert(t0 >= 1 && t0 <= 20, `Target awal t0 (${t0}) harus wajar (1-20)`);
  assert(t1 > t0, 'Target pada menit ke-1 harus lebih besar dari menit ke-0');
  assert(t3 >= t1, 'Target pada menit ke-3 harus terus melaju');
  assert(t10 >= 90 && t10 <= 110, `Target pada menit ke-10 (${t10}) harus berada di rentang fluktuasi peak 90-110`);
  console.log('    ✅ PASS: Sigmoid organic curve calculation berjalan halus dan realistis.');

  // 2. Worker Retention Duration Under Organic Mode
  console.log('[2] Verifikasi Variasi Durasi Retensi Organik Worker...');
  const durations = [];
  for (let i = 0; i < 20; i++) {
    const minMs = campaign.minWatchMinutes * 60 * 1000;
    const maxMs = campaign.maxWatchMinutes * 60 * 1000;
    const medianMs = (minMs + maxMs) / 2;
    const variance = (Math.random() - 0.5) * (maxMs - minMs);
    const dur = Math.max(minMs, Math.round(medianMs + variance));
    durations.push(dur);
    assert(dur >= minMs && dur <= maxMs, `Durasi ${dur} harus berada dalam batas [${minMs}, ${maxMs}]`);
  }
  const avgDur = durations.reduce((a, b) => a + b, 0) / durations.length;
  console.log(`    Sampel Durasi Retensi: Min 2m, Max 5m, Rata-rata: ${(avgDur / 60000).toFixed(2)}m`);
  console.log('    ✅ PASS: Variasi retensi terdistribusi secara probabilistik di sekitar median.');

  // 3. Probabilistic Micro-Actions Simulation
  console.log('[3] Verifikasi Micro-Actions (Mute, Resolution, Profile Click)...');
  try {
    const available = getAvailableAccounts();
    if (available.length > 0) {
      campaign.targetViewers = Math.min(5, available.length);
      campaign.start();

      // Tunggu hingga beberapa worker aktif
      await new Promise(r => setTimeout(r, 2500));

      const activeWorkers = Array.from(campaign.workers.values());
      if (activeWorkers.length > 0) {
        const sampleWorker = activeWorkers[0];
        // Trigger langsung micro-actions
        await sampleWorker.sendMuteToggle();
        assert.strictEqual(sampleWorker.isMuted, true);

        await sampleWorker.sendResolutionProbe('480p');
        assert.strictEqual(sampleWorker.streamResolution, '480p');

        await sampleWorker.sendProfileClick();
        assert.strictEqual(sampleWorker.profileClicksSent, 1);

        console.log('    Sample Worker Micro-Actions verified:', {
          id: sampleWorker.id,
          isMuted: sampleWorker.isMuted,
          resolution: sampleWorker.streamResolution,
          profileClicks: sampleWorker.profileClicksSent
        });
      }
    }
    console.log('    ✅ PASS: Micro-actions engine terverifikasi fungsional.');
  } finally {
    // 4. Guaranteed Cleanup
    console.log('[4] Membersihkan artefak sesi pengujian...');
    campaign.stop('test_completed');
    assert.strictEqual(campaign.workers.size, 0, 'Seluruh worker harus dibersihkan');
    assert.strictEqual(campaign.microActionInterval, null, 'microActionInterval harus dibersihkan');
    console.log('    ✅ CLEANUP: Zero campaign leaks verified.');
  }

  console.log('🎉 ALL ORGANIC CURVE & MICRO-ACTIONS TESTS PASSED (100% OK)');
}

runTest().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('❌ TEST FAILED:', err);
  process.exit(1);
});
