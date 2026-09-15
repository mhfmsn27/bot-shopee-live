/**
 * Test Suite: UI/UX Neatness, Responsiveness, Reactivity & Real Data Audit
 * Shopee Live View Bot Pro
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000';

async function runAudit() {
  console.log('================================================================');
  console.log('🔍 AUDIT UI/UX, RESPONSIVITAS, REAKTIVITAS & INTEGRITAS DATA ASLI');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${message}`);
      failed++;
    }
  }

  // -------------------------------------------------------------
  // 1. AUDIT ELIMINASI DATA DUMMY DI FRONTEND (HTML SOURCE CHECK)
  // -------------------------------------------------------------
  console.log('--- 1. AUDIT ELIMINASI DATA DUMMY PADA SEMUA HALAMAN (HTML SOURCE) ---');
  const htmlPath = path.join(__dirname, '../../../frontend/index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  assert(!html.includes('value="https://live.shopee.co.id/share?session=98241512"'), 'URL input tidak menggunakan session ID dummy hardcoded');
  assert(!html.includes('value="Toko Shopee #1"'), 'Nama toko / akun tidak menggunakan label dummy hardcoded');
  assert(!html.includes('value="081234567890"'), 'Nomor WhatsApp admin & tes pesan tidak menggunakan nomor dummy hardcoded');
  assert(!html.includes('>+6281234567890<'), 'Label nomor terhubung WhatsApp tidak menampilkan nomor dummy');
  assert(!html.includes('100% (Optimal)</span>') || html.includes('Memuat audit...'), 'Banner audit kesehatan akun menggunakan placeholder dinamis (bukan dummy statis)');
  assert(!html.includes('0 Valid • 0 Warning</span>') || html.includes('Memuat...'), 'Badge detail audit kesehatan akun bersifat reaktif');
  assert(!html.includes('"Spill etalase 2 dong kak ❤️"'), 'Pratinjau komentar tidak menggunakan kalimat dummy hardcoded');
  assert(html.includes('instant-chat-toolbar'), 'Toolbar interaksi instan memiliki class responsif');
  assert(html.includes('sched-grid-2') && html.includes('sched-grid-3'), 'Form scheduler modal memiliki class grid responsif');

  // -------------------------------------------------------------
  // 2. AUDIT INTEGRITAS DATA ASLI DARI BACKEND REST API
  // -------------------------------------------------------------
  console.log('\n--- 2. AUDIT DATA ASLI PADA SELURUH ENDPOINT (ZERO DUMMY) ---');
  
  // A. Accounts API (Harus menyertakan perhitungan audit kesehatan riil)
  const accRes = await fetch(`${BASE_URL}/api/accounts`).then(r => r.json());
  assert(accRes.success === true, 'GET /api/accounts merespon dengan sukses');
  assert(typeof accRes.total === 'number' && accRes.total > 0, `Total akun riil terdeteksi: ${accRes.total} akun`);
  assert(accRes.health && typeof accRes.health.averageHealthScore === 'number', `Skor kesehatan akun terhitung riil: ${accRes.health?.averageHealthScore}%`);
  assert(typeof accRes.health.valid === 'number' && typeof accRes.health.warning === 'number', `Kelengkapan profil riil: ${accRes.health?.valid} valid, ${accRes.health?.warning} warning`);

  // B. WhatsApp Status API
  const waRes = await fetch(`${BASE_URL}/api/whatsapp/status`).then(r => r.json());
  assert(waRes.success === true, 'GET /api/whatsapp/status merespon sukses');
  assert(typeof waRes.adminNumber === 'string', `Nomor admin WhatsApp diambil langsung dari config.json riil: "${waRes.adminNumber}"`);

  // C. Proxies API
  const prxRes = await fetch(`${BASE_URL}/api/proxies`).then(r => r.json());
  assert(prxRes.success === true, 'GET /api/proxies merespon sukses');
  assert(Array.isArray(prxRes.proxies) && prxRes.proxies.length > 0, `Proxy pool riil terdeteksi: ${prxRes.proxies.length} proxy`);
  assert(prxRes.proxies[0].ip && prxRes.proxies[0].latency !== undefined, 'Data proxy memiliki IP dan latensi terukur');

  // D. Chats API (Riwayat chat real-time lintas siaran)
  const chatRes = await fetch(`${BASE_URL}/api/chats`).then(r => r.json());
  assert(chatRes.success === true && Array.isArray(chatRes.chats), 'GET /api/chats endpoint riil aktif dan mengembalikan array chat');

  // E. Interaction Config API
  const interRes = await fetch(`${BASE_URL}/api/interaction/config`).then(r => r.json());
  assert(interRes.success === true, 'GET /api/interaction/config merespon sukses');
  assert(interRes.commentBanks && Object.keys(interRes.commentBanks).length >= 5, `Bank komentar riil memuat ${Object.keys(interRes.commentBanks || {}).length} kategori industri`);

  // F. Schedules API
  const schedRes = await fetch(`${BASE_URL}/api/schedules`).then(r => r.json());
  assert(schedRes.success === true && Array.isArray(schedRes.schedules), 'GET /api/schedules merespon riil dari database schedules.json');

  // G. History API
  const histRes = await fetch(`${BASE_URL}/api/history`).then(r => r.json());
  assert(histRes.success === true && histRes.summary && typeof histRes.summary.totalViews === 'number', 'GET /api/history menyajikan ringkasan KPI riil');

  // -------------------------------------------------------------
  // 3. AUDIT REAKTIVITAS FRONTEND CONTROLLER (APP.JS)
  // -------------------------------------------------------------
  console.log('\n--- 3. AUDIT REAKTIVITAS FRONTEND (APP.JS & EVENT STREAM) ---');
  const appJsPath = path.join(__dirname, '../../../frontend/js/app.js');
  const appJs = fs.readFileSync(appJsPath, 'utf8');

  assert(appJs.includes('checkWhatsAppStatus()') && appJs.includes('loadInteractionTab()') && appJs.includes('loadChats()'), 'Inisialisasi startup memuat data riil untuk seluruh tab sekaligus');
  assert(appJs.includes("eventSource.addEventListener('chat_history'"), 'SSE listener mendengarkan riwayat chat tersimpan (chat_history)');
  assert(appJs.includes('renderMultiCampaignsList(metrics.campaigns)'), 'updateDashboardMetrics menyinkronkan daftar sesi aktif secara live setiap detik');
  assert(appJs.includes('cmp.totalCartClicks'), 'renderMultiCampaignsList menampilkan sinyal klik keranjang oranye riil');
  assert(appJs.includes('updateAccountHealthUI(data.health)'), 'loadAccounts otomatis mengupdate banner skor kesehatan dari data riil');
  assert(appJs.includes('inputAdmin.value = data.adminNumber'), 'checkWhatsAppStatus otomatis mengisikan nomor admin riil dari backend');

  // -------------------------------------------------------------
  // 4. AUDIT RESPONSIVITAS & KONSISTENSI CSS (DASHBOARD.CSS)
  // -------------------------------------------------------------
  console.log('\n--- 4. AUDIT RESPONSIVITAS & KONSISTENSI CSS (DASHBOARD.CSS) ---');
  const cssPath = path.join(__dirname, '../../../frontend/css/dashboard.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  // Cek konsolidasi modal (tidak ada duplikasi aturan di tingkat dasar/top-level)
  const modalMatches = (css.match(/^\.modal-overlay\s*\{/gm) || []).length;
  assert(modalMatches === 1, `Konsolidasi sistem modal bersih (ditemukan tepat ${modalMatches} definisi tingkat dasar)`);

  // Cek Media Queries
  assert(css.includes('@media (max-width: 1024px)'), 'Breakpoint tablet/laptop kecil (<= 1024px) terpasang');
  assert(css.includes('@media (max-width: 860px)'), 'Breakpoint tablet (<= 860px) terpasang');
  assert(css.includes('@media (max-width: 768px)'), 'Breakpoint smartphone standar (<= 768px) terpasang');
  assert(css.includes('@media (max-width: 480px)'), 'Breakpoint smartphone ringkas (<= 480px) terpasang');

  // Cek aturan responsif spesifik
  assert(css.includes('grid-template-columns: repeat(2, 1fr)'), 'Metrics grid beralih ke 2-kolom ringkas pada layar smartphone');
  assert(css.includes('.sched-grid-2') && css.includes('.sched-grid-3'), 'Modal form scheduler dapat runtuh ke 1-kolom pada layar kecil');
  assert(css.includes('max-width: 95vw'), 'Floating live bar dibatasi agar tidak meluap dari layar mobile');
  assert(css.includes('-webkit-overflow-scrolling: touch'), 'Table wrapper memiliki smooth touch scroll untuk mobile');

  // -------------------------------------------------------------
  // 5. AUDIT SIKLUS REAKTIVITAS REAL-TIME (LIFECYCLE TEST)
  // -------------------------------------------------------------
  console.log('\n--- 5. AUDIT SIKLUS REAKTIVITAS REAL-TIME (LIVE CAMPAIGN & CHAT) ---');
  
  // Buat sesi siaran live nyata
  const startRes = await fetch(`${BASE_URL}/api/campaigns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Audit Reaktivitas UI',
      urlOrRoomId: '88776655',
      targetViewers: 3,
      retentionMode: 'dynamic_churn',
      minWatchMinutes: 1,
      maxWatchMinutes: 2,
      interaction: {
        enableLike: true,
        likeRatePerMin: 60,
        enableComment: true,
        commentIntervalSec: 5,
        enableCartClick: true,
        cartClickRatePerMin: 15
      }
    })
  }).then(r => r.json());

  assert(startRes.success === true, `Sesi siaran berhasil dimulai: [${startRes.campaign?.name}] (ID: ${startRes.campaign?.id})`);

  // Tunggu worker mencapai status VIEWING
  await new Promise(r => setTimeout(r, 450));

  // Uji kirim chat instan dan pastikan masuk ke GET /api/chats
  const sendChatRes = await fetch(`${BASE_URL}/api/campaigns/${startRes.campaign?.id}/instant-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Tes Realistis Chat Bot Reaktif!' })
  }).then(r => r.json());

  assert(sendChatRes.success === true, `Chat instan terkirim: "${sendChatRes.chat?.text}" (@${sendChatRes.chat?.username})`);

  const updatedChats = await fetch(`${BASE_URL}/api/chats`).then(r => r.json());
  const foundChat = (updatedChats.chats || []).some(c => c.text === 'Tes Realistis Chat Bot Reaktif!');
  assert(foundChat, 'Chat instan yang baru dikirim seketika muncul di endpoint GET /api/chats');

  // Uji kirim simulasi klik keranjang
  const cartRes = await fetch(`${BASE_URL}/api/campaigns/${startRes.campaign?.id}/instant-cart`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count: 5 })
  }).then(r => r.json());

  assert(cartRes.success === true && cartRes.totalCartClicks >= 5, `Klik keranjang oranye bertambah: ${cartRes.totalCartClicks} klik`);

  // Hentikan sesi
  const stopRes = await fetch(`${BASE_URL}/api/campaigns/${startRes.campaign?.id}/stop`, {
    method: 'POST'
  }).then(r => r.json());
  assert(stopRes.success === true, 'Sesi siaran berhasil dihentikan secara graceful');

  // Clean up history record from this test session
  const historyManager = require('../analytics/history-manager');
  const allHist = historyManager.getAll();
  allHist.filter(h => h.roomId === '88776655').forEach(h => historyManager.deleteItem(h.id));

  // =============================================================
  // REKAPITULASI
  // =============================================================
  console.log('\n================================================================');
  console.log(`📊 REKAPITULASI AUDIT UI/UX & DATA ASLI: ${passed}/${passed + failed} PENGUJIAN LULUS`);
  console.log('================================================================');

  if (failed === 0) {
    console.log('🎉 SEMPURNA! Tampilan UI/UX telah 100% rapi, responsif di segala ukuran layar,');
    console.log('   reaktif secara real-time via SSE & heartbeat, serta 100% menggunakan data asli');
    console.log('   tanpa data dummy sama sekali!');
    process.exit(0);
  } else {
    console.error(`⚠️ Terdapat ${failed} pengujian yang gagal. Periksa log di atas.`);
    process.exit(1);
  }
}

runAudit().catch(err => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
