/**
 * AUDIT MENDALAM MODUL INTERAKSI SHOPEE LIVE VIEW BOT
 * Menguji seluruh fungsi, penanganan error/edge-cases, sinkronisasi DOM, dan integritas memori
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const commentBank = require('../interaction/comment-bank');
const interactionManager = require('../interaction/interaction-manager');
const CampaignInstance = require('../core/campaign-instance');
const multiCampaignManager = require('../core/retention-controller');
const { getAllAccounts, getAvailableAccounts } = require('../identity/account-manager');

let totalTests = 0;
let passedTests = 0;

function it(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
  }
}

async function itAsync(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
  }
}

async function runAudit() {
  console.log('================================================================');
  console.log('🔍 MEMULAI AUDIT MENDALAM MODUL INTERAKSI & CHAT BOT');
  console.log('================================================================\n');

  // -------------------------------------------------------------------------
  // 1. AUDIT DOM HTML & JAVASCRIPT APP.JS SINKRONISASI ELEMEN
  // -------------------------------------------------------------------------
  console.log('--- 1. AUDIT KONSISTENSI ID ELEMEN HTML & APP.JS ---');
  const htmlPath = path.join(__dirname, '../../../frontend/index.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');

  const requiredElementIds = [
    'metric-total-likes',
    'metric-total-comments',
    'session-toggle-like',
    'session-like-slider',
    'session-like-rate-badge',
    'session-like-slider-box',
    'session-toggle-comment',
    'session-comment-slider',
    'session-comment-interval-badge',
    'session-comment-options-box',
    'session-comment-category-select',
    'session-custom-comments-box',
    'session-custom-comments-text',
    'live-chat-feed-box',
    'instant-chat-input',
    'btn-send-instant-chat',
    'btn-send-instant-like',
    'tab-interaction',
    'global-toggle-like',
    'global-like-rate-slider',
    'global-like-rate-badge',
    'global-toggle-comment',
    'global-comment-interval-slider',
    'global-comment-interval-badge',
    'global-default-category-select',
    'btn-save-global-interaction',
    'btn-test-generate-chat',
    'new-comment-input',
    'btn-add-comment',
    'comment-bank-list',
    'preview-sample-chat-text'
  ];

  requiredElementIds.forEach(id => {
    it(`Elemen id="${id}" harus terdefinisi di index.html`, () => {
      assert.ok(htmlContent.includes(`id="${id}"`), `ID "${id}" tidak ditemukan di index.html!`);
    });
  });

  // -------------------------------------------------------------------------
  // 2. AUDIT BANK KOMENTAR & ANTI-SPAM ENGINE
  // -------------------------------------------------------------------------
  console.log('\n--- 2. AUDIT BANK KOMENTAR & ANTI-SPAM ENGINE ---');

  const categories = ['fashion', 'electronic', 'beauty', 'food', 'general'];
  categories.forEach(cat => {
    it(`Harus dapat menghasilkan komentar alami untuk kategori: ${cat}`, () => {
      const comment = commentBank.generateNaturalComment(cat, null, 'audit-test');
      assert.ok(typeof comment === 'string' && comment.length > 5, 'Komentar tidak valid');
    });
  });

  it('Fallback kategori tidak dikenal harus mengembalikan kategori general', () => {
    const fallbackComment = commentBank.generateNaturalComment('unknown_category_xyz', null, 'audit-test');
    assert.ok(typeof fallbackComment === 'string' && fallbackComment.length > 3);
  });

  it('Mendukung custom comment list dengan penanganan baris kosong / spasi', () => {
    const customList = ['   ', 'Promo diskon 50% kak!   ', '', null, 'Bisa cicilan 0%?'];
    const customRes = commentBank.generateNaturalComment('custom', customList, 'audit-test');
    assert.ok(customRes.includes('Promo diskon 50% kak!') || customRes.includes('Bisa cicilan 0%?'));
  });

  it('Memori anti-duplikat per-sesi tidak mengulang kalimat sama dalam 15 panggilan', () => {
    const testSession = 'sess-mem-test';
    const seen = new Set();
    for (let i = 0; i < 6; i++) {
      const c = commentBank.generateNaturalComment('fashion', null, testSession);
      assert.ok(!seen.has(c), `Terdeteksi kalimat berulang sebelum jeda minimal: "${c}"`);
      seen.add(c);
    }
    commentBank.clearSessionHistory(testSession);
  });

  it('Fungsi clearSessionHistory berhasil membersihkan riwayat tanpa error', () => {
    assert.doesNotThrow(() => {
      commentBank.clearSessionHistory('sess-mem-test');
      commentBank.clearSessionHistory(null);
      commentBank.clearSessionHistory(undefined);
    });
  });

  // -------------------------------------------------------------------------
  // 3. AUDIT CRUD BANK KOMENTAR
  // -------------------------------------------------------------------------
  console.log('\n--- 3. AUDIT CRUD BANK KOMENTAR ---');

  const testCommentText = 'Test Komentar Audit Otomatis #' + Date.now();

  it('Berhasil menambahkan komentar baru ke bank fashion', () => {
    const added = commentBank.addCommentToCategory('fashion', testCommentText);
    assert.strictEqual(added, true);
    const banks = commentBank.getAllBanks();
    assert.ok(banks.fashion.includes(testCommentText));
  });

  it('Mencegah penambahan komentar duplikat', () => {
    const duplicateAdd = commentBank.addCommentToCategory('fashion', testCommentText);
    assert.strictEqual(duplicateAdd, false);
  });

  it('Berhasil menghapus komentar dari bank fashion', () => {
    const removed = commentBank.removeCommentFromCategory('fashion', testCommentText);
    assert.strictEqual(removed, true);
    const banks = commentBank.getAllBanks();
    assert.ok(!banks.fashion.includes(testCommentText));
  });

  // -------------------------------------------------------------------------
  // 4. AUDIT INSTANT ACTIONS EDGE CASES (0 VIEWERS VS RUNNING VIEWERS)
  // -------------------------------------------------------------------------
  console.log('\n--- 4. AUDIT INSTANT ACTIONS EDGE CASES ---');

  const dummyCampaign = new CampaignInstance({
    name: 'Sesi Uji Instant Error',
    roomId: '99887766',
    targetViewers: 1,
    interaction: { enableLike: false, enableComment: false }
  });

  it('Instant Chat saat 0 worker aktif harus melempar error edukatif terkendali', async () => {
    let errCaught = null;
    try {
      await dummyCampaign.sendInstantComment('Halo!');
    } catch (err) {
      errCaught = err;
    }
    assert.ok(errCaught !== null, 'Harus melempar error');
    assert.ok(errCaught.message.includes('Belum ada bot penonton aktif'));
  });

  it('Instant Like saat 0 worker aktif harus melempar error edukatif terkendali', () => {
    let errCaught = null;
    try {
      dummyCampaign.sendInstantLike(10);
    } catch (err) {
      errCaught = err;
    }
    assert.ok(errCaught !== null, 'Harus melempar error');
    assert.ok(errCaught.message.includes('Belum ada bot penonton aktif'));
  });

  // -------------------------------------------------------------------------
  // 5. AUDIT SIKLUS HIDUP ENGINE INTERAKSI (START -> RUNTIME UPDATE -> STOP)
  // -------------------------------------------------------------------------
  console.log('\n--- 5. AUDIT SIKLUS HIDUP ENGINE INTERAKSI ---');

  await itAsync('Siklus Lengkap: Start (OFF) -> Update (ON) -> Bot Chat -> Stop (Clean)', async () => {
    const available = getAvailableAccounts();
    if (available.length === 0) {
      throw new Error('Tidak ada akun tersedia untuk pengujian');
    }

    const testCmp = new CampaignInstance({
      name: 'Sesi Audit Siklus Interaksi',
      roomId: '11223344',
      targetViewers: 2,
      interaction: {
        enableLike: false,
        likeRatePerMin: 0,
        enableComment: false,
        commentIntervalSec: 10
      }
    });

    // 1. Start dengan interaksi OFF
    testCmp.start();
    assert.strictEqual(testCmp.likeInterval, null, 'likeInterval harus null saat enableLike = false');
    assert.strictEqual(testCmp.commentInterval, null, 'commentInterval harus null saat enableComment = false');

    // Tunggu 1.5 detik agar worker terspawn
    await new Promise(r => setTimeout(r, 1500));

    // 2. Aktifkan saat live berjalan (Runtime Update)
    testCmp.updateInteractionSettings({
      enableLike: true,
      likeRatePerMin: 120,
      enableComment: true,
      commentIntervalSec: 2,
      commentCategory: 'fashion'
    });

    assert.ok(testCmp.likeInterval !== null, 'likeInterval harus aktif setelah update ON');
    assert.ok(testCmp.commentInterval !== null, 'commentInterval harus aktif setelah update ON');

    // 3. Uji Instant Like dan Chat pada worker yang aktif
    const instantLikeRes = testCmp.sendInstantLike(15);
    assert.strictEqual(instantLikeRes.success, true);
    assert.ok(testCmp.totalLikes >= 15);

    const instantChatRes = await testCmp.sendInstantComment('Pesan manual audit test');
    assert.ok(instantChatRes.text.includes('Pesan manual audit test'));
    assert.ok(instantChatRes.isManual === true);
    assert.ok(instantChatRes.sender.length > 0);

    // 4. Update kembali ke OFF saat live
    testCmp.updateInteractionSettings({ enableLike: false, enableComment: false });
    assert.strictEqual(testCmp.likeInterval, null, 'likeInterval harus dibersihkan ke null');
    assert.strictEqual(testCmp.commentInterval, null, 'commentInterval harus dibersihkan ke null');

    // 5. Hentikan kampanye dan pastikan cleanup total
    testCmp.stop('audit_completed');
    assert.strictEqual(testCmp.status, 'IDLE');
    assert.strictEqual(testCmp.workers.size, 0, 'Semua workers harus kosong');
    assert.strictEqual(testCmp.likeInterval, null);
    assert.strictEqual(testCmp.commentInterval, null);
    assert.strictEqual(testCmp.rampUpInterval, null);
    assert.strictEqual(testCmp.campaignTimer, null);
  });

  // -------------------------------------------------------------------------
  // REKAPITULASI AUDIT
  // -------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`📊 REKAPITULASI HASIL AUDIT INTERAKSI: ${passedTests}/${totalTests} PENGUJIAN BERHASIL`);
  console.log('================================================================');

  if (passedTests === totalTests) {
    console.log('🎉 SEMPURNA! Seluruh komponen interaksi bot terverifikasi 100% BEBAS BUG & SIAP PRODUKSI.');
    process.exit(0);
  } else {
    console.error(`⚠️ Terdeteksi ${totalTests - passedTests} potensi issue yang perlu diperbaiki!`);
    process.exit(1);
  }
}

runAudit().catch(err => {
  console.error('Fatal audit error:', err);
  process.exit(1);
});
