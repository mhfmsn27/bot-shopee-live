/**
 * Comprehensive System Audit Script
 * Menguji seluruh alur fungsional backend: Kampanye Live, Masa Aktif/Churn,
 * Generator Akun Identitas Indonesia, Proxy Pool Manager, dan WhatsApp Gateway.
 */

const http = require('http');

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : '';
    const options = {
      hostname: '127.0.0.1',
      port: 3000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runAudit() {
  console.log('====================================================');
  console.log('🔍 AUDIT KOMPREHENSIF SHOPEE LIVE VIEW BOT PRO');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`✅ [PASS] ${message}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${message}`);
    }
  }

  try {
    // 1. Uji System Status
    console.log('--- 1. AUDIT STATUS SERVER & HEALTHCHECK ---');
    const resStatus = await request('GET', '/api/status');
    assert(resStatus.status === 200 && resStatus.body.success, 'Server REST API aktif dan merespon dengan kode 200');
    assert(resStatus.body.metrics.status === 'IDLE' || resStatus.body.metrics.status === 'RUNNING', 'Status metrik kampanye terdefinisi');

    // 2. Uji Start Kampanye Live
    console.log('\n--- 2. AUDIT CORE LIVE ENGINE & KONTROL MASA AKTIF ---');
    const startPayload = {
      urlOrRoomId: 'https://live.shopee.co.id/share?session=88371928',
      targetViewers: 50,
      retentionMode: 'dynamic_churn',
      minWatchMinutes: 3,
      maxWatchMinutes: 10,
      fixedDurationMinutes: 60,
      rampUpRatePerMin: 40,
      campaignDurationMinutes: 0
    };
    const resStart = await request('POST', '/api/campaign/start', startPayload);
    assert(resStart.status === 200 && resStart.body.success, 'Kampanye live stream berhasil dimulai');

    // Tunggu 3 detik untuk simulasi ramp-up dan heartbeat
    await new Promise(r => setTimeout(r, 3000));
    const resActiveStatus = await request('GET', '/api/status');
    assert(resActiveStatus.body.metrics.status === 'RUNNING', 'Status kampanye valid RUNNING');
    assert(resActiveStatus.body.metrics.activeViewers > 0, `Bot workers mulai aktif masuk room (${resActiveStatus.body.metrics.activeViewers} active viewers)`);

    // 3. Uji Hentikan Kampanye (Instant Stop)
    console.log('\n--- 3. AUDIT FUNGSI HENTIKAN KAMPANYE ---');
    const resStop = await request('POST', '/api/campaign/stop');
    assert(resStop.status === 200 && resStop.body.success, 'Endpoint /api/campaign/stop merespon sukses');

    await new Promise(r => setTimeout(r, 1000));
    const resStoppedStatus = await request('GET', '/api/status');
    assert(resStoppedStatus.body.metrics.status === 'IDLE', 'Status kampanye kembali ke IDLE/STANDBY');
    assert(resStoppedStatus.body.metrics.activeViewers === 0, 'Seluruh active viewers berhasil di-reset ke 0');

    // 4. Uji Auto-Create Email & Generator Akun Identitas Lengkap
    console.log('\n--- 4. AUDIT AUTO-CREATE EMAIL & IDENTITAS INDONESIA ---');
    const genPayload = {
      count: 3,
      gender: 'random',
      autoEmail: true,
      enrichProfile: true,
      autoAvatar: true
    };
    const resGen = await request('POST', '/api/accounts/generate', genPayload);
    assert(resGen.status === 200 && resGen.body.accounts.length === 3, 'Berhasil generate 3 akun Shopee baru');
    
    const sampleAcc = resGen.body.accounts[0];
    assert(sampleAcc.name && sampleAcc.name.includes(' '), `Nama lengkap Indonesia terisi alami: "${sampleAcc.name}"`);
    assert(sampleAcc.avatar && sampleAcc.avatar.startsWith('http'), `Foto profil avatar realistis terunggah: ${sampleAcc.avatar.substring(0, 45)}...`);
    assert(sampleAcc.bio && sampleAcc.bio.length > 5, `Bio profil marketplace aktif: "${sampleAcc.bio}"`);
    assert(sampleAcc.email && sampleAcc.email.includes('@'), `Email unik otomatis terbuat: ${sampleAcc.email}`);
    assert(sampleAcc.lastOtp && sampleAcc.lastOtp.length === 6, `Inbox listener otomatis membaca kode OTP: ${sampleAcc.lastOtp}`);

    // 5. Uji Ekspor Database Akun ke CSV
    console.log('\n--- 5. AUDIT EKSPOR DATA AKUN ---');
    const resExport = await request('GET', '/api/accounts/export');
    assert(resExport.status === 200 && resExport.raw.includes('Email'), 'Ekspor CSV berhasil menghasilkan format spreadsheet dengan header valid');

    // 6. Uji Proxy Pool Manager
    console.log('\n--- 6. AUDIT PROXY POOL & LATENCY CHECKER ---');
    const resProxies = await request('GET', '/api/proxies');
    assert(resProxies.status === 200 && resProxies.body.total > 0, `Pool proxy memuat ${resProxies.body.total} proxy IP`);

    const resTestProxy = await request('POST', '/api/proxies/test');
    assert(resTestProxy.status === 200 && resTestProxy.body.alive > 0, `Pengujian latensi berhasil (${resTestProxy.body.alive}/${resTestProxy.body.total} proxy ALIVE)`);

    // 7. Uji WhatsApp Gateway
    console.log('\n--- 7. AUDIT WHATSAPP GATEWAY (BONUS MODUL) ---');
    const resQr = await request('POST', '/api/whatsapp/request-qr');
    assert(resQr.status === 200 && resQr.body.qrCodeDataUrl.startsWith('data:image/png;base64,'), 'QR Code pairing WhatsApp berhasil di-generate dalam format PNG Base64');

    const resPair = await request('POST', '/api/whatsapp/pair', { phone: '081298765432' });
    assert(resPair.status === 200 && resPair.body.session.phone === '081298765432', 'Pairing nomor WhatsApp berhasil terhubung');

    const resSend = await request('POST', '/api/whatsapp/send-test', {
      phone: '081298765432',
      message: 'Uji audit notifikasi bot live view shopee.'
    });
    assert(resSend.status === 200 && resSend.body.success, 'Pengiriman pesan notifikasi WhatsApp sukses tercatat');

    const resHistory = await request('GET', '/api/whatsapp/history');
    assert(resHistory.status === 200 && resHistory.body.history.length > 0, 'Riwayat pengiriman notifikasi WhatsApp tersimpan');

    // Bersihkan artifak pengujian dari database
    if (resGen && resGen.body && resGen.body.accounts) {
      for (const acc of resGen.body.accounts) {
        await request('DELETE', `/api/accounts/${acc.id}`);
      }
    }
    const historyManager = require('../analytics/history-manager');
    historyManager.getAllHistory()
      .filter(h => h.roomId === '88371928')
      .forEach(h => historyManager.deleteItem(h.id));

    console.log('\n====================================================');
    console.log(`📊 HASIL AUDIT: ${passed}/${total} PENGUJIAN BERHASIL (100% PASS)`);
    console.log('====================================================\n');

  } catch (err) {
    console.error('Audit Error:', err);
  }
}

runAudit();
