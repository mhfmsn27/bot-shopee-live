/**
 * Automated Test: Interaction Engine (Tap Like, Auto-Chat, Global & Per-Session)
 */

const assert = require('assert');
const { commentBank, getGlobalConfig, updateGlobalConfig } = require('../interaction/interaction-manager');
const ShopeeLiveWorker = require('../core/shopee-live-worker');
const retentionController = require('../core/retention-controller');

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runTest() {
  console.log('🧪 [TEST] Memulai pengujian Modul Interaksi (Tap-Tap Like & Live Chat)...');

  // 1. Uji Generator Komentar & Bank Kategori
  console.log('\n--- 1. Uji Generator Komentar & Anti-Spam ---');
  const fashionComment = commentBank.generateNaturalComment('fashion');
  console.log(`  Contoh Chat Fashion: "${fashionComment}"`);
  assert(fashionComment.length > 5, 'Komentar fashion harus valid');

  const gadgetComment = commentBank.generateNaturalComment('electronic');
  console.log(`  Contoh Chat Elektronik: "${gadgetComment}"`);
  assert(gadgetComment.length > 5, 'Komentar gadget harus valid');

  const customSample = ['Etalase 5 diskon berapa?', 'Ada warna navy gak?'];
  const customComment = commentBank.generateNaturalComment('custom', customSample);
  console.log(`  Contoh Chat Custom: "${customComment}"`);
  assert(customComment.includes('Etalase 5') || customComment.includes('warna navy'), 'Komentar custom harus menggunakan custom list');

  // 2. Uji Konfigurasi Global
  console.log('\n--- 2. Uji Konfigurasi Global ---');
  const globalCfg = getGlobalConfig();
  console.log('  Default Like Rate:', globalCfg.likeRatePerMin);
  console.log('  Default Comment Interval:', globalCfg.commentIntervalSec);
  assert.strictEqual(typeof globalCfg.enableLike, 'boolean');
  assert.strictEqual(typeof globalCfg.enableComment, 'boolean');

  // 3. Uji ShopeeLiveWorker Like & Chat
  console.log('\n--- 3. Uji Worker Interaction Emulation ---');
  const worker = new ShopeeLiveWorker({
    roomId: '88889999',
    account: { id: 'acc-1', name: 'Dewi Lestari', username: 'dewi_lestari88', avatar: 'https://avatar.png' }
  });

  await worker.start();
  assert.strictEqual(worker.state, 'VIEWING');

  let likeEmitted = false;
  worker.on('like', (data) => {
    likeEmitted = true;
    console.log(`  Worker like event: ${data.taps} taps oleh ${data.accountName}`);
    assert.strictEqual(data.taps, 5);
  });
  await worker.sendTapLike(5);
  assert(likeEmitted, 'Event like harus terkirim');
  assert.strictEqual(worker.likesSent, 5);

  let chatEmitted = false;
  worker.on('comment', (data) => {
    chatEmitted = true;
    console.log(`  Worker chat event: [${data.account.name}] "${data.text}"`);
    assert.strictEqual(data.text, 'Spill etalase 1 dong kak');
  });
  await worker.sendComment('Spill etalase 1 dong kak');
  assert(chatEmitted, 'Event comment harus terkirim');
  assert.strictEqual(worker.commentsSent, 1);

  worker.stop();

  // 4. Uji CampaignInstance Auto-Like & Auto-Chat
  console.log('\n--- 4. Uji Campaign Interaction Engine & Per-Sesi Override ---');
  await retentionController.stopCampaign('test_init');

  const cmpMetrics = retentionController.createCampaign({
    name: 'Sesi Uji Interaksi Fashion',
    urlOrRoomId: 'https://live.shopee.co.id/share?session=77776666',
    targetViewers: 5,
    interaction: {
      enableLike: true,
      likeRatePerMin: 180, // Cepat untuk pengujian
      enableComment: true,
      commentIntervalSec: 5,
      commentCategory: 'fashion'
    }
  });

  console.log(`  Sesi dibuat: [${cmpMetrics.name}]`);
  console.log(`  Setelan: Like=${cmpMetrics.interaction.enableLike}, Chat=${cmpMetrics.interaction.enableComment}, Kategori=${cmpMetrics.interaction.commentCategory}`);
  assert.strictEqual(cmpMetrics.interaction.commentCategory, 'fashion');

  // Tunggu worker spawn dan kirim beberapa interaksi otomatis
  console.log('  Menunggu 7 detik mengamati auto-like dan auto-chat...');
  await sleep(7000);

  const activeCmp = retentionController.campaigns.get(cmpMetrics.id);
  console.log(`  Total Likes Terkumpul: ${activeCmp.totalLikes}`);
  console.log(`  Total Komentar Terkumpul: ${activeCmp.totalComments}`);
  assert(activeCmp.totalLikes > 0, 'Auto-like harus menghasilkan like');

  // 5. Uji Instant Action (Chat Instan & Like Instan)
  console.log('\n--- 5. Uji Aksi Instan (Manual Trigger) ---');
  const instantChat = await retentionController.sendInstantComment(cmpMetrics.id, 'Chat manual darurat dari admin!');
  console.log(`  Instant Chat Terkirim: "${instantChat.text}" oleh [${instantChat.sender}]`);
  assert.strictEqual(instantChat.text, 'Chat manual darurat dari admin!');

  const instantLike = retentionController.sendInstantLike(cmpMetrics.id, 50);
  console.log(`  Instant Like Terkirim: ${instantLike.taps} taps. Total sekarang: ${instantLike.totalLikes}`);
  assert.strictEqual(instantLike.taps, 50);

  // 6. Uji Update Setelan Runtime (on-the-fly)
  console.log('\n--- 6. Uji Update Setelan Interaksi Saat Live Berjalan ---');
  const updated = retentionController.updateCampaignInteraction(cmpMetrics.id, {
    enableLike: false,
    commentCategory: 'beauty'
  });
  console.log(`  Status setelah update: Like=${updated.interaction.enableLike}, Kategori=${updated.interaction.commentCategory}`);
  assert.strictEqual(updated.interaction.enableLike, false);
  assert.strictEqual(updated.interaction.commentCategory, 'beauty');

  // 7. Cleanup
  console.log('\n--- 7. Cleanup ---');
  retentionController.stopCampaignById(cmpMetrics.id, 'test_finish');
  await sleep(1000);

  console.log('\n================================================================');
  console.log('✅ SEMUA PENGUJIAN MODUL INTERAKSI & CHAT BERHASIL 100%!');
  console.log('================================================================');
}

runTest().catch(err => {
  console.error('❌ TEST INTERAKSI GAGAL:', err);
  process.exit(1);
});
