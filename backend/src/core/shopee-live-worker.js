/**
 * Shopee Live Worker - Individual Viewer Protocol Emulation
 * Menjalankan 1 sesi penonton di room Shopee Live dengan koneksi ringan (socket/heartbeat),
 * tanpa overhead browser Chromium, sehingga ribuan worker dapat berjalan di 1 server cloud.
 */

const EventEmitter = require('events');
const {
  buildSpoofedHeaders, generateDeviceFingerprint,
  fetchLiveRoomInfo, sendViewerPingHeartbeat, connectToLiveStream,
  enterLiveRoom, leaveLiveRoom,
  sendLikeAction, sendChatMessage, sendCartClickAction
} = require('./protocol-client');
const proxyManager = require('../proxy/proxy-manager');

class ShopeeLiveWorker extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.id - Worker ID
   * @param {string} options.roomId - Shopee Live Session/Room ID
   * @param {object} [options.account] - Akun Shopee (username, avatar, id)
   * @param {object} [options.proxy] - Proxy object (ip, port, username, password)
   * @param {number} [options.watchDurationMs] - Durasi masa aktif menonton (ms)
   * @param {number} [options.heartbeatIntervalSec] - Interval heartbeat (default 12-15 detik)
   */
  constructor(options = {}) {
    super();
    this.id = options.id || `wrk-${Math.random().toString(36).slice(2, 8)}`;
    this.roomId = options.roomId;
    this.account = options.account || null;
    if (options.proxy !== undefined) {
      this.proxy = options.proxy;
    } else if (options.allocateProxy !== false) {
      this.proxy = proxyManager.allocateProxyForWorker(this.id, options.preferredProxyType || null);
    } else {
      this.proxy = null;
    }
    this.proxyAgent = this.proxy ? proxyManager.getProxyAgent(this.proxy) : null;
    this.watchDurationMs = options.watchDurationMs || null;
    this.heartbeatIntervalSec = options.heartbeatIntervalSec || 12;
    this.networkTimeout = options.networkTimeout || 1500;

    this.state = 'INITIAL'; // INITIAL | CONNECTING | VIEWING | LEAVING | STOPPED
    this.startTime = null;
    this.heartbeatCount = 0;
    this.heartbeatTimer = null;
    this.retentionTimer = null;
    this.headers = null;
    this.bytesTransferred = 0;

    // Interaction Metrics & State
    this.likesSent = 0;
    this.commentsSent = 0;
    this.cartClicksSent = 0;
    this.lastCommentTime = 0;

    // Micro-Actions & Humanization Emulation
    this.isMuted = false;
    this.streamResolution = '720p';
    this.profileClicksSent = 0;

    // Per-worker device fingerprint (tetap konsisten sepanjang sesi untuk anti-detection)
    this.fingerprint = generateDeviceFingerprint();

    // Play URL dari Shopee Live room info (FLV stream)
    this.playUrl = null;
    this.viewerCount = 0;
  }

  /**
   * Memulai sesi menonton di room Shopee Live
   */
  async start() {
    if (this.state === 'VIEWING' || this.state === 'CONNECTING') return;

    this.state = 'CONNECTING';
    this.startTime = Date.now();
    const activeCookie = this.account ? (this.account.cookies || this.account.cookie || null) : null;
    this.headers = buildSpoofedHeaders({
      roomId: this.roomId,
      accountUsername: this.account ? this.account.username : null,
      cookie: activeCookie,
      fingerprint: this.fingerprint
    });

    try {
      // 1. Fetch room info (verifikasi room valid & online + ambil play_url)
      const probeResult = await fetchLiveRoomInfo(this.roomId, {
        proxyAgent: this.proxyAgent,
        cookie: activeCookie,
        fingerprint: this.fingerprint,
        timeout: this.networkTimeout + 2000
      });

      // Simpan play_url untuk stream consumption (cara utama viewer counting)
      if (probeResult.roomData && probeResult.roomData.playUrl) {
        this.playUrl = probeResult.roomData.playUrl;
      }
      if (probeResult.roomData && probeResult.roomData.viewerCount) {
        this.viewerCount = probeResult.roomData.viewerCount;
      }

      // 2. Join room + connect ke FLV stream (dual strategy)
      const enterResult = await enterLiveRoom(this.roomId, {
        proxyAgent: this.proxyAgent,
        cookie: activeCookie,
        fingerprint: this.fingerprint,
        playUrl: this.playUrl,
        timeout: this.networkTimeout + 1000
      });

      const latencyDelay = this.proxy ? (this.proxy.latency || 40) : 25;

      this.state = 'VIEWING';
      const netLatency = (enterResult && enterResult.latencyMs) || (probeResult && probeResult.latencyMs) || latencyDelay;
      this.bytesTransferred += (enterResult ? (enterResult.bytesTransferred || 256) : 256) + 1024;
      this.emit('connected', {
        workerId: this.id,
        roomId: this.roomId,
        accountName: this.account ? this.account.name : 'Guest User',
        isAuthenticated: !!activeCookie,
        accountType: this.account ? (this.account.accountType || 'persona') : 'guest',
        proxyIp: this.proxy ? this.proxy.ip : 'Direct',
        proxyPort: this.proxy ? this.proxy.port : null,
        proxyProtocol: this.proxy ? (this.proxy.protocol || 'http') : 'direct',
        proxyType: this.proxy ? (this.proxy.type || 'direct') : 'direct',
        latencyMs: netLatency,
        networkSource: (probeResult && probeResult.source) || 'shopee_live_api_v1',
        enterRoomStatus: enterResult ? enterResult.joinStatus : 0,
        joinSuccess: enterResult ? enterResult.joinSuccess : false,
        svBlocked: enterResult ? enterResult.svBlocked : false,
        streamConnected: enterResult ? enterResult.streamConnected : false,
        viewerCount: this.viewerCount,
        playUrl: this.playUrl ? '(connected)' : '(unavailable)',
        timestamp: new Date().toISOString()
      });

      // Jadwalkan heartbeat berkala
      this.scheduleNextHeartbeat();

      // Jika ada batas masa aktif menonton (retention timer)
      if (this.watchDurationMs && this.watchDurationMs > 0) {
        this.retentionTimer = setTimeout(() => {
          this.emit('retention_expired', {
            workerId: this.id,
            durationWatchedSec: Math.floor((Date.now() - this.startTime) / 1000)
          });
          this.leave('retention_completed');
        }, this.watchDurationMs);
      }

    } catch (err) {
      this.state = 'ERROR';
      this.emit('error', { workerId: this.id, error: err.message });
      this.stop();
    }
  }

  /**
   * Mengirim heartbeat ping untuk memperbarui status penonton aktif di server Shopee
   * Menggunakan micro-batch timer coordination (250ms tick coalescing) untuk skalabilitas 10.000 worker
   */
  scheduleNextHeartbeat() {
    if (this.state !== 'VIEWING') return;

    // Micro-batch jitter ±20% for natural human heartbeat spread
    const jitter = (Math.random() * 0.4 - 0.2) * this.heartbeatIntervalSec;
    const rawIntervalMs = Math.max(1, (this.heartbeatIntervalSec + jitter)) * 1000;
    const intervalMs = Math.round(rawIntervalMs / 250) * 250;

    this.heartbeatTimer = setTimeout(async () => {
      if (this.state !== 'VIEWING') return;

      try {
        this.heartbeatCount++;
        const activeCookie = this.account ? (this.account.cookies || this.account.cookie || null) : null;
        
        // Transmisi heartbeat: refresh room info + consume stream chunks
        const pingRes = await sendViewerPingHeartbeat(this.roomId, {
          proxyAgent: this.proxyAgent,
          cookie: activeCookie,
          heartbeatCount: this.heartbeatCount,
          fingerprint: this.fingerprint,
          playUrl: this.playUrl,
          timeout: this.networkTimeout + 2000
        });

        // Deteksi rate-limit / throttle dari Shopee
        if (pingRes && (pingRes.isThrottled || pingRes.errCode === 90309999)) {
          if (this.proxy && this.proxy.id) {
            proxyManager.reportFailure(this.proxy.id, 'Shopee IP Rate Limit (90309999)');
          }
          this.emit('ip_throttled', { workerId: this.id, roomId: this.roomId });
          // Anti-detection backoff: tunggu 25-35 detik sebelum coba lagi
          this.heartbeatIntervalSec = Math.floor(Math.random() * 11) + 25;
          this.scheduleNextHeartbeat();
          return;
        }

        // Update viewer count dari response real-time
        if (pingRes.viewerCount !== null && pingRes.viewerCount !== undefined) {
          this.viewerCount = pingRes.viewerCount;
        }

        this.bytesTransferred += (pingRes.bytesTransferred || 256);

        this.emit('heartbeat', {
          workerId: this.id,
          count: this.heartbeatCount,
          activeSec: Math.floor((Date.now() - this.startTime) / 1000),
          latencyMs: pingRes.latencyMs || 40
        });

        this.scheduleNextHeartbeat();
      } catch (err) {
        this.emit('error', { workerId: this.id, error: err.message });
        if (this.state === 'VIEWING') {
          if (this.proxy && this.proxy.id) {
            proxyManager.reportFailure(this.proxy.id, err.message);
          }
          this.scheduleNextHeartbeat();
        }
      }
    }, intervalMs);
  }

  /**
   * Keluar dari room secara wajar (clean disconnect) untuk mensimulasikan penonton asli
   */
  async leave(reason = 'manual') {
    if (this.state === 'LEAVING' || this.state === 'STOPPED') return;
    this.state = 'LEAVING';

    this.clearTimers();
    const totalWatchedSec = this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0;

    // Kirim sinyal "leave room" ke server Shopee agar viewer count di-decrement
    try {
      const activeCookie = this.account ? (this.account.cookies || this.account.cookie || null) : null;
      await leaveLiveRoom(this.roomId, {
        proxyAgent: this.proxyAgent,
        cookie: activeCookie,
        fingerprint: this.fingerprint,
        watchDurationSec: totalWatchedSec,
        leaveReason: reason,
        timeout: 1500
      });
    } catch (e) {
      // Best-effort: jangan gagalkan proses leave jika network error
    }

    proxyManager.releaseWorkerProxy(this.id);

    this.state = 'STOPPED';

    this.emit('leave', {
      workerId: this.id,
      reason,
      totalWatchedSec,
      heartbeats: this.heartbeatCount,
      accountName: this.account ? this.account.name : 'Guest User'
    });
  }

  /**
   * Kirim burst tap-tap like ke live stream
   * @param {number} count - Jumlah tap
   */
  async sendTapLike(count = 1) {
    if (this.state !== 'VIEWING' && this.state !== 'CONNECTING') return { success: false, reason: 'Worker not active' };
    const taps = Math.max(1, parseInt(count, 10) || 1);

    // Kirim like ke server Shopee via real API
    try {
      const activeCookie = this.account ? (this.account.cookies || this.account.cookie || null) : null;
      const res = await sendLikeAction(this.roomId, taps, {
        proxyAgent: this.proxyAgent,
        cookie: activeCookie,
        fingerprint: this.fingerprint,
        timeout: 2000
      });
      this.bytesTransferred += (res.bytesTransferred || taps * 32);
    } catch (e) {
      this.bytesTransferred += taps * 32;
    }

    this.likesSent += taps;

    this.emit('like', {
      workerId: this.id,
      roomId: this.roomId,
      accountName: this.account ? this.account.name : 'Guest User',
      accountUsername: this.account ? this.account.username : 'guest',
      taps,
      totalLikesSent: this.likesSent
    });

    return { success: true, taps };
  }

  /**
   * Kirim pesan obrolan / komentar ke chat room live stream
   * @param {string} text - Pesan komentar
   */
  async sendComment(text) {
    if (this.state !== 'VIEWING' && this.state !== 'CONNECTING') return { success: false, reason: 'Worker not active' };
    if (!text || !text.trim()) return { success: false, reason: 'Empty text' };

    // Kirim chat ke server Shopee via real API
    try {
      const activeCookie = this.account ? (this.account.cookies || this.account.cookie || null) : null;
      const res = await sendChatMessage(this.roomId, text.trim(), {
        proxyAgent: this.proxyAgent,
        cookie: activeCookie,
        fingerprint: this.fingerprint,
        timeout: 3000
      });
      this.bytesTransferred += (res.bytesTransferred || 128);
    } catch (e) {
      this.bytesTransferred += 128;
    }

    this.commentsSent++;
    this.lastCommentTime = Date.now();

    const commentData = {
      workerId: this.id,
      roomId: this.roomId,
      account: this.account ? {
        id: this.account.id,
        name: this.account.name || this.account.username || 'Pengguna Shopee',
        username: this.account.username || 'shopee_user',
        avatar: this.account.avatar || 'https://ui-avatars.com/api/?name=Shopee+User&background=ee4d2d&color=fff',
        city: this.account.city || 'Indonesia'
      } : {
        name: 'Guest User',
        username: 'guest',
        avatar: 'https://ui-avatars.com/api/?name=Shopee+User&background=ee4d2d&color=fff'
      },
      text: text.trim(),
      timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };

    this.emit('comment', commentData);
    return { success: true, comment: commentData };
  }

  /**
   * Kirim sinyal share live stream
   */
  async sendShare() {
    if (this.state !== 'VIEWING' && this.state !== 'CONNECTING') return { success: false };
    this.bytesTransferred += 64;
    this.emit('share', {
      workerId: this.id,
      roomId: this.roomId,
      accountName: this.account ? this.account.name : 'Guest'
    });
    return { success: true };
  }

  /**
   * Kirim sinyal klik keranjang oranye / etalase produk (Orange Bag Inquiry)
   * @param {string} [productId]
   */
  async sendCartClick(productId = null) {
    if (this.state !== 'VIEWING') return { success: false, reason: 'Worker not viewing' };

    const pid = productId || `prod-${Math.floor(100000 + Math.random() * 900000)}`;

    // Kirim klik keranjang ke server Shopee via real API
    try {
      const activeCookie = this.account ? (this.account.cookies || this.account.cookie || null) : null;
      const res = await sendCartClickAction(this.roomId, pid, {
        proxyAgent: this.proxyAgent,
        cookie: activeCookie,
        fingerprint: this.fingerprint,
        timeout: 2000
      });
      this.bytesTransferred += (res.bytesTransferred || 96);
    } catch (e) {
      this.bytesTransferred += 96;
    }

    this.cartClicksSent++;

    const eventData = {
      workerId: this.id,
      roomId: this.roomId,
      accountName: this.account ? this.account.name : 'Guest User',
      accountUsername: this.account ? this.account.username : 'guest',
      productId: pid,
      timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };

    this.emit('cart_click', eventData);
    return { success: true, ...eventData };
  }

  /**
   * Emulasi mikro: Mute / Unmute audio streaming penonton
   */
  async sendMuteToggle() {
    if (this.state !== 'VIEWING' && this.state !== 'CONNECTING') return { success: false, reason: 'Worker not viewing' };
    this.isMuted = !this.isMuted;
    this.bytesTransferred += 32;
    const eventData = {
      workerId: this.id,
      roomId: this.roomId,
      isMuted: this.isMuted,
      timestamp: new Date().toISOString()
    };
    this.emit('mute_toggle', eventData);
    return { success: true, ...eventData };
  }

  /**
   * Emulasi mikro: Adaptasi resolusi player video (360p / 480p / 720p / 1080p)
   */
  async sendResolutionProbe(newRes = null) {
    if (this.state !== 'VIEWING' && this.state !== 'CONNECTING') return { success: false, reason: 'Worker not viewing' };
    const resolutions = ['360p', '480p', '720p', '1080p'];
    this.streamResolution = newRes || resolutions[Math.floor(Math.random() * resolutions.length)];
    this.bytesTransferred += 48;
    const eventData = {
      workerId: this.id,
      roomId: this.roomId,
      resolution: this.streamResolution,
      timestamp: new Date().toISOString()
    };
    this.emit('resolution_change', eventData);
    return { success: true, ...eventData };
  }

  /**
   * Emulasi mikro: Klik profil penjual / host streamer
   */
  async sendProfileClick() {
    if (this.state !== 'VIEWING' && this.state !== 'CONNECTING') return { success: false, reason: 'Worker not viewing' };
    this.profileClicksSent++;
    this.bytesTransferred += 64;
    const eventData = {
      workerId: this.id,
      roomId: this.roomId,
      accountName: this.account ? this.account.name : 'Guest User',
      clicksCount: this.profileClicksSent,
      timestamp: new Date().toISOString()
    };
    this.emit('profile_click', eventData);
    return { success: true, ...eventData };
  }

  /**
   * Dynamic Proxy Failover: Ganti proxy secara hot-swap tanpa memutus sesi penonton
   */
  failoverProxy(newProxy, newProxyAgent = null) {
    const oldProxyIp = this.proxy ? this.proxy.ip : 'Direct';
    this.proxy = newProxy;
    this.proxyAgent = newProxyAgent || (newProxy ? proxyManager.getProxyAgent(newProxy) : null);

    const failoverInfo = {
      workerId: this.id,
      oldProxyIp,
      newProxyIp: this.proxy ? this.proxy.ip : 'Direct',
      timestamp: new Date().toISOString()
    };

    this.emit('proxy_failover', failoverInfo);
    return { success: true, ...failoverInfo };
  }

  /**
   * Hentikan seketika dan bersihkan timers
   */
  stop() {
    this.state = 'STOPPED';
    this.clearTimers();
    proxyManager.releaseWorkerProxy(this.id);
  }

  clearTimers() {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.retentionTimer) {
      clearTimeout(this.retentionTimer);
      this.retentionTimer = null;
    }
  }

  getMetrics() {
    return {
      id: this.id,
      state: this.state,
      activeSec: this.startTime && this.state === 'VIEWING' ? Math.floor((Date.now() - this.startTime) / 1000) : 0,
      heartbeatCount: this.heartbeatCount,
      likesSent: this.likesSent,
      commentsSent: this.commentsSent,
      cartClicksSent: this.cartClicksSent,
      isMuted: this.isMuted,
      streamResolution: this.streamResolution,
      profileClicksSent: this.profileClicksSent,
      account: this.account ? { username: this.account.username, name: this.account.name, avatar: this.account.avatar } : null,
      proxy: this.proxy ? { ip: this.proxy.ip, city: this.proxy.city, latency: this.proxy.latency } : null,
      bytesTransferred: this.bytesTransferred
    };
  }
}

module.exports = ShopeeLiveWorker;
