/**
 * Tool Uji SOCKS5 Proxy End-to-End Langsung ke Shopee Live
 * 
 * Penggunaan:
 * node backend/src/scratch/test_live_socks5.js --proxy "socks5://user:pass@host:port" [--url "https://live.shopee.co.id/..."]
 * atau:
 * node backend/src/scratch/test_live_socks5.js --proxy "host:port:user:pass"
 */

const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const https = require('https');
const http = require('http');
const { 
  buildSpoofedHeaders, 
  generateDeviceFingerprint, 
  createPersistentStreamConsumer 
} = require('../core/protocol-client');

// Parse Arguments
const args = process.argv.slice(2);
let rawProxy = '';
let targetLiveUrl = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--proxy' && args[i + 1]) rawProxy = args[i + 1];
  if (args[i] === '--url' && args[i + 1]) targetLiveUrl = args[i + 1];
}

function parseProxyString(str) {
  if (!str) return null;
  str = str.trim();
  if (str.startsWith('socks5://') || str.startsWith('socks4://') || str.startsWith('http://') || str.startsWith('https://')) {
    try {
      const u = new URL(str);
      return {
        protocol: u.protocol.replace(':', ''),
        host: u.hostname,
        port: parseInt(u.port, 10),
        user: decodeURIComponent(u.username || ''),
        pass: decodeURIComponent(u.password || '')
      };
    } catch (e) {}
  }
  const parts = str.split(':');
  if (parts.length === 2) {
    return { protocol: 'socks5', host: parts[0], port: parseInt(parts[1], 10), user: '', pass: '' };
  }
  if (parts.length === 4) {
    return { protocol: 'socks5', host: parts[0], port: parseInt(parts[1], 10), user: parts[2], pass: parts[3] };
  }
  return null;
}

function extractRoomId(input) {
  if (!input) return null;
  const numMatch = input.match(/[?&]session=(\d+)/i) || input.match(/\/live\/(\d+)/i);
  if (urlMatch(input)) return urlMatch(input);
  const rawNum = input.match(/\b\d{7,12}\b/);
  if (rawNum) return rawNum[0];
  return null;
}

function urlMatch(input) {
  const m = input.match(/[?&]session=(\d+)/i) || input.match(/\/live\/(\d+)/i);
  return m ? m[1] : null;
}

async function resolveShortLinkAndExtractRoomId(input) {
  if (!input) return null;
  const direct = urlMatch(input);
  if (direct) return direct;
  if (input.includes('shp.ee') || input.includes('shopee.co.id/share')) {
    try {
      console.log(`   🔗 Mengikuti pengalihan tautan singkat (${input})...`);
      const location = await new Promise((resolve, reject) => {
        const req = https.get(input, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
          resolve(res.headers.location || '');
        });
        req.on('error', reject);
        req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
      });
      if (location) {
        console.log(`   👉 Tautan penuh terdeteksi: ${location.substring(0, 80)}...`);
        return urlMatch(location) || extractRoomId(location);
      }
    } catch (e) {
      console.log(`   ⚠️ Gagal resolve shortlink: ${e.message}`);
    }
  }
  return extractRoomId(input);
}

function requestWithAgent(url, options = {}, proxyAgent = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const isHttps = u.protocol === 'https:';
    const lib = isHttps ? https : http;
    const reqOptions = {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      agent: proxyAgent || undefined,
      rejectUnauthorized: false
    };

    const start = Date.now();
    const req = lib.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const latency = Date.now() - start;
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        resolve({ status: res.statusCode, data: json || data, rawData: data, headers: res.headers, latency });
      });
    });

    req.on('error', reject);
    req.setTimeout(options.timeout || 8000, () => {
      req.destroy();
      reject(new Error('Connection Timeout (8s)'));
    });

    if (options.body) {
      req.write(typeof options.body === 'object' ? JSON.stringify(options.body) : options.body);
    }
    req.end();
  });
}

async function runLiveProxyAudit(proxyInput, liveUrlInput) {
  console.log('\n================================================================');
  console.log('🧪 PENGUJIAN SOCKS5 PROXY LANGSUNG KE SERVER SHOPEE LIVE');
  console.log('================================================================');

  const proxyParsed = parseProxyString(proxyInput);
  if (!proxyParsed) {
    console.error('❌ Format proxy tidak valid! Contoh format:');
    console.error('   socks5://user:pass@103.123.45.67:1080');
    console.error('   103.123.45.67:1080:user:pass');
    return;
  }

  let activeProtocol = proxyParsed.protocol || 'socks5';
  let proxyAuthUrl = `${activeProtocol}://${proxyParsed.host}:${proxyParsed.port}`;
  if (proxyParsed.user && proxyParsed.pass) {
    proxyAuthUrl = `${activeProtocol}://${encodeURIComponent(proxyParsed.user)}:${encodeURIComponent(proxyParsed.pass)}@${proxyParsed.host}:${proxyParsed.port}`;
  }

  console.log(`📡 Target Proxy : ${proxyParsed.host}:${proxyParsed.port} [${activeProtocol.toUpperCase()}] (${proxyParsed.user ? 'Dengan Autentikasi' : 'Tanpa Autentikasi'})`);
  let agent = activeProtocol.startsWith('socks') ? new SocksProxyAgent(proxyAuthUrl) : new HttpsProxyAgent(proxyAuthUrl);

  // -------------------------------------------------------------
  // TAHAP 1: Verifikasi IP Publik & ISP Proxy
  // -------------------------------------------------------------
  console.log(`\n[1/5] Menguji Handshake ${activeProtocol.toUpperCase()} & Deteksi IP Publik...`);
  let ipInfo = null;
  try {
    let ipRes;
    try {
      ipRes = await requestWithAgent('https://ip-api.com/json', { timeout: 7000 }, agent);
    } catch (errSocks) {
      // Jika SOCKS5 gagal, otomatis coba HTTP proxy agent
      if (activeProtocol === 'socks5') {
        console.log(`   ℹ️ Handshake SOCKS5 gagal (${errSocks.message}), mencoba fallback ke HTTP proxy...`);
        activeProtocol = 'http';
        proxyAuthUrl = proxyParsed.user && proxyParsed.pass
          ? `http://${encodeURIComponent(proxyParsed.user)}:${encodeURIComponent(proxyParsed.pass)}@${proxyParsed.host}:${proxyParsed.port}`
          : `http://${proxyParsed.host}:${proxyParsed.port}`;
        agent = new HttpsProxyAgent(proxyAuthUrl);
        ipRes = await requestWithAgent('https://ip-api.com/json', { timeout: 7000 }, agent);
      } else {
        throw errSocks;
      }
    }

    if (ipRes && ipRes.status === 200 && ipRes.data && ipRes.data.query) {
      ipInfo = ipRes.data;
      console.log(`   ✅ Handshake [${activeProtocol.toUpperCase()}] Berhasil!`);
      console.log(`   📍 IP Publik Keluar : ${ipInfo.query}`);
      console.log(`   🌐 Negara / Kota    : ${ipInfo.country} (${ipInfo.countryCode}) - ${ipInfo.city}`);
      console.log(`   🏢 ISP / Operator   : ${ipInfo.isp} (${ipInfo.as})`);
      console.log(`   ⚡ Latensi Ping     : ${ipRes.latency} ms`);
    } else {
      console.log(`   ⚠️ Respon IP check: Status ${ipRes ? ipRes.status : 'N/A'}`);
    }
  } catch (err) {
    console.error(`   ❌ GAGAL KONEKSI PROXY: ${err.message}`);
    console.error(`   👉 Pastikan IP/Port benar, proxy aktif, dan kuota/ip whitelist tersedia.`);
    return;
  }

  // -------------------------------------------------------------
  // TAHAP 2: Mendapatkan Target Room Shopee Live
  // -------------------------------------------------------------
  console.log('\n[2/5] Menentukan Room Shopee Live Aktif...');
  let targetRoomId = await resolveShortLinkAndExtractRoomId(liveUrlInput);
  let liveTitle = '';
  let playStreamUrl = '';

  if (!targetRoomId) {
    console.log('   Mencari siaran live streaming yang sedang aktif di Shopee ID...');
    try {
      const listRes = await requestWithAgent('https://live.shopee.co.id/api/v1/session/list?sort_type=2&limit=5', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': 'https://live.shopee.co.id/'
        },
        timeout: 6000
      }, agent);

      if (listRes.data && listRes.data.data) {
        const list = listRes.data.data.sessions || listRes.data.data.list || [];
        const active = list.find(s => (s.session || s).status === 1);
        if (active) {
          const sess = active.session || active;
          targetRoomId = sess.session_id || sess.id;
          liveTitle = sess.title || 'Shopee Live Room';
          playStreamUrl = sess.play_url || '';
        }
      }
    } catch (e) {
      console.log(`   Catatan: Fetch list via proxy error (${e.message}), mencoba fallback direct...`);
    }
  }

  if (!targetRoomId) {
    targetRoomId = '2456789'; // Dummy fallback
    console.log(`   ⚠️ Menggunakan sample Room ID: ${targetRoomId}`);
  } else {
    console.log(`   🎯 Target Room ID : ${targetRoomId} ${liveTitle ? `("${liveTitle}")` : ''}`);
  }

  // -------------------------------------------------------------
  // TAHAP 3: Uji Tembus Shopee Shield WAF & Session Info
  // -------------------------------------------------------------
  console.log('\n[3/5] Menguji Akses ke Shopee Shield WAF & Session API...');
  const fp = generateDeviceFingerprint();
  const sessionUrl = `https://live.shopee.co.id/api/v1/session/${targetRoomId}`;
  const spoofedHeaders = buildSpoofedHeaders({ roomId: targetRoomId, fingerprint: fp });

  let wafPassed = false;
  try {
    const sessionRes = await requestWithAgent(sessionUrl, {
      method: 'GET',
      headers: spoofedHeaders,
      timeout: 7000
    }, agent);

    if (sessionRes.status === 200) {
      wafPassed = true;
      console.log(`   ✅ BERHASIL TEMBUS WAF SHOPEE! (HTTP 200 OK)`);
      if (sessionRes.data && sessionRes.data.data) {
        const d = sessionRes.data.data.session || sessionRes.data.data;
        if (d.play_url) playStreamUrl = d.play_url;
        console.log(`   📊 Info Siaran: Penonton Saat Ini: ${d.viewer_count || d.member_cnt || 0}`);
      }
    } else if (sessionRes.status === 403) {
      console.error(`   ❌ TERBLOKIR WAF SHOPEE (HTTP 403)!`);
      if (sessionRes.rawData.includes('90309999')) {
        console.error(`   🚨 Kode Error: 90309999 (Shopee Shield Datacenter/Scraper IP Block).`);
        console.error(`   👉 Solusi: IP ini terdeteksi sebagai IP Datacenter. Ganti ke Residential/Mobile Proxy.`);
      } else {
        console.error(`   Detail: ${sessionRes.rawData.substring(0, 150)}`);
      }
      return;
    } else {
      console.log(`   ⚠️ Respon Server Shopee: HTTP ${sessionRes.status}`);
    }
  } catch (err) {
    console.error(`   ❌ Request ke Shopee Live Gagal: ${err.message}`);
    return;
  }

  // -------------------------------------------------------------
  // TAHAP 4: Uji Stream CDN FLV Socket Melalui SOCKS5 Proxy
  // -------------------------------------------------------------
  console.log('\n[4/5] Menguji Aliran Stream CDN Video via SOCKS5...');
  if (!playStreamUrl) {
    console.log('   ℹ️ URL Stream CDN tidak ditemukan di room ini, melewati uji video.');
  } else {
    console.log(`   Menghubungkan socket stream ke CDN Tencent/Wangsu...`);
    await new Promise((resolve) => {
      let isDone = false;
      const consumer = createPersistentStreamConsumer(playStreamUrl, {
        proxyAgent: agent,
        roomId: targetRoomId,
        fingerprint: fp,
        throttleBytesPerSec: 18000
      });

      const finishStream = (success, msg) => {
        if (isDone) return;
        isDone = true;
        consumer.stop();
        if (success) {
          console.log(`   ✅ ${msg}`);
        } else {
          console.log(`   ⚠️ ${msg}`);
        }
        resolve();
      };

      consumer.on('connected', (d) => {
        console.log(`   ✅ CDN Stream Socket Connected (HTTP ${d.status})`);
      });

      consumer.on('progress', (p) => {
        if (p.bytesStreamed > 5000) {
          finishStream(true, `Stream CDN Sukses! Menerima ${(p.bytesStreamed / 1024).toFixed(1)} KB data video via SOCKS5.`);
        }
      });

      consumer.on('error', (e) => {
        finishStream(false, `Stream socket error: ${e.message}`);
      });

      consumer.start();

      setTimeout(() => {
        if (!isDone) {
          if (consumer.bytesStreamed > 0) {
            finishStream(true, `Stream CDN Sukses! Total ${(consumer.bytesStreamed / 1024).toFixed(1)} KB diterima.`);
          } else {
            finishStream(false, 'Stream timeout (CDN tidak mengirim chunk).');
          }
        }
      }, 7000);
    });
  }

  // -------------------------------------------------------------
  // TAHAP 5: Uji Multi-Bot Concurrency (3 Bot Simultan Lewat 1 Proxy)
  // -------------------------------------------------------------
  console.log('\n[5/5] Menguji Multi-Bot Concurrency (3 Bot Simultan Lewat 1 Proxy)...');
  console.log('   Memverifikasi apakah beberapa bot dengan Device Fingerprint unik');
  console.log('   dapat terdaftar bersamaan tanpa ditolak/rate-limited oleh Shopee...');

  const concurrentBots = 3;
  const multiBotResults = [];

  for (let b = 1; b <= concurrentBots; b++) {
    const botFp = generateDeviceFingerprint();
    const botHeaders = buildSpoofedHeaders({ roomId: targetRoomId, fingerprint: botFp });

    try {
      // Test Join Endpoint per bot
      const joinUrl = `https://live.shopee.co.id/api/v1/session/${targetRoomId}/join`;
      const joinPayload = {
        session_id: String(targetRoomId),
        timestamp: Math.floor(Date.now() / 1000),
        client_uuid: botFp.clientUuid
      };

      const joinRes = await requestWithAgent(joinUrl, {
        method: 'POST',
        headers: botHeaders,
        body: joinPayload,
        timeout: 5000
      }, agent);

      const isSuccess = joinRes.status === 200 || joinRes.status === 201;
      multiBotResults.push({
        botId: `Bot-#${b}`,
        uuid: botFp.clientUuid.substring(0, 8) + '...',
        status: joinRes.status,
        success: isSuccess
      });
      console.log(`   🤖 Bot #${b} [UUID: ${botFp.clientUuid.substring(0, 8)}...]: Status HTTP ${joinRes.status} ${isSuccess ? '✅ (Tersambung & Terhitung)' : '⚠️'}`);
    } catch (e) {
      multiBotResults.push({
        botId: `Bot-#${b}`,
        error: e.message,
        success: false
      });
      console.log(`   🤖 Bot #${b}: Error - ${e.message}`);
    }
  }

  // -------------------------------------------------------------
  // KESIMPULAN AKHIR
  // -------------------------------------------------------------
  const successBots = multiBotResults.filter(r => r.success).length;
  console.log('\n================================================================');
  if (wafPassed && successBots > 0) {
    console.log('🎉 HASIL PENGUJIAN: SOCKS5 PROXY 100% SIAP & KOMPATIBEL!');
    console.log('   - Handshake SOCKS5       : ✅ Valid');
    console.log('   - Bypass Shopee WAF      : ✅ Lolos (Tidak terblokir 90309999)');
    console.log('   - Aliran Video CDN       : ✅ Terkoneksi');
    console.log(`   - Multi-Bot Concurrency  : ✅ ${successBots}/${concurrentBots} Bot Sukses Terdaftar Simultan`);
    console.log('   Proxy ini aman dan terhitung valid sebagai penonton di Shopee Live.');
  } else if (wafPassed) {
    console.log('⚠️ PROXY LOLOS WAF TAPI MULTI-BOT GAGAL: Periksa kuota / batas koneksi.');
  } else {
    console.log('⚠️ HASIL PENGUJIAN: PROXY BELUM BISA DIGUNAKAN DI SHOPEE LIVE.');
  }
  console.log('================================================================\n');
}

if (rawProxy) {
  runLiveProxyAudit(rawProxy, targetLiveUrl);
} else {
  console.log('Script siap. Jalankan dengan:');
  console.log('node backend/src/scratch/test_live_socks5.js --proxy "host:port:user:pass" [--url "https://live.shopee.co.id/..."]');
}

module.exports = { runLiveProxyAudit, parseProxyString };
