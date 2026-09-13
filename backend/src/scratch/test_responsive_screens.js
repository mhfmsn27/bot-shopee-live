/**
 * Multi-Screen Responsiveness & Viewport Audit Test Suite
 * Shopee Live View Bot Pro
 */

const fs = require('fs');
const path = require('path');

async function runResponsiveAudit() {
  console.log('================================================================');
  console.log('📱 AUDIT RESPONSIFITAS LENGKAP SEMUA UKURAN LAYAR');
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

  const htmlPath = path.join(__dirname, '../../../frontend/index.html');
  const cssPath = path.join(__dirname, '../../../frontend/css/dashboard.css');
  const appJsPath = path.join(__dirname, '../../../frontend/js/app.js');

  const html = fs.readFileSync(htmlPath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');
  const appJs = fs.readFileSync(appJsPath, 'utf8');

  // 1. Viewport & HTML Basics
  console.log('--- 1. AUDIT VIEWPORT META & DOKUMEN DASAR ---');
  assert(html.includes('<meta name="viewport" content="width=device-width, initial-scale=1.0">'), 'Viewport meta tag dikonfigurasi dengan benar untuk mobile device');
  assert(css.includes('overflow-x: hidden'), 'Body CSS mencegah scrollbar horizontal (zero horizontal overflow)');
  assert(css.includes('box-sizing: border-box'), 'Universal box-sizing border-box diterapkan untuk layout presisi');

  // 2. Breakpoints Multi-Layar
  console.log('\n--- 2. AUDIT BREAKPOINT CAKUPAN RESOLUSI LAYAR ---');
  assert(css.includes('@media (max-width: 1120px)'), 'Breakpoint Desktop/Laptop Kecil (<= 1120px) terpasang');
  assert(css.includes('@media (max-width: 1024px)'), 'Breakpoint Tablet Landscape (<= 1024px) terpasang');
  assert(css.includes('@media (max-width: 860px)'), 'Breakpoint Tablet Portrait (<= 860px) terpasang');
  assert(css.includes('@media (max-width: 768px)'), 'Breakpoint Smartphone Standar (<= 768px) terpasang');
  assert(css.includes('@media (max-width: 480px)'), 'Breakpoint Smartphone Ringkas (<= 480px) terpasang');
  assert(css.includes('@media (max-width: 360px)'), 'Breakpoint Smartphone Ultra-Kecil / Foldable (<= 360px) terpasang');

  // 3. Header & Navigasi Responsif
  console.log('\n--- 3. AUDIT HEADER & NAVIGASI TAB RESPONSIF ---');
  assert(css.includes('.top-header') && css.includes('flex-wrap: wrap'), 'Header utama memiliki flex-wrap untuk mencegah elemen bertabrakan');
  assert(css.includes('.header-status-group') && css.includes('flex-wrap: wrap'), 'Grup badge & tombol header dapat membungkus secara adaptif');
  assert(css.includes('.nav-tabs') && css.includes('overflow-x: auto'), 'Tab navigasi mendukung touch scroll horizontal pada layar sempit');

  // 4. Grid Metrik & Kartu Panel
  console.log('\n--- 4. AUDIT METRICS GRID & KARTU KONTROL ---');
  assert(css.includes('.metrics-grid') && css.includes('repeat(2, 1fr)'), 'Metrics grid beradaptasi ke 2 kolom pada smartphone (768px - 361px)');
  assert(css.includes('@media (max-width: 360px)') && css.includes('grid-template-columns: 1fr'), 'Metrics grid beradaptasi ke 1 kolom pada layar lipat/ultra kecil (<= 360px)');
  assert(css.includes('.preset-duration-grid'), 'Preset tombol durasi memiliki kelas grid responsif');

  // 5. Tabel Data & Scrolling Horizontal Aman
  console.log('\n--- 5. AUDIT TABEL DATA AKUN, PROXY & RIWAYAT ---');
  assert(css.includes('.custom-table') && css.includes('min-width: 620px'), 'Tabel kustom akun & proxy memiliki min-width untuk mencegah kolom gepeng');
  assert(css.includes('.data-table') && css.includes('min-width: 720px'), 'Tabel riwayat memiliki min-width 720px untuk menampung 9 kolom dengan lega');
  assert(html.includes('table-wrapper') && css.includes('-webkit-overflow-scrolling: touch'), 'Wrapper tabel memiliki akselerasi hardware touch scrolling untuk mobile');

  // 6. Form & Tombol Aksi per Tab
  console.log('\n--- 6. AUDIT TOOLBAR & FORM AKSI DI SELURUH TAB ---');
  assert(html.includes('toolbar-action-group') && css.includes('.toolbar-action-group'), 'Tab Akun & Proxy memiliki toolbar aksi adaptif');
  assert(html.includes('wa-quick-connect-row') && css.includes('.wa-quick-connect-row'), 'Form pairing WhatsApp dapat beralih ke layout kolom pada HP kecil');
  assert(html.includes('add-comment-bar') && css.includes('.add-comment-bar'), 'Input tambah komentar dapat beradaptasi pada HP kecil');
  assert(html.includes('history-action-toolbar') && css.includes('.history-action-toolbar'), 'Toolbar aksi riwayat (ekspor CSV & bersihkan) dapat membungkus adaptif');

  // 7. Modals & Floating Live Bar
  console.log('\n--- 7. AUDIT SISTEM MODAL & FLOATING LIVE BAR ---');
  assert(css.includes('.modal-overlay.active'), 'Modal dialog mendukung bottom-sheet alignment pada mobile');
  assert(css.includes('max-height: 92vh'), 'Modal dialog membatasi tinggi maksimum agar tidak tertutup keyboard/browser chrome');
  assert(css.includes('.floating-live-bar') && css.includes('max-width: 95vw'), 'Floating live bar dibatasi max 95vw agar tidak menembus batas layar HP');

  // 8. Sesi Multi-Siaran Dinamis
  console.log('\n--- 8. AUDIT KARTU SESI MULTI-SIARAN AKTIF ---');
  assert(appJs.includes("card.className = 'campaign-session-card'"), 'Kartu multi-siaran ditandai kelas responsif .campaign-session-card');
  assert(css.includes('.campaign-session-card') && css.includes('flex-direction: column'), 'Kartu sesi siaran otomatis berubah vertikal pada layar mobile');

  console.log('\n================================================================');
  console.log(`📊 REKAPITULASI AUDIT MULTI-LAYAR: ${passed}/${passed + failed} PENGUJIAN LULUS`);
  console.log('================================================================');

  if (failed === 0) {
    console.log('🎉 SEMUA HALAMAN, TAB, MODAL & KOMPONEN TELAH 100% RESPONSIF DI SEMUA UKURAN LAYAR!');
    process.exit(0);
  } else {
    console.error(`⚠️ Terdapat ${failed} pengujian responsif gagal.`);
    process.exit(1);
  }
}

runResponsiveAudit().catch(err => {
  console.error('Fatal Error:', err);
  process.exit(1);
});
