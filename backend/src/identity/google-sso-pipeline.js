/**
 * Google SSO Pipeline - Shopee Account Auto-Registration & Cookie Harvester
 * Mengorkestrasi otomatisasi login Shopee melalui Google OAuth SSO:
 * 1. 1-Click Interactive Harvester: Membuka browser untuk 1-klik Google Login dan auto-capture cookie SPC_ST.
 * 2. Headless Bulk Batch: Mengotomatisasi antrian akun Google (email, password, recovery email) secara bergiliran.
 * 3. Otomatis menyimpan akun sah ke database SQLite dengan pengikatan proxy residensial.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');
const puppeteer = require('puppeteer-core');
const accountManager = require('./account-manager');
const proxyManager = require('../proxy/proxy-manager');

// Cari path executable Chrome atau Edge lokal
function findBrowserExecutable() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : null,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
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

class GoogleSsoPipeline extends EventEmitter {
  constructor() {
    super();
    this.chromePath = DEFAULT_CHROME_PATH;
    this.activeHarvester = null;
    this.batchQueue = [];
    this.isProcessingBatch = false;
    this.currentBatchStatus = {
      active: false,
      total: 0,
      processed: 0,
      successCount: 0,
      failCount: 0,
      currentAccount: null,
      logs: []
    };
  }

  addBatchLog(level, message) {
    const item = {
      timestamp: new Date().toLocaleTimeString('id-ID'),
      level,
      message
    };
    this.currentBatchStatus.logs.unshift(item);
    if (this.currentBatchStatus.logs.length > 50) this.currentBatchStatus.logs.pop();
    this.emit('batch_log', item);
  }

  /**
   * Helper: Format cookie array Puppeteer menjadi string cookie Shopee
   */
  formatPuppeteerCookies(cookiesArray) {
    if (!Array.isArray(cookiesArray)) return '';
    return cookiesArray.map(c => `${c.name}=${c.value}`).join('; ');
  }

  /**
   * Helper: Ekstrak token esensial Shopee dari string cookie
   */
  parseShopeeTokens(cookieStr) {
    const tokens = {};
    if (!cookieStr || typeof cookieStr !== 'string') return tokens;
    const pairs = cookieStr.split(';').map(p => p.trim());
    for (const pair of pairs) {
      const eq = pair.indexOf('=');
      if (eq !== -1) {
        const key = pair.slice(0, eq).trim();
        const val = pair.slice(eq + 1).trim();
        tokens[key] = val;
      }
    }
    return tokens;
  }

  /**
   * 1-Click Interactive Harvester:
   * Membuka jendela Chrome (non-headless) ke halaman login Shopee.
   * Operator cukup memilih akun Google di browser, dan sistem otomatis menyedot cookie saat login sukses.
   */
  async launchInteractiveHarvester(options = {}) {
    if (this.activeHarvester) {
      return { success: false, message: 'Harvester interaktif sedang berjalan. Selesaikan atau tutup jendela sebelumnya.' };
    }

    if (!this.chromePath) {
      throw new Error('Executable Google Chrome tidak ditemukan di sistem.');
    }

    const proxy = options.proxy || proxyManager.getNextProxy();

    const args = [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1024,800',
      '--lang=id-ID,id'
    ];

    if (proxy && proxy.ip && proxy.port) {
      const proto = (proxy.protocol || 'http').toLowerCase();
      args.push(`--proxy-server=${proto}://${proxy.ip}:${proxy.port}`);
    }

    const browser = await puppeteer.launch({
      executablePath: this.chromePath,
      headless: false, // Menampilkan jendela interaktif bagi operator
      args,
      ignoreDefaultArgs: ['--enable-automation']
    });

    const page = (await browser.pages())[0] || await browser.newPage();

    if (proxy && proxy.username) {
      await page.authenticate({
        username: proxy.username,
        password: proxy.password || ''
      });
    }

    await page.setViewport({ width: 1024, height: 800 });

    this.activeHarvester = {
      browser,
      page,
      startTime: Date.now(),
      status: 'WAITING_USER_LOGIN'
    };

    const targetUrl = 'https://shopee.co.id/buyer/login';
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Polling berkala untuk memeriksa apakah cookie SPC_ST & SPC_U telah terbentuk
    const pollInterval = setInterval(async () => {
      try {
        if (!this.activeHarvester || !this.activeHarvester.page) {
          clearInterval(pollInterval);
          return;
        }

        const cookies = await this.activeHarvester.page.cookies('https://shopee.co.id');
        const cookieStr = this.formatPuppeteerCookies(cookies);
        const tokens = this.parseShopeeTokens(cookieStr);

        // Jika token login Shopee SPC_ST dan SPC_U telah diterbitkan
        if (tokens.SPC_ST && tokens.SPC_U) {
          clearInterval(pollInterval);
          this.activeHarvester.status = 'CAPTURED';

          const userId = tokens.SPC_U;
          const username = tokens.username || `shopee_user_${userId.slice(-6)}`;

          // Ambil nama dari title/profile jika tersedia
          let accountName = 'Pengguna Shopee';
          try {
            const domName = await this.activeHarvester.page.evaluate(() => {
              const el = document.querySelector('.navbar__username') || document.querySelector('[class*="username"]');
              return el ? el.innerText.trim() : null;
            });
            if (domName) accountName = domName;
          } catch (e) {}

          const accountId = `acc-google-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
          const newAccount = {
            id: accountId,
            accountType: 'google_authenticated',
            email: `${username}@gmail.com`,
            username,
            name: accountName,
            gender: 'unknown',
            birthdate: '1995-01-01',
            bio: 'Pengguna Otentik Shopee Live 🛍️',
            city: 'Indonesia',
            avatar: null,
            phoneNumber: '',
            password: '',
            cookies: cookieStr,
            cookieStatus: 'alive',
            lastValidatedAt: new Date().toISOString(),
            assignedProxy: proxy ? {
              id: proxy.id,
              ip: proxy.ip,
              port: proxy.port,
              protocol: proxy.protocol,
              type: proxy.type,
              city: proxy.city
            } : null,
            status: 'ready',
            verified: true,
            totalLiveWatched: 0,
            note: 'Berhasil di-capture via 1-Click Google SSO Harvester',
            createdAt: new Date().toISOString()
          };

          accountManager.addRealRegisteredAccount(newAccount);

          this.emit('harvester_success', {
            success: true,
            account: newAccount
          });

          // Tutup browser setelah 2 detik agar transisi mulus
          setTimeout(async () => {
            try {
              await browser.close();
            } catch (e) {}
            this.activeHarvester = null;
          }, 2000);
        }
      } catch (err) {
        // Browser mungkin ditutup pengguna
        if (err.message.includes('Session closed') || err.message.includes('Target closed')) {
          clearInterval(pollInterval);
          this.activeHarvester = null;
          this.emit('harvester_closed');
        }
      }
    }, 1000);

    return {
      success: true,
      message: 'Jendela Google Login Harvester berhasil dibuka. Silakan klik Google di peramban.',
      targetUrl
    };
  }

  /**
   * Hentikan Harvester interaktif jika sedang aktif
   */
  async closeInteractiveHarvester() {
    if (this.activeHarvester && this.activeHarvester.browser) {
      try {
        await this.activeHarvester.browser.close();
      } catch (e) {}
      this.activeHarvester = null;
    }
    return { success: true };
  }

  /**
   * Autentikasi 1 Akun Google secara Headless / Semi-Headless
   * @param {object} accountInput { email, password, recoveryEmail }
   * @param {object} [options]
   */
  async authenticateSingleGoogleAccount(accountInput, options = {}) {
    if (!accountInput || !accountInput.email || !accountInput.password) {
      throw new Error('Email dan password Google wajib disertakan.');
    }

    if (!this.chromePath) {
      throw new Error('Executable Google Chrome tidak ditemukan di sistem.');
    }

    const { email, password, recoveryEmail } = accountInput;
    const proxy = options.proxy || proxyManager.getNextProxy();

    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-infobars',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,800',
      '--lang=id-ID,id'
    ];

    if (proxy && proxy.ip && proxy.port) {
      const proto = (proxy.protocol || 'http').toLowerCase();
      args.push(`--proxy-server=${proto}://${proxy.ip}:${proxy.port}`);
    }

    const browser = await puppeteer.launch({
      executablePath: this.chromePath,
      headless: options.headless !== false ? 'new' : false,
      args,
      ignoreDefaultArgs: ['--enable-automation']
    });

    try {
      const page = (await browser.pages())[0] || await browser.newPage();

      if (proxy && proxy.username) {
        await page.authenticate({
          username: proxy.username,
          password: proxy.password || ''
        });
      }

      await page.setViewport({ width: 1280, height: 800 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36');

      // Stealth injection
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        window.chrome = {
          app: { isInstalled: false },
          runtime: { OnInstalledReason: {} }
        };
        Object.defineProperty(navigator, 'languages', { get: () => ['id-ID', 'id', 'en-US', 'en'] });
      });

      // 1. Buka Shopee Login Page
      await page.goto('https://shopee.co.id/buyer/login', { waitUntil: 'networkidle2', timeout: 35000 });

      // 2. Siapkan listener targetCreated untuk menangkap popup Google OAuth
      const popupPromise = new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 12000);
        browser.once('targetcreated', async (target) => {
          clearTimeout(timeout);
          const popup = await target.page();
          resolve(popup);
        });
      });

      // 3. Klik tombol Google di halaman login Shopee
      const clicked = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, a, div'));
        const gBtn = btns.find(b => b.innerText && b.innerText.trim() === 'Google');
        if (gBtn) {
          gBtn.click();
          return true;
        }
        return false;
      });

      if (!clicked) {
        throw new Error('Tombol Login Google tidak ditemukan di halaman Shopee.');
      }

      let activePage = await popupPromise;
      if (!activePage) {
        activePage = page;
      }

      // 4. Tunggu input email Google muncul
      await activePage.waitForSelector('input[type="email"]', { timeout: 15000 });
      await activePage.type('input[type="email"]', email, { delay: 60 });
      await activePage.keyboard.press('Enter');

      // 5. Tunggu input password Google muncul
      await new Promise(r => setTimeout(r, 2000));
      await activePage.waitForSelector('input[type="password"]', { visible: true, timeout: 15000 });
      await activePage.type('input[type="password"]', password, { delay: 70 });
      await activePage.keyboard.press('Enter');

      // 6. Cek apakah ada challenge verifikasi recovery email
      await new Promise(r => setTimeout(r, 3000));
      const isRecoveryPrompt = await activePage.evaluate(() => {
        const body = document.body ? document.body.innerText.toLowerCase() : '';
        return body.includes('pemulihan') || body.includes('recovery') || body.includes('konfirmasi email');
      });

      if (isRecoveryPrompt && recoveryEmail) {
        try {
          const recInput = await activePage.$('input[type="email"], input[type="text"]');
          if (recInput) {
            await recInput.type(recoveryEmail, { delay: 50 });
            await activePage.keyboard.press('Enter');
            await new Promise(r => setTimeout(r, 3000));
          }
        } catch (e) {}
      }

      // 7. Tunggu redirect kembali ke shopee.co.id
      let capturedCookies = [];
      const startTime = Date.now();
      while (Date.now() - startTime < 30000) {
        const cookies = await page.cookies('https://shopee.co.id');
        const cookieStr = this.formatPuppeteerCookies(cookies);
        const tokens = this.parseShopeeTokens(cookieStr);
        if (tokens.SPC_ST && tokens.SPC_U) {
          capturedCookies = cookies;
          break;
        }
        await new Promise(r => setTimeout(r, 1000));
      }

      const finalCookieStr = this.formatPuppeteerCookies(capturedCookies);
      const finalTokens = this.parseShopeeTokens(finalCookieStr);

      if (!finalTokens.SPC_ST || !finalTokens.SPC_U) {
        throw new Error('Gagal mengekstrak cookie sesi SPC_ST / SPC_U. Akun mungkin memerlukan verifikasi manual 2FA.');
      }

      const userId = finalTokens.SPC_U;
      const username = email.split('@')[0];

      const accountId = `acc-google-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
      const newAccount = {
        id: accountId,
        accountType: 'google_authenticated',
        email,
        username,
        name: username.replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        gender: 'unknown',
        birthdate: '1995-01-01',
        bio: 'Pengguna Otentik Shopee Live 🛍️',
        city: 'Indonesia',
        avatar: null,
        phoneNumber: '',
        password,
        cookies: finalCookieStr,
        cookieStatus: 'alive',
        lastValidatedAt: new Date().toISOString(),
        assignedProxy: proxy ? {
          id: proxy.id,
          ip: proxy.ip,
          port: proxy.port,
          protocol: proxy.protocol,
          type: proxy.type,
          city: proxy.city
        } : null,
        status: 'ready',
        verified: true,
        totalLiveWatched: 0,
        note: 'Berhasil diotentikasi via Google OAuth SSO Headless',
        createdAt: new Date().toISOString()
      };

      accountManager.addRealRegisteredAccount(newAccount);
      await browser.close();

      return {
        success: true,
        account: newAccount
      };
    } catch (err) {
      await browser.close().catch(() => {});
      throw err;
    }
  }

  /**
   * Parse input teks daftar akun Google (bulk)
   * Format per baris: email:password:recovery_email atau email:password
   */
  parseBulkText(text) {
    if (!text || typeof text !== 'string') return [];
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const result = [];
    for (const line of lines) {
      const parts = line.split(':').map(p => p.trim());
      if (parts.length >= 2 && parts[0].includes('@')) {
        result.push({
          email: parts[0],
          password: parts[1],
          recoveryEmail: parts[2] || null
        });
      }
    }
    return result;
  }

  /**
   * Mulai antrian Bulk Processing untuk banyak akun Google
   */
  async startBulkBatch(accountsList, options = {}) {
    if (this.isProcessingBatch) {
      return { success: false, message: 'Batch Google SSO sedang berjalan. Tunggu hingga selesai.' };
    }

    this.batchQueue = [...accountsList];
    this.isProcessingBatch = true;
    this.currentBatchStatus = {
      active: true,
      total: this.batchQueue.length,
      processed: 0,
      successCount: 0,
      failCount: 0,
      currentAccount: null,
      logs: []
    };

    this.addBatchLog('INFO', `🚀 Memulai antrian Google SSO untuk ${this.batchQueue.length} akun.`);

    // Eksekusi secara background asinkron
    (async () => {
      for (let i = 0; i < this.batchQueue.length; i++) {
        const item = this.batchQueue[i];
        this.currentBatchStatus.currentAccount = item.email;
        this.addBatchLog('INFO', `[${i + 1}/${this.batchQueue.length}] Memproses akun: ${item.email}...`);

        try {
          const res = await this.authenticateSingleGoogleAccount(item, options);
          if (res && res.success) {
            this.currentBatchStatus.successCount++;
            this.addBatchLog('SUCCESS', `✅ Berhasil login & simpan cookie untuk ${item.email}!`);
          }
        } catch (err) {
          this.currentBatchStatus.failCount++;
          this.addBatchLog('WARN', `⚠️ Gagal memproses ${item.email}: ${err.message}`);
        }

        this.currentBatchStatus.processed++;
        // Jeda santai antar akun
        await new Promise(r => setTimeout(r, 3000));
      }

      this.isProcessingBatch = false;
      this.currentBatchStatus.active = false;
      this.currentBatchStatus.currentAccount = null;
      this.addBatchLog('SUCCESS', `🎉 Selesai! Berhasil: ${this.currentBatchStatus.successCount}, Gagal: ${this.currentBatchStatus.failCount}.`);
      this.emit('batch_completed', this.currentBatchStatus);
    })();

    return {
      success: true,
      message: `Batch antrian ${this.batchQueue.length} akun berhasil dimulai di latar belakang.`,
      status: this.currentBatchStatus
    };
  }

  getBatchStatus() {
    return {
      ...this.currentBatchStatus,
      harvesterActive: !!this.activeHarvester
    };
  }
}

const googleSsoPipeline = new GoogleSsoPipeline();
module.exports = googleSsoPipeline;
