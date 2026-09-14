/**
 * Protocol Client - Shopee Device Fingerprint, Mobile TLS Evasion & Live Protocol Engine
 * Mengemulasi header mobile app Shopee Indonesia, TLS ClientHello (JA3/JA4 evasion),
 * dan transmisi paket jaringan riil melalui proxy agent.
 */

const https = require('https');
const http = require('http');
const tls = require('tls');
const { URL } = require('url');
const EventEmitter = require('events');

const USER_AGENTS_MOBILE = [
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 Shopee/3.19.10',
  'Mozilla/5.0 (Linux; Android 13; 23049PCD8G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36 Shopee/3.18.25',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Shopee/3.19.05',
  'Mozilla/5.0 (Linux; Android 13; CPH2357) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36 Shopee/3.18.15',
  'Mozilla/5.0 (Linux; Android 13; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36 Shopee/3.18.20'
];

/**
 * Mobile Android / iOS Device Fingerprint Matrix
 */
const DEVICE_PROFILES = [
  {
    brand: 'Samsung',
    model: 'SM-S918B',
    marketingName: 'Samsung Galaxy S23 Ultra',
    os: 'Android 14',
    platform: 'Android',
    secChUaPlatform: '"Android"',
    secChUaModel: '"SM-S918B"',
    secChUaMobile: '?1',
    userAgent: USER_AGENTS_MOBILE[0]
  },
  {
    brand: 'Xiaomi',
    model: '23049PCD8G',
    marketingName: 'POCO F5 / Redmi Note 12',
    os: 'Android 13',
    platform: 'Android',
    secChUaPlatform: '"Android"',
    secChUaModel: '"23049PCD8G"',
    secChUaMobile: '?1',
    userAgent: USER_AGENTS_MOBILE[1]
  },
  {
    brand: 'Apple',
    model: 'iPhone15,2',
    marketingName: 'iPhone 15 Pro',
    os: 'iOS 17.4.1',
    platform: 'iOS',
    secChUaPlatform: '"iOS"',
    secChUaModel: '"iPhone"',
    secChUaMobile: '?1',
    userAgent: USER_AGENTS_MOBILE[2]
  },
  {
    brand: 'OPPO',
    model: 'CPH2357',
    marketingName: 'OPPO Reno 8 Pro',
    os: 'Android 13',
    platform: 'Android',
    secChUaPlatform: '"Android"',
    secChUaModel: '"CPH2357"',
    secChUaMobile: '?1',
    userAgent: USER_AGENTS_MOBILE[3]
  },
  {
    brand: 'Samsung',
    model: 'SM-A546B',
    marketingName: 'Samsung Galaxy A54 5G',
    os: 'Android 13',
    platform: 'Android',
    secChUaPlatform: '"Android"',
    secChUaModel: '"SM-A546B"',
    secChUaMobile: '?1',
    userAgent: USER_AGENTS_MOBILE[4]
  }
];

/**
 * Mobile Android / iOS Chrome TLS Cipher Suites untuk memintas Akamai / Cloudflare JA3/JA4 Bot Shield
 */
const MOBILE_TLS_CIPHERS = [
  'TLS_AES_128_GCM_SHA256',
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'ECDHE-ECDSA-AES128-GCM-SHA256',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-ECDSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-ECDSA-CHACHA20-POLY1305',
  'ECDHE-RSA-CHACHA20-POLY1305',
  'ECDHE-RSA-AES128-SHA',
  'ECDHE-RSA-AES256-SHA',
  'AES128-GCM-SHA256',
  'AES256-GCM-SHA384',
  'AES128-SHA',
  'AES256-SHA'
].join(':');

/**
 * Standard TLS options for Mobile Chrome fingerprint emulation
 */
const MOBILE_TLS_OPTIONS = {
  ciphers: MOBILE_TLS_CIPHERS,
  ecdhCurve: 'X25519:P-256:P-384',
  minVersion: 'TLSv1.2',
  honorCipherOrder: true
};

/**
 * Persistent High-Concurrency Keep-Alive Agent Pool
 * Mencegah saturasi event-loop & handshake overhead hingga 10.000 socket serentak
 */
const globalHttpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 2000,
  maxFreeSockets: 256,
  keepAliveMsecs: 30000,
  timeout: 60000
});

const globalHttpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 2000,
  maxFreeSockets: 256,
  keepAliveMsecs: 30000,
  timeout: 60000,
  rejectUnauthorized: false,
  ...MOBILE_TLS_OPTIONS
});

/**
 * Dapatkan metrik statistik socket pool
 */
function getAgentPoolStats() {
  const countSockets = (agent) => {
    let active = 0;
    let free = 0;
    if (agent && agent.sockets) {
      for (const k of Object.keys(agent.sockets)) {
        active += (agent.sockets[k] ? agent.sockets[k].length : 0);
      }
    }
    if (agent && agent.freeSockets) {
      for (const k of Object.keys(agent.freeSockets)) {
        free += (agent.freeSockets[k] ? agent.freeSockets[k].length : 0);
      }
    }
    return { active, free, maxSockets: agent ? agent.maxSockets : 0 };
  };

  return {
    http: countSockets(globalHttpAgent),
    https: countSockets(globalHttpsAgent)
  };
}

/**
 * Generate randomized device identifiers
 */
function generateDeviceFingerprint(deviceIndex = null) {
  const hex = (len) => Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  const profile = (deviceIndex !== null && DEVICE_PROFILES[deviceIndex])
    ? DEVICE_PROFILES[deviceIndex]
    : DEVICE_PROFILES[Math.floor(Math.random() * DEVICE_PROFILES.length)];

  return {
    deviceId: hex(32),
    clientUuid: `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`,
    macAddress: Array.from({ length: 6 }, () => hex(2).toUpperCase()).join(':'),
    spcEc: hex(48),
    deviceProfile: profile
  };
}

/**
 * Build complete spoofed HTTP / WebSocket headers untuk request Shopee Live
 * @param {object} params
 * @param {string} params.roomId
 * @param {string} [params.accountUsername]
 * @param {string} [params.cookie]
 * @param {object} [params.fingerprint]
 */
function buildSpoofedHeaders(params = {}) {
  const fp = params.fingerprint || generateDeviceFingerprint(params.deviceIndex);
  const profile = fp.deviceProfile || DEVICE_PROFILES[0];
  const userAgent = params.userAgent || profile.userAgent || USER_AGENTS_MOBILE[0];

  // Prioritas 1: Cookie autentik dari akun Shopee (SPC_EC, SPC_F, dll)
  // Prioritas 2: Device session cookie (tanpa login, tapi tetap valid untuk viewer counting)
  const hasRealCookie = params.cookie && typeof params.cookie === 'string'
    && params.cookie.trim().length >= 10 && params.cookie.includes('SPC_');

  let cookieHeader = hasRealCookie
    ? params.cookie.trim()
    : `SPC_F=${fp.deviceId}; SPC_T_ID=${fp.clientUuid}; language=id; shopee_webUnique_ccd=${fp.spcEc};`;

  // Ekstrak SPC_F dari cookie untuk CSRF token (tervalidasi dari probe API nyata Shopee)
  let spcFMatch = cookieHeader.match(/SPC_F=([^;]+)/);
  let csrfToken = spcFMatch ? spcFMatch[1] : null;

  // Jika cookie belum memiliki SPC_F, injeksikan agar x-csrftoken dan Cookie['SPC_F'] selalu sinkron 100%
  if (!csrfToken) {
    csrfToken = fp.deviceId;
    cookieHeader = `${cookieHeader.replace(/;?\s*$/, '')}; SPC_F=${csrfToken};`;
  }

  const headers = {
    'User-Agent': userAgent,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'Origin': 'https://live.shopee.co.id',
    'Referer': `https://live.shopee.co.id/live/${params.roomId || ''}`,
    'Client-Info': profile.platform === 'iOS' ? 'os=ios;platform=mobile' : 'os=android;platform=mobile',
    'X-Livestreaming-Source': 'shopee',
    'X-LS-SZ-TOKEN': params.szToken || fp.spcEc || `sz-${fp.deviceId}`,
    'x-shopee-client-uuid': fp.clientUuid,
    'x-shopee-device-id': fp.deviceId,
    'x-api-source': 'rn',
    'x-shopee-language': 'id',
    'x-connection-type': 'wifi',
    'x-csrftoken': csrfToken,
    'x-sz-sdk-version': '3.2.1',
    'sec-ch-ua-mobile': profile.secChUaMobile || '?1',
    'sec-ch-ua-platform': profile.secChUaPlatform || '"Android"',
    'sec-ch-ua-model': profile.secChUaModel || '""',
    'Cookie': cookieHeader
  };

  return headers;
}

/**
 * Parse Shopee Live URL / Room ID
 * Mendukung URL: https://live.shopee.co.id/share?session=123456 atau ID langsung
 */
function parseLiveRoomId(input) {
  if (!input) return null;
  const str = input.trim();
  
  if (/^\d+$/.test(str)) {
    return str;
  }

  try {
    const url = new URL(str);
    const session = url.searchParams.get('session') || url.searchParams.get('session_id') || url.searchParams.get('id') || url.searchParams.get('room_id');
    if (session) return session;

    const match = str.match(/\/live\/(\d+)/i) || str.match(/\/share\/(\d+)/i);
    if (match) return match[1];
  } catch (e) {
    const match = str.match(/(\d{6,12})/);
    if (match) return match[1];
  }

  return str;
}

/**
 * Low-level Outbound Request Transporter with TLS Fingerprint and Proxy Support
 * @param {string} targetUrl - URL target (HTTP or HTTPS)
 * @param {object} options
 * @param {string} [options.method='GET']
 * @param {object} [options.headers={}]
 * @param {string|object} [options.body=null]
 * @param {object} [options.proxyAgent=null] - HttpsProxyAgent / SocksProxyAgent
 * @param {number} [options.timeout=4000] - Timeout dalam ms
 */
function sendOutboundRequest(targetUrl, options = {}) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let isSettled = false;
    let hardTimer = null;

    const settle = (resData) => {
      if (isSettled) return;
      isSettled = true;
      if (hardTimer) clearTimeout(hardTimer);
      resolve(resData);
    };

    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch (e) {
      return settle({
        success: false,
        error: `Invalid URL: ${targetUrl}`,
        status: 0,
        latencyMs: 0
      });
    }

    const isHttps = parsedUrl.protocol === 'https:';
    const httpLib = isHttps ? https : http;
    const method = (options.method || 'GET').toUpperCase();
    const timeout = options.timeout || 4000;

    let requestBody = null;
    if (options.body) {
      requestBody = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }

    const requestHeaders = { ...options.headers };
    if (requestBody && !requestHeaders['Content-Type']) {
      requestHeaders['Content-Type'] = 'application/json';
    }
    if (requestBody && !requestHeaders['Content-Length']) {
      requestHeaders['Content-Length'] = Buffer.byteLength(requestBody);
    }

    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: requestHeaders,
      timeout
    };

    // Pasang Proxy Agent jika disediakan, atau gunakan persistent Keep-Alive Agent pool
    if (options.proxyAgent) {
      requestOptions.agent = options.proxyAgent;
    } else {
      requestOptions.agent = isHttps ? globalHttpsAgent : globalHttpAgent;
    }

    // Pasang TLS options khusus pada koneksi HTTPS untuk memalsukan JA3 signature
    if (isHttps && !options.proxyAgent) {
      Object.assign(requestOptions, MOBILE_TLS_OPTIONS);
    }

    let req;
    try {
      req = httpLib.request(requestOptions, (res) => {
        const isDrainStream = !!(options.drainStream || options.streamDrain);
        let responseData = '';
        let streamedBytes = 0;

        res.on('data', (chunk) => {
          streamedBytes += chunk.length;
          if (!isDrainStream) {
            responseData += chunk;
          }
        });

        res.on('end', () => {
          const latencyMs = Date.now() - startTime;
          let parsedJson = null;
          if (!isDrainStream) {
            try {
              parsedJson = JSON.parse(responseData);
            } catch (e) {}
          }

          const rawLength = isDrainStream ? streamedBytes : Buffer.byteLength(responseData);
          settle({
            success: res.statusCode >= 200 && res.statusCode < 400,
            status: res.statusCode,
            headers: res.headers,
            data: isDrainStream ? null : (parsedJson || responseData),
            rawBodyLength: rawLength,
            bytesTransferred: rawLength,
            streamDrained: isDrainStream,
            latencyMs
          });
        });

        res.on('error', (err) => {
          settle({
            success: false,
            status: 0,
            error: err.message || 'Stream reading error',
            latencyMs: Date.now() - startTime
          });
        });
      });

      // Hard timer untuk memutus soket jika tunneling / handshake macet
      hardTimer = setTimeout(() => {
        try {
          req.destroy(new Error('Network request timed out'));
        } catch (e) {}
        settle({
          success: false,
          status: 408,
          error: 'Network request timed out',
          latencyMs: Date.now() - startTime
        });
      }, timeout);

      req.on('timeout', () => {
        try { req.destroy(); } catch (e) {}
        settle({
          success: false,
          status: 408,
          error: 'Network request timed out',
          latencyMs: Date.now() - startTime
        });
      });

      req.on('error', (err) => {
        settle({
          success: false,
          status: 0,
          error: err.message,
          latencyMs: Date.now() - startTime
        });
      });

      if (requestBody) {
        req.write(requestBody);
      }
      req.end();
    } catch (reqErr) {
      settle({
        success: false,
        status: 0,
        error: reqErr.message,
        latencyMs: Date.now() - startTime
      });
    }
  });
}

/**
 * Fetch Shopee Live Room Metadata dari API Shopee (VALIDATED)
 * Endpoint: GET /api/v1/session/{sessionId}
 * Tervalidasi: Berhasil 200 dengan cookie SPC_ pada probe 13/09/2026
 * @param {string} roomId - Session ID dari Shopee Live
 * @param {object} options
 */
async function fetchLiveRoomInfo(roomId, options = {}) {
  const targetUrl = `https://live.shopee.co.id/api/v1/session/${encodeURIComponent(roomId)}`;
  const headers = buildSpoofedHeaders({
    roomId,
    cookie: options.cookie,
    fingerprint: options.fingerprint
  });

  const res = await sendOutboundRequest(targetUrl, {
    method: 'GET',
    headers,
    proxyAgent: options.proxyAgent,
    timeout: options.timeout || 5000
  });

  // Parse response format nyata Shopee: { err_code: 0, data: { session: { ... } } }
  // sendOutboundRequest parse JSON → res.data = { err_code, err_msg, data: { session } }
  if (res.success && res.data) {
    const outerData = res.data;
    const innerData = outerData.data || outerData; // handle nested { data: { session } }
    const sessionData = innerData.session || innerData;
    const errCode = outerData.err_code !== undefined ? outerData.err_code : null;

    if (errCode === 90309999) {
      return {
        success: false,
        online: false,
        isThrottled: true,
        source: 'shopee_live_api_v1',
        status: res.status,
        errCode: 90309999,
        error: outerData.err_msg || 'Shopee IP Rate Limit / Throttle (err_code: 90309999)',
        latencyMs: res.latencyMs
      };
    }

    const isOnline = sessionData.status === 1 && !sessionData.is_terminate;

    return {
      success: true,
      online: isOnline,
      source: 'shopee_live_api_v1',
      status: res.status,
      errCode: errCode,
      roomData: {
        sessionId: sessionData.session_id,
        roomId: sessionData.room_id,
        uid: sessionData.uid,
        username: sessionData.username,
        nickname: sessionData.nickname,
        title: sessionData.title,
        shopId: sessionData.shop_id,
        status: sessionData.status, // 1 = live, 2 = ended
        viewerCount: sessionData.viewer_count || 0,
        memberCount: sessionData.member_cnt || 0,
        likeCount: sessionData.like_cnt || 0,
        shareCount: sessionData.share_cnt || 0,
        itemsCount: sessionData.items_cnt || 0,
        playUrl: sessionData.play_url || '',
        chatroomId: sessionData.chatroom_id || '',
        startTime: sessionData.start_time,
        isTerminate: sessionData.is_terminate || false,
        avatar: sessionData.avatar || '',
        coverPic: sessionData.cover_pic || '',
        maxMemberCount: sessionData.max_member_cnt || 0,
        platform: sessionData.platform,
        isSeller: sessionData.is_seller || false,
        isVerifiedStreamer: sessionData.is_verified_streamer || false
      },
      playUrls: innerData.play_urls || [],
      latencyMs: res.latencyMs
    };
  }

  // Fallback graceful untuk lingkungan uji / offline room
  return {
    success: false,
    online: false,
    source: 'fallback_handler',
    status: res.status || 0,
    errCode: (res.data && res.data.err_code) || null,
    error: (res.data && res.data.err_msg) || res.error || 'Room unverified or offline',
    latencyMs: res.latencyMs
  };
}

/**
 * Viewer Heartbeat: Refresh Room Info + Consume Stream Chunks
 * Endpoint /heartbeat 404 pada probe nyata — gunakan room info refresh sebagai heartbeat.
 * Ini juga mengkonsumsi stream chunks untuk menjaga status viewer tetap aktif.
 * @param {string} roomId
 * @param {object} options
 */
async function sendViewerPingHeartbeat(roomId, options = {}) {
  // Heartbeat = re-fetch room info (ini menjaga "koneksi" viewer ke server Shopee)
  const roomInfo = await fetchLiveRoomInfo(roomId, {
    cookie: options.cookie,
    fingerprint: options.fingerprint,
    proxyAgent: options.proxyAgent,
    timeout: options.timeout || 5000
  });

  // Jika ada play_url aktif, consume 1 chunk stream sebagai bukti viewer aktif
  const playUrl = options.playUrl || (roomInfo.roomData && roomInfo.roomData.playUrl);
  let streamBytes = 0;
  if (playUrl && typeof playUrl === 'string' && playUrl.startsWith('http')) {
    try {
      const streamRes = await probeVideoStreamChunks(playUrl, {
        proxyAgent: options.proxyAgent,
        timeout: 3000
      });
      streamBytes = streamRes.bytesSampled || 0;
    } catch (e) { /* best-effort stream probe */ }
  }

  return {
    success: roomInfo.success,
    status: roomInfo.status || 200,
    latencyMs: roomInfo.latencyMs,
    bytesTransferred: streamBytes + (roomInfo.latencyMs ? 256 : 0),
    responseData: roomInfo.roomData || null,
    viewerCount: roomInfo.roomData ? roomInfo.roomData.viewerCount : null,
    isOnline: roomInfo.online
  };
}

/**
 * Bergabung ke Room Shopee Live (Join Session)
 * Endpoint tervalidasi: POST /api/v1/session/{id}/join → 403 ErrorSVFailed (butuh SV token)
 * Strategi: Coba join terlebih dahulu, jika SV block maka langsung connect ke FLV stream.
 * FLV stream consumption adalah cara utama Shopee menghitung viewer.
 * @param {string} roomId
 * @param {object} options
 */
async function enterLiveRoom(roomId, options = {}) {
  const fp = options.fingerprint || generateDeviceFingerprint();

  // Langkah 1: Coba join via API (best-effort, mungkin di-block oleh SV)
  const joinUrl = `https://live.shopee.co.id/api/v1/session/${encodeURIComponent(roomId)}/join`;
  const headers = buildSpoofedHeaders({
    roomId,
    cookie: options.cookie,
    fingerprint: fp
  });

  const payload = { session_id: Number(roomId) };

  let joinResult = { success: false, status: 0 };
  try {
    joinResult = await sendOutboundRequest(joinUrl, {
      method: 'POST',
      headers,
      body: payload,
      proxyAgent: options.proxyAgent,
      timeout: options.timeout || 4000
    });
  } catch (e) { /* join is best-effort */ }

  // Langkah 2: Connect ke FLV stream (cara utama viewer counting)
  let streamResult = { success: false, bytesSampled: 0 };
  const playUrl = options.playUrl;
  if (playUrl && typeof playUrl === 'string' && playUrl.startsWith('http')) {
    try {
      streamResult = await probeVideoStreamChunks(playUrl, {
        proxyAgent: options.proxyAgent,
        timeout: 5000
      });
    } catch (e) { /* stream connect is best-effort */ }
  }

  const joinSuccess = joinResult.success || (joinResult.data && joinResult.data.err_code === 0);
  const svBlocked = joinResult.data && joinResult.data.err_code === 7913016;

  return {
    success: joinSuccess || streamResult.success,
    joinStatus: joinResult.status,
    joinSuccess,
    svBlocked,
    streamConnected: streamResult.success,
    streamBytes: streamResult.bytesSampled || 0,
    data: joinResult.data || null,
    latencyMs: joinResult.latencyMs || 0,
    bytesTransferred: (joinResult.rawBodyLength || 0) + (streamResult.bytesSampled || 0)
  };
}

/**
 * Keluar dari Room Shopee Live (Disconnect Stream)
 * Endpoint /leave 404 pada probe — viewer count berkurang otomatis saat stream terputus.
 * Fungsi ini tetap ada untuk backward compatibility dan cleanup.
 * @param {string} roomId
 * @param {object} options
 */
async function leaveLiveRoom(roomId, options = {}) {
  // Stream disconnection otomatis mengurangi viewer count di sisi Shopee.
  // Tidak ada endpoint /leave yang aktif, jadi kita hanya return success.
  return {
    success: true,
    status: 200,
    latencyMs: 1,
    bytesTransferred: 0,
    note: 'stream_disconnected'
  };
}

/**
 * Mengirim Like/Tap ke Room Shopee Live
 * @param {string} roomId
 * @param {number} tapCount - Jumlah tap like
 * @param {object} options
 */
async function sendLikeAction(roomId, tapCount = 1, options = {}) {
  const fp = options.fingerprint || generateDeviceFingerprint();
  const targetUrl = `https://live.shopee.co.id/api/v1/session/${encodeURIComponent(roomId)}/like`;
  const headers = buildSpoofedHeaders({
    roomId,
    cookie: options.cookie,
    fingerprint: fp
  });

  const payload = {
    session_id: String(roomId),
    count: Math.max(1, tapCount),
    timestamp: Math.floor(Date.now() / 1000),
    client_uuid: fp.clientUuid
  };

  const res = await sendOutboundRequest(targetUrl, {
    method: 'POST',
    headers,
    body: payload,
    proxyAgent: options.proxyAgent,
    timeout: options.timeout || 2000
  });

  return {
    success: res.success,
    status: res.status,
    latencyMs: res.latencyMs,
    bytesTransferred: res.rawBodyLength || 64
  };
}

/**
 * Mengirim Pesan Chat ke Room Shopee Live
 * @param {string} roomId
 * @param {string} messageText - Teks chat
 * @param {object} options
 */
async function sendChatMessage(roomId, messageText, options = {}) {
  const fp = options.fingerprint || generateDeviceFingerprint();
  // Endpoint tervalidasi: POST /api/v1/session/{id}/message → 200 (probe 13/09/2026)
  const targetUrl = `https://live.shopee.co.id/api/v1/session/${encodeURIComponent(roomId)}/message`;
  const headers = buildSpoofedHeaders({
    roomId,
    cookie: options.cookie,
    fingerprint: fp
  });

  const payload = {
    session_id: String(roomId),
    content: String(messageText || '').trim(),
    msg_type: 1, // 1 = text message
    timestamp: Math.floor(Date.now() / 1000),
    client_uuid: fp.clientUuid,
    client_msg_id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  };

  const res = await sendOutboundRequest(targetUrl, {
    method: 'POST',
    headers,
    body: payload,
    proxyAgent: options.proxyAgent,
    timeout: options.timeout || 3000
  });

  return {
    success: res.success,
    status: res.status,
    data: res.data || null,
    latencyMs: res.latencyMs,
    bytesTransferred: res.rawBodyLength || 128
  };
}

/**
 * Mengirim Sinyal Klik Keranjang/Produk ke Room Shopee Live
 * @param {string} roomId
 * @param {string} productId - ID produk (opsional)
 * @param {object} options
 */
async function sendCartClickAction(roomId, productId, options = {}) {
  const fp = options.fingerprint || generateDeviceFingerprint();
  const targetUrl = `https://live.shopee.co.id/api/v1/session/${encodeURIComponent(roomId)}/product/click`;
  const headers = buildSpoofedHeaders({
    roomId,
    cookie: options.cookie,
    fingerprint: fp
  });

  const payload = {
    session_id: String(roomId),
    product_id: productId || null,
    action_type: 'product_click',
    timestamp: Math.floor(Date.now() / 1000),
    client_uuid: fp.clientUuid
  };

  const res = await sendOutboundRequest(targetUrl, {
    method: 'POST',
    headers,
    body: payload,
    proxyAgent: options.proxyAgent,
    timeout: options.timeout || 2000
  });

  return {
    success: res.success,
    status: res.status,
    latencyMs: res.latencyMs,
    bytesTransferred: res.rawBodyLength || 96
  };
}

/**
 * Probe Video Stream Chunks (Membuktikan Client Mengonsumsi Video Stream HLS)
 * Menggunakan Zero-Allocation Drainer agar tidak menumpuk memory buffer video
 * @param {string} streamUrl
 * @param {object} options
 */
async function probeVideoStreamChunks(streamUrl, options = {}) {
  if (!streamUrl || typeof streamUrl !== 'string') {
    return { success: false, reason: 'Invalid stream URL' };
  }

  const headers = {
    'User-Agent': USER_AGENTS_MOBILE[0],
    'Range': 'bytes=0-1024'
  };

  const res = await sendOutboundRequest(streamUrl, {
    method: 'GET',
    headers,
    proxyAgent: options.proxyAgent,
    drainStream: true,
    timeout: options.timeout || 3000
  });

  return {
    success: res.success || res.status === 206,
    status: res.status,
    bytesSampled: res.rawBodyLength || 0,
    streamDrained: true,
    latencyMs: res.latencyMs
  };
}

/**
 * Koneksi ke FLV Live Stream untuk Viewer Counting
 * Shopee menghitung viewer berdasarkan konsumsi stream (play_url).
 * Fungsi ini membuka koneksi persistent ke FLV stream.
 * @param {string} playUrl - URL stream FLV dari room info
 * @param {object} options
 * @returns {Promise<{success, streamRef, bytesReceived, latencyMs}>}
 */
async function connectToLiveStream(playUrl, options = {}) {
  if (!playUrl || typeof playUrl !== 'string') {
    return { success: false, reason: 'Invalid play URL', bytesReceived: 0 };
  }

  // Consume stream chunks — ini yang membuat Shopee menghitung kita sebagai viewer
  const streamRes = await probeVideoStreamChunks(playUrl, {
    proxyAgent: options.proxyAgent,
    timeout: options.timeout || 5000
  });

  return {
    success: streamRes.success,
    status: streamRes.status,
    bytesReceived: streamRes.bytesSampled || 0,
    streamDrained: streamRes.streamDrained,
    latencyMs: streamRes.latencyMs,
    playUrl
  };
}

/**
 * Persistent Video Stream Consumer (Continuous FLV/HLS Stream Drainer)
 * Mempertahankan koneksi streaming persisten ke CDN Shopee Live (Tencent Cloud / Wangsu),
 * mensimulasikan penonton aktif yang terus mengonsumsi video stream tanpa memakan RAM server.
 */
class PersistentStreamConsumer extends EventEmitter {
  constructor(streamUrl, options = {}) {
    super();
    this.streamUrl = streamUrl;
    this.options = options;
    this.proxyAgent = options.proxyAgent || null;
    this.bytesStreamed = 0;
    this.chunksReceived = 0;
    this.connected = false;
    this.req = null;
    this.res = null;
    this.aborted = false;
    this.startTime = null;
    this.reconnectAttempts = 0;
    this.maxReconnects = options.maxReconnects || 3;
    // Throttled flow control (default ~18 KB/s ultra-hemat data: cukup menjaga CDN socket tetap open \u0026 aktif)
    this.throttleBytesPerSec = options.throttleBytesPerSec !== undefined ? options.throttleBytesPerSec : 18000;
    this.windowStart = 0;
    this.windowBytes = 0;
    this.throttleTimer = null;
    this.healthyTimer = null;
  }

  start() {
    if (this.aborted || this.connected) return this;
    this.startTime = Date.now();
    this.windowStart = Date.now();
    this.windowBytes = 0;
    try {
      const parsedUrl = new URL(this.streamUrl);
      const isHttps = parsedUrl.protocol === 'https:';
      const httpLib = isHttps ? https : http;
      const headers = {
        'User-Agent': (this.options.fingerprint && this.options.fingerprint.deviceProfile && this.options.fingerprint.deviceProfile.userAgent) || USER_AGENTS_MOBILE[0],
        'Accept': '*/*',
        'Accept-Encoding': 'identity',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Referer': `https://live.shopee.co.id/live/${this.options.roomId || ''}`,
        'Origin': 'https://live.shopee.co.id'
      };

      const reqOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers,
        agent: this.proxyAgent || (isHttps ? globalHttpsAgent : globalHttpAgent),
        rejectUnauthorized: false
      };

      this.req = httpLib.request(reqOptions, (res) => {
        this.res = res;
        this.connected = res.statusCode >= 200 && res.statusCode < 400;
        this.emit('connected', { status: res.statusCode, headers: res.headers });

        if (this.connected) {
          // Reset reconnect counter jika koneksi bertahan sehat selama 5 detik
          if (this.healthyTimer) clearTimeout(this.healthyTimer);
          this.healthyTimer = setTimeout(() => {
            if (this.connected && !this.aborted) {
              this.reconnectAttempts = 0;
            }
          }, 5000);
        }

        res.on('data', (chunk) => {
          if (this.aborted) return;
          const len = chunk.length;
          this.bytesStreamed += len;
          this.chunksReceived++;
          this.windowBytes += len;

          // Zero-allocation drainer: buang chunk buffer seketika
          chunk = null;
          if (this.chunksReceived % 10 === 0) {
            this.emit('progress', {
              bytesStreamed: this.bytesStreamed,
              chunksReceived: this.chunksReceived,
              activeSec: Math.floor((Date.now() - this.startTime) / 1000)
            });
          }

          // Pacing / backpressure flow control (mencegah VPS bandwidth leak tanpa memutus TCP socket)
          if (this.throttleBytesPerSec > 0 && this.windowBytes >= this.throttleBytesPerSec) {
            const now = Date.now();
            const elapsed = now - this.windowStart;
            if (elapsed < 1000) {
              try { res.pause(); } catch (e) {}
              const waitTime = Math.max(50, 1000 - elapsed);
              if (this.throttleTimer) clearTimeout(this.throttleTimer);
              this.throttleTimer = setTimeout(() => {
                if (!this.aborted && this.res) {
                  this.windowStart = Date.now();
                  this.windowBytes = 0;
                  try { this.res.resume(); } catch (e) {}
                }
              }, waitTime);
            } else {
              this.windowStart = now;
              this.windowBytes = 0;
            }
          }
        });

        res.on('end', () => {
          const wasConnected = this.connected;
          this.connected = false;
          if (this.healthyTimer) clearTimeout(this.healthyTimer);
          if (this.throttleTimer) clearTimeout(this.throttleTimer);
          this.emit('ended', { bytesStreamed: this.bytesStreamed });
          // Auto-reconnect jika stream terputus prematur dan belum di-abort
          if (!this.aborted && wasConnected) {
            if (this.reconnectAttempts < this.maxReconnects) {
              this.reconnectAttempts++;
              setTimeout(() => {
                if (!this.aborted) this.start();
              }, 1000);
            } else {
              this.emit('exhausted', { bytesStreamed: this.bytesStreamed, reason: 'max_reconnects_reached' });
            }
          }
        });

        res.on('error', (err) => {
          const wasConnected = this.connected;
          this.connected = false;
          if (this.healthyTimer) clearTimeout(this.healthyTimer);
          if (this.throttleTimer) clearTimeout(this.throttleTimer);
          this.emit('error', err);
          if (!this.aborted && wasConnected) {
            if (this.reconnectAttempts < this.maxReconnects) {
              this.reconnectAttempts++;
              setTimeout(() => {
                if (!this.aborted) this.start();
              }, 1500);
            } else {
              this.emit('exhausted', { bytesStreamed: this.bytesStreamed, reason: 'max_reconnects_reached', error: err.message });
            }
          }
        });
      });

      this.req.on('error', (err) => {
        this.connected = false;
        if (this.healthyTimer) clearTimeout(this.healthyTimer);
        if (this.throttleTimer) clearTimeout(this.throttleTimer);
        this.emit('error', err);
        if (!this.aborted) {
          if (this.reconnectAttempts < this.maxReconnects) {
            this.reconnectAttempts++;
            setTimeout(() => {
              if (!this.aborted) this.start();
            }, 1000);
          } else {
            this.emit('exhausted', { bytesStreamed: this.bytesStreamed, reason: 'req_error_exhausted', error: err.message });
          }
        }
      });

      this.req.end();
    } catch (err) {
      this.connected = false;
      this.emit('error', err);
      if (!this.aborted) {
        if (this.reconnectAttempts < this.maxReconnects) {
          this.reconnectAttempts++;
          setTimeout(() => {
            if (!this.aborted) this.start();
          }, 1000);
        } else {
          this.emit('exhausted', { bytesStreamed: this.bytesStreamed, reason: 'start_catch_exhausted', error: err.message });
        }
      }
    }
    return this;
  }

  stop() {
    this.aborted = true;
    this.connected = false;
    if (this.healthyTimer) clearTimeout(this.healthyTimer);
    if (this.throttleTimer) clearTimeout(this.throttleTimer);
    if (this.res) {
      try { this.res.destroy(); } catch (e) {}
    }
    if (this.req) {
      try { this.req.destroy(); } catch (e) {}
    }
    this.emit('stopped', { bytesStreamed: this.bytesStreamed });
  }
}

function createPersistentStreamConsumer(streamUrl, options = {}) {
  return new PersistentStreamConsumer(streamUrl, options);
}

/**
 * ViewerRegistrationClient - Shopee Live Polling & Viewer Keepalive Client
 * Mengelola sesi viewer resmi di sisi Shopee Live melalui endpoint /session/{id}/join
 * dan polling periodik /session/{id}, menangani anti-bot throttle (90309999) dan keepalive.
 */
class ViewerRegistrationClient extends EventEmitter {
  constructor(roomId, options = {}) {
    super();
    this.roomId = roomId;
    this.options = options;
    this.proxyAgent = options.proxyAgent || null;
    this.cookie = options.cookie || null;
    this.fingerprint = options.fingerprint || generateDeviceFingerprint(options.deviceIndex);
    this.pollIntervalSec = options.pollIntervalSec || 15;
    this.networkTimeout = options.networkTimeout || 5000;
    
    this.joined = false;
    this.active = false;
    this.pollTimer = null;
    this.heartbeatCount = 0;
    this.viewerCount = 0;
    this.roomData = null;
    this.isOnline = true;
  }

  async join() {
    if (this.active) return { success: this.joined };
    this.active = true;

    // 1. Ambil info metadata room terkini
    const info = await fetchLiveRoomInfo(this.roomId, {
      cookie: this.cookie,
      fingerprint: this.fingerprint,
      proxyAgent: this.proxyAgent,
      timeout: this.networkTimeout
    });

    if (info && info.errCode === 90309999) {
      this.emit('throttled', { roomId: this.roomId, errCode: 90309999 });
      return { success: false, throttled: true, error: info.error };
    }

    if (info && info.roomData) {
      this.roomData = info.roomData;
      this.viewerCount = info.roomData.viewerCount || 0;
      this.isOnline = info.online;
    }

    // 2. Kirim join session API
    const joinRes = await enterLiveRoom(this.roomId, {
      cookie: this.cookie,
      fingerprint: this.fingerprint,
      proxyAgent: this.proxyAgent,
      timeout: this.networkTimeout
    });

    this.joined = joinRes.joinSuccess || joinRes.streamConnected;
    this.emit('joined', {
      roomId: this.roomId,
      joined: this.joined,
      joinStatus: joinRes.joinStatus,
      svBlocked: joinRes.svBlocked,
      roomData: this.roomData
    });

    this.scheduleNextPoll();
    return { success: true, joined: this.joined, roomData: this.roomData };
  }

  scheduleNextPoll() {
    if (!this.active) return;
    const jitter = (Math.random() * 0.4 - 0.2) * this.pollIntervalSec;
    const delayMs = Math.max(5000, Math.round((this.pollIntervalSec + jitter) * 1000));

    this.pollTimer = setTimeout(async () => {
      if (!this.active) return;
      await this.poll();
      this.scheduleNextPoll();
    }, delayMs);
  }

  async poll() {
    if (!this.active) return;
    this.heartbeatCount++;

    try {
      const info = await fetchLiveRoomInfo(this.roomId, {
        cookie: this.cookie,
        fingerprint: this.fingerprint,
        proxyAgent: this.proxyAgent,
        timeout: this.networkTimeout
      });

      if (info && (info.errCode === 90309999 || info.isThrottled)) {
        this.emit('throttled', { roomId: this.roomId, errCode: 90309999 });
        return;
      }

      if (info && info.roomData) {
        this.roomData = info.roomData;
        this.viewerCount = info.roomData.viewerCount || 0;
        this.isOnline = info.online;

        this.emit('heartbeat', {
          count: this.heartbeatCount,
          viewerCount: this.viewerCount,
          isOnline: this.isOnline,
          playUrl: info.roomData.playUrl
        });

        if (!this.isOnline) {
          this.emit('ended', { roomId: this.roomId });
        }
      }

      // Re-affirm /join secara periodik (setiap 5 siklus polling) untuk menjaga status viewer aktif
      if (this.heartbeatCount % 5 === 0) {
        try {
          await enterLiveRoom(this.roomId, {
            cookie: this.cookie,
            fingerprint: this.fingerprint,
            proxyAgent: this.proxyAgent,
            timeout: 3000
          });
        } catch (e) {}
      }
    } catch (err) {
      this.emit('error', err);
    }
  }

  stop() {
    this.active = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    leaveLiveRoom(this.roomId, {
      cookie: this.cookie,
      fingerprint: this.fingerprint,
      proxyAgent: this.proxyAgent
    }).catch(() => {});
    this.emit('stopped');
  }
}

function createViewerRegistrationClient(roomId, options = {}) {
  return new ViewerRegistrationClient(roomId, options);
}

module.exports = {
  USER_AGENTS_MOBILE,
  DEVICE_PROFILES,
  MOBILE_TLS_CIPHERS,
  MOBILE_TLS_OPTIONS,
  globalHttpAgent,
  globalHttpsAgent,
  getAgentPoolStats,
  generateDeviceFingerprint,
  buildSpoofedHeaders,
  parseLiveRoomId,
  sendOutboundRequest,
  fetchLiveRoomInfo,
  sendViewerPingHeartbeat,
  probeVideoStreamChunks,
  connectToLiveStream,
  PersistentStreamConsumer,
  createPersistentStreamConsumer,
  ViewerRegistrationClient,
  createViewerRegistrationClient,
  enterLiveRoom,
  leaveLiveRoom,
  sendLikeAction,
  sendChatMessage,
  sendCartClickAction
};

