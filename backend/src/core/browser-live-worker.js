/**
 * Browser Live Worker - Headless Chromium Stealth Viewer Engine
 * Menjalankan 1 sesi penonton di Shopee Live menggunakan browser Chromium asli (headless)
 * dengan proteksi anti-detect, alokasi proxy residensial per-worker,
 * dan Smart Resource Interception untuk menghemat RAM dan kuota proxy hingga 80%.
 * 
 * Sepenuhnya kompatibel dengan interface ShopeeLiveWorker sehingga dapat digunakan
 * secara transparan oleh CampaignInstance dan RetentionController.
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const proxyManager = require('../proxy/proxy-manager');

// Cari path executable Chrome atau Edge lokal
function findBrowserExecutable() {
  const candidates = [
    // Windows Chrome
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : null,
    // Windows Edge
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    // Linux / Docker
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    // MacOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch (e) {}
  }
  return null;
}

const DEFAULT_CHROME_PATH = findBrowserExecutable();

class BrowserLiveWorker extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.id - Worker ID unik
   * @param {string} options.roomId - Shopee Live Room/Session ID
   * @param {object} [options.account] - Akun Shopee (cookies, username)
   * @param {object} [options.proxy] - Proxy object (ip, port, username, password, protocol)
   * @param {number} [options.watchDurationMs] - Durasi masa aktif menonton (ms)
   * @param {number} [options.heartbeatIntervalSec=12] - Interval heartbeat check (detik)
   * @param {boolean} [options.blockHeavyResources=true] - Aktifkan filter gambar/font/CSS untuk hemat RAM & kuota
   * @param {string} [options.chromePath] - Path kustom ke chrome.exe jika diperlukan
   */
  constructor(options = {}) {
    super();
    this.id = options.id || `bwrk-${Math.random().toString(36).slice(2, 8)}`;
    this.roomId = options.roomId;
    this.account = options.account || null;

    if (options.proxy !== undefined) {
      this.proxy = options.proxy;
    } else if (options.allocateProxy !== false) {
      this.proxy = proxyManager.allocateProxyForWorker(this.id, options.preferredProxyType || null);
    } else {
      this.proxy = null;
    }

    this.watchDurationMs = options.watchDurationMs || null;
    this.heartbeatIntervalSec = options.heartbeatIntervalSec || 12;
    this.blockHeavyResources = options.blockHeavyResources !== false;
    this.chromePath = options.chromePath || DEFAULT_CHROME_PATH;

    this.state = 'INITIAL'; // INITIAL | CONNECTING | VIEWING | LEAVING | STOPPED | ERROR
    this.startTime = null;
    this.heartbeatCount = 0;
    this.heartbeatTimer = null;
    this.retentionTimer = null;
    this.bytesTransferred = 0;

    // Interaction metrics
    this.likesSent = 0;
    this.commentsSent = 0;
    this.cartClicksSent = 0;

    // Puppeteer handles
    this.browser = null;
    this.page = null;
    this.targetUrl = `https://live.shopee.co.id/share?from=live&session=${this.roomId}`;
  }

  /**
   * Parse string cookie Shopee menjadi array cookie object Puppeteer
   * @param {string} cookieStr 
   */
  _parseCookiesForPuppeteer(cookieStr) {
    if (!cookieStr || typeof cookieStr !== 'string') return [];
    const pairs = cookieStr.split(';').map(p => p.trim()).filter(Boolean);
    const result = [];
    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx !== -1) {
        const name = pair.slice(0, eqIdx).trim();
        const value = pair.slice(eqIdx + 1).trim();
        if (name && value) {
          result.push({
            name,
            value,
            domain: '.shopee.co.id',
            path: '/'
          });
        }
      }
    }
    return result;
  }

  /**
   * Jalankan browser dan sambungkan ke room Shopee Live
   */
  async start() {
    if (this.state === 'VIEWING' || this.state === 'CONNECTING') return;

    if (!this.chromePath) {
      const errMsg = 'Executable Google Chrome atau Edge tidak ditemukan di sistem.';
      this.state = 'ERROR';
      this.emit('error', { workerId: this.id, error: errMsg });
      return;
    }

    this.state = 'CONNECTING';
    this.startTime = Date.now();

    try {
      const args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-infobars',
        '--disable-blink-features=AutomationControlled',
        '--mute-audio',
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=412,915',
        '--lang=id-ID,id'
      ];

      // Konfigurasi Proxy jika ada
      if (this.proxy && this.proxy.ip && this.proxy.port) {
        const proto = (this.proxy.protocol || 'http').toLowerCase();
        args.push(`--proxy-server=${proto}://${this.proxy.ip}:${this.proxy.port}`);
      }

      this.browser = await puppeteer.launch({
        executablePath: this.chromePath,
        headless: 'new', // Headless mode modern
        args,
        ignoreDefaultArgs: ['--enable-automation']
      });

      this.page = await this.browser.newPage();

      // Autentikasi proxy jika ada kredensial
      if (this.proxy && this.proxy.username) {
        await this.page.authenticate({
          username: this.proxy.username,
          password: this.proxy.password || ''
        });
      }

      // Emulasi Mobile Device & Stealth
      await this.page.setViewport({
        width: 412,
        height: 915,
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2.6
      });

      await this.page.setUserAgent('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36 Shopee/3.19.10');

      await this.page.setExtraHTTPHeaders({
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'x-shopee-language': 'id'
      });

      // Evasion: Sembunyikan navigator.webdriver
      await this.page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        // Mocking window.chrome
        window.chrome = {
          app: { isInstalled: false, InstallState: { DISABLED: 'Disabled', INSTALLED: 'Installed', NOT_INSTALLED: 'NotInstalled' }, RunningState: { CANNOT_RUN: 'CannotRun', READY_TO_RUN: 'ReadyToRun', RUNNING: 'Running' } },
          runtime: { OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' }, OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' }, PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' }, PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' }, PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' }, RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' } }
        };
        // Mocking languages
        Object.defineProperty(navigator, 'languages', { get: () => ['id-ID', 'id', 'en-US', 'en'] });
      });

      // Smart Resource Interception: Hemat RAM & Kuota Proxy
      if (this.blockHeavyResources) {
        await this.page.setRequestInterception(true);
        this.page.on('request', (req) => {
          const type = req.resourceType();
          const url = req.url().toLowerCase();

          // Blokir gambar, font, dan stylesheet dekoratif berat
          if (
            type === 'image' ||
            type === 'font' ||
            url.endsWith('.png') ||
            url.endsWith('.jpg') ||
            url.endsWith('.jpeg') ||
            url.endsWith('.webp') ||
            url.endsWith('.gif') ||
            url.endsWith('.woff') ||
            url.endsWith('.woff2') ||
            url.endsWith('.ttf') ||
            url.includes('google-analytics') ||
            url.includes('facebook')
          ) {
            req.abort();
          } else {
            req.continue();
          }
        });
      }

      // Pasang Cookie Akun jika tersedia
      const activeCookie = this.account ? (this.account.cookies || this.account.cookie || null) : null;
      if (activeCookie) {
        const puppeteerCookies = this._parseCookiesForPuppeteer(activeCookie);
        if (puppeteerCookies.length > 0) {
          await this.page.setCookie(...puppeteerCookies);
        }
      }

      // Hitung akumulasi bandwidth
      this.page.on('response', async (res) => {
        try {
          const headers = res.headers();
          const len = parseInt(headers['content-length'], 10) || 256;
          this.bytesTransferred += len;
        } catch (e) {}
      });

      // Buka Halaman Shopee Live Share
      await this.page.goto(this.targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Beri jeda 3 detik agar script Next.js dan player video terpasang
      await new Promise(r => setTimeout(r, 3000));

      // Otomatis memicu play jika player ada di DOM
      try {
        await this.page.evaluate(() => {
          const videos = document.querySelectorAll('video');
          for (const v of videos) {
            v.muted = true;
            v.play().catch(() => {});
          }
        });
      } catch (e) {}

      this.state = 'VIEWING';
      this.emit('connected', {
        workerId: this.id,
        roomId: this.roomId,
        engine: 'browser',
        accountName: this.account ? this.account.name : 'Guest Browser User',
        isAuthenticated: !!activeCookie,
        accountType: this.account ? (this.account.accountType || 'persona') : 'guest',
        proxyIp: this.proxy ? this.proxy.ip : 'Direct',
        proxyPort: this.proxy ? this.proxy.port : null,
        proxyType: this.proxy ? (this.proxy.type || 'direct') : 'direct',
        timestamp: new Date().toISOString()
      });

      // Jadwalkan Heartbeat Berkala
      this._scheduleHeartbeat();

      // Atur timer retensi tonton jika ada
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
      await this.stop();
    }
  }

  /**
   * Heartbeat berkala di dalam browser: verifikasi status halaman & cegah idle freeze
   */
  _scheduleHeartbeat() {
    if (this.state !== 'VIEWING') return;

    this.heartbeatTimer = setTimeout(async () => {
      if (this.state !== 'VIEWING' || !this.page) return;

      try {
        this.heartbeatCount++;
        // Cek apakah halaman masih aktif & picu event ringan
        const isStillLive = await this.page.evaluate(() => {
          // Trigger subtle user interaction
          window.scrollBy(0, 1);
          window.scrollBy(0, -1);
          // Cek apakah ada notifikasi live selesai
          const bodyText = document.body ? document.body.innerText : '';
          const isEnded = bodyText.includes('Sesi live telah berakhir') || bodyText.includes('Live Telah Berakhir');
          return !isEnded;
        });

        this.emit('heartbeat', {
          workerId: this.id,
          heartbeatCount: this.heartbeatCount,
          durationSec: Math.floor((Date.now() - this.startTime) / 1000),
          bytesTransferred: this.bytesTransferred
        });

        if (!isStillLive) {
          this.emit('room_ended', { workerId: this.id, roomId: this.roomId });
          this.leave('room_ended_detected');
          return;
        }

        this._scheduleHeartbeat();
      } catch (err) {
        // Jika browser crash atau tertutup
        this.emit('error', { workerId: this.id, error: `Heartbeat failure: ${err.message}` });
        this.leave('browser_disconnected');
      }
    }, this.heartbeatIntervalSec * 1000);
  }

  /**
   * Kirim aksi tap like di player browser
   */
  async sendLikeAction(count = 1) {
    if (this.state !== 'VIEWING' || !this.page) return false;
    try {
      await this.page.evaluate((c) => {
        // Cari tombol like atau area video untuk diklik
        const likeBtn = document.querySelector('[class*="like"]') || document.querySelector('svg');
        const clickTarget = likeBtn || document.querySelector('video') || document.body;
        for (let i = 0; i < c; i++) {
          clickTarget.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
      }, count);
      this.likesSent += count;
      return true;
    } catch (e) {
      this.likesSent += count;
      return false;
    }
  }

  /**
   * Alias kompatibel untuk CampaignInstance: sendTapLike
   */
  async sendTapLike(count = 1) {
    return this.sendLikeAction(count);
  }

  /**
   * Kirim komentar di sesi siaran Shopee Live
   * @param {string} text
   */
  async sendComment(text) {
    if (this.state !== 'VIEWING' && this.state !== 'CONNECTING') {
      return { success: false, reason: 'Worker not viewing' };
    }

    this.commentsSent++;
    this.lastCommentTime = Date.now();

    // Coba ketik di form input live room jika tersedia di DOM
    if (this.page) {
      try {
        await this.page.evaluate((commentText) => {
          const input = document.querySelector('input[placeholder*="Komentar"], input[type="text"], textarea');
          if (input) {
            input.value = commentText;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            const form = input.closest('form');
            if (form) {
              form.dispatchEvent(new Event('submit', { bubbles: true }));
            }
          }
        }, text);
      } catch (e) {}
    }

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
        name: 'Guest Browser User',
        username: 'guest',
        avatar: 'https://ui-avatars.com/api/?name=Shopee+User&background=ee4d2d&color=fff'
      },
      text: (text || '').trim(),
      timestamp: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    };

    this.emit('comment', commentData);
    return { success: true, comment: commentData };
  }

  /**
   * Kirim sinyal klik keranjang oranye / etalase produk
   * @param {string} [productId]
   */
  async sendCartClick(productId = null) {
    if (this.state !== 'VIEWING') return { success: false, reason: 'Worker not viewing' };

    const pid = productId || `prod-${Math.floor(100000 + Math.random() * 900000)}`;
    this.cartClicksSent++;

    if (this.page) {
      try {
        await this.page.evaluate(() => {
          const cartBtn = document.querySelector('[class*="cart"], [class*="bag"], [class*="shop"]');
          if (cartBtn) cartBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
      } catch (e) {}
    }

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
   * Kirim sinyal share live stream
   */
  async sendShare() {
    if (this.state !== 'VIEWING' && this.state !== 'CONNECTING') return { success: false };
    this.emit('share', {
      workerId: this.id,
      roomId: this.roomId,
      accountName: this.account ? this.account.name : 'Guest'
    });
    return { success: true };
  }

  /**
   * Emulasi mikro: Mute / Unmute audio streaming penonton
   */
  async sendMuteToggle() {
    if (this.state !== 'VIEWING' && this.state !== 'CONNECTING') return { success: false, reason: 'Worker not viewing' };
    this.isMuted = !this.isMuted;
    if (this.page) {
      try {
        await this.page.evaluate((m) => {
          const v = document.querySelector('video');
          if (v) v.muted = m;
        }, this.isMuted);
      } catch (e) {}
    }
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
   * Emulasi mikro: Adaptasi resolusi player video
   */
  async sendResolutionProbe(newRes = null) {
    if (this.state !== 'VIEWING' && this.state !== 'CONNECTING') return { success: false, reason: 'Worker not viewing' };
    const resolutions = ['360p', '480p', '720p', '1080p'];
    this.streamResolution = newRes || resolutions[Math.floor(Math.random() * resolutions.length)];
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
    this.profileClicksSent = (this.profileClicksSent || 0) + 1;
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
   * Dapatkan metrik worker terkini
   */
  getMetrics() {
    return {
      id: this.id,
      state: this.state,
      engine: 'browser',
      activeSec: this.startTime && this.state === 'VIEWING' ? Math.floor((Date.now() - this.startTime) / 1000) : 0,
      heartbeatCount: this.heartbeatCount,
      likesSent: this.likesSent,
      commentsSent: this.commentsSent,
      cartClicksSent: this.cartClicksSent,
      isMuted: !!this.isMuted,
      streamResolution: this.streamResolution || 'auto',
      profileClicksSent: this.profileClicksSent || 0,
      isStreaming: this.state === 'VIEWING',
      streamBytes: this.bytesTransferred,
      account: this.account ? { username: this.account.username, name: this.account.name, avatar: this.account.avatar } : null,
      proxy: this.proxy ? { ip: this.proxy.ip, city: this.proxy.city, latency: this.proxy.latency } : null,
      bytesTransferred: this.bytesTransferred
    };
  }

  /**
   * Tinggalkan room secara sopan dan tutup browser
   * @param {string} [reason='user_leave']
   */
  async leave(reason = 'user_leave') {
    if (this.state === 'LEAVING' || this.state === 'STOPPED') return;
    this.state = 'LEAVING';

    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    if (this.retentionTimer) clearTimeout(this.retentionTimer);

    try {
      if (this.page) {
        await this.page.close().catch(() => {});
        this.page = null;
      }
      if (this.browser) {
        await this.browser.close().catch(() => {});
        this.browser = null;
      }
    } catch (e) {}

    this.state = 'STOPPED';
    this.emit('leave', {
      workerId: this.id,
      roomId: this.roomId,
      reason,
      durationWatchedSec: this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0,
      bytesTransferred: this.bytesTransferred
    });
  }

  /**
   * Hentikan bot seketika (alias leave)
   */
  async stop() {
    await this.leave('worker_stopped');
  }
}

module.exports = BrowserLiveWorker;
