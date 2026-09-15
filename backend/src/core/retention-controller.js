/**
 * Retention Controller / Multi-Campaign Manager
 * Mengelola kampanye siaran Shopee Live simultan (multi-session concurrency),
 * memungkinkan menjalankan 3+ akun/toko berbeda secara paralel dengan target 1.000-2.000 bots selama 72 jam.
 */

const EventEmitter = require('events');
const CampaignInstance = require('./campaign-instance');
const proxyManager = require('../proxy/proxy-manager');
const { 
  getAllAccounts, 
  getAvailableCount, 
  getBusyCount, 
  getAccountSummary 
} = require('../identity/account-manager');
const waGateway = require('../wa-gateway/whatsapp-service');
const canaryWatchdog = require('../security/canary-watchdog');
const historyManager = require('../analytics/history-manager');
const streamSentinel = require('./stream-sentinel');
const streamScheduler = require('../scheduler/stream-scheduler');
const sqliteManager = require('../db/sqlite-manager');
const systemTelemetry = require('./system-telemetry');

class MultiCampaignManager extends EventEmitter {
  constructor() {
    super();
    this.campaigns = new Map(); // id -> CampaignInstance
    this.primaryCampaignId = null;
    this.logsBuffer = [];
    this.statsInterval = null;
    this.maxPoolCapacity = 0; // 0 = Bebas / Unlimited Elastic Scaling

    try {
      const sysConf = sqliteManager.getConfig('system');
      if (sysConf && sysConf.maxConcurrentWorkers !== undefined) {
        this.maxPoolCapacity = parseInt(sysConf.maxConcurrentWorkers, 10) || 0;
      }
    } catch (e) {}

    // Mulai polling interval statistik gabungan reguler
    this.startGlobalStatsInterval();

    // Inisialisasi pengawas host offline & penjadwalan
    streamSentinel.start();
    streamScheduler.start();

    // Tangani event host offline dari sentinel
    streamSentinel.on('host_offline', (data) => {
      this.addLog('WARN', `⚠️ Sentinel: Siaran [${data.campaignName}] terdeteksi offline dari sisi host penjual. Melakukan graceful auto-stop.`);
      this.stopCampaignById(data.campaignId, 'HOST_OFFLINE_DETECTED');
      try {
        waGateway.notifyHostOffline(data).catch(() => {});
      } catch (e) {}
    });

    // Tangani event trigger jadwal otomatis
    streamScheduler.on('trigger_schedule', (schedule) => {
      try {
        this.addLog('SUCCESS', `⏰ Smart Scheduler: Memulai otomatis siaran terjadwal [${schedule.title}].`);
        this.createCampaign(schedule.config);
      } catch (err) {
        this.addLog('ERROR', `⏰ Smart Scheduler Gagal: ${err.message}`);
      }
    });
  }

  startGlobalStatsInterval() {
    if (this.statsInterval) clearInterval(this.statsInterval);
    this.statsInterval = setInterval(() => {
      this.emit('stats', this.getMetrics());
    }, 1000);
  }

  addLog(level, message, meta = {}) {
    const logItem = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toLocaleTimeString('id-ID'),
      level, // INFO | SUCCESS | WARN | ERROR | CHURN | MILESTONE
      message,
      meta
    };
    this.logsBuffer.push(logItem);
    if (this.logsBuffer.length > 250) {
      this.logsBuffer.shift();
    }
    this.emit('log', logItem);
  }

  /**
   * Buat dan jalankan kampanye baru (Mendukung Multi-Akun Simultan)
   * @param {object} config
   */
  createCampaign(config = {}) {
    // Validasi Circuit Breaker Canary Watchdog untuk perlindungan akun
    if (canaryWatchdog.circuitBreakerActive && !config.bypassCircuitBreaker) {
      throw new Error('Sistem dalam mode proteksi Circuit Breaker: Terdeteksi perubahan anti-bot / response challenge dari Shopee yang berisiko memblokir akun. Silakan reset Circuit Breaker di menu Keamanan jika ingin tetap melanjutkan.');
    }

    // Validasi Pool Capacity (Jika maxPoolCapacity dikonfigurasi > 0; jika 0 / undefined = Bebas/Unlimited)
    const requestedViewers = Math.max(1, parseInt(config.targetViewers, 10) || 50);
    const currentActive = this.getActiveViewerCount();
    if (this.maxPoolCapacity > 0 && (currentActive + requestedViewers > this.maxPoolCapacity) && !config.bypassCapacityLimit) {
      const remaining = Math.max(0, this.maxPoolCapacity - currentActive);
      throw new Error(`Kapasitas pool tidak mencukupi: Permintaan ${requestedViewers} viewer melebihi sisa kapasitas server (${remaining} dari batas ${this.maxPoolCapacity} bot view).`);
    }

    const campaign = new CampaignInstance(config);

    // Forward events dari campaign instance ke manager
    campaign.on('log', (level, msg, meta) => this.addLog(level, msg, meta));
    campaign.on('milestone', (data) => {
      this.emit('milestone', data);
      try {
        waGateway.notifyMilestone(data);
      } catch (e) {}
    });
    campaign.on('status_change', (data) => {
      this.emit('status_change', { status: this.status, ...data });
      this.emit('campaigns_updated', this.getAllCampaigns());
    });
    campaign.on('campaign_stopped', (data) => {
      this.emit('campaign_stopped', data);
      this.emit('campaigns_updated', this.getAllCampaigns());
      try {
        waGateway.notifyCampaignEnd(data);
      } catch (e) {}
    });
    campaign.on('chat_message', (data) => this.emit('chat_message', data));
    campaign.on('like_burst', (data) => this.emit('like_burst', data));
    campaign.on('cart_click', (data) => this.emit('cart_click', data));

    // Daftarkan kampanye ke Stream Sentinel (pemantau host offline)
    streamSentinel.registerCampaign(campaign);

    // Saat kampanye berhenti: catat ke riwayat persisten, bersihkan state aktif & unregister sentinel
    campaign.on('campaign_stopped', (data) => {
      streamSentinel.unregisterCampaign(data.id);
      try {
        sqliteManager.clearActiveCampaignState(data.id);
      } catch (e) {}
      try {
        historyManager.recordSession(campaign.getMetrics(), data.reason);
      } catch (e) {}
    });

    // Jalankan kampanye terlebih dahulu (validasi ketersediaan akun & roomId)
    campaign.start();

    // Simpan state aktif ke SQLite untuk pemulihan crash otomatis (Zero Downtime)
    try {
      sqliteManager.saveActiveCampaignState({
        id: campaign.id,
        name: campaign.name,
        clientName: campaign.clientName || '',
        roomId: campaign.roomId,
        targetViewers: campaign.targetViewers,
        retentionMode: campaign.retentionMode,
        status: 'RUNNING',
        config,
        startedAt: new Date().toISOString()
      });
    } catch (e) {}

    // Kirim notifikasi WhatsApp saat siaran dimulai
    try {
      waGateway.notifyLiveStart(campaign.getMetrics());
    } catch (e) {}

    this.campaigns.set(campaign.id, campaign);
    this.primaryCampaignId = campaign.id;

    this.emit('campaigns_updated', this.getAllCampaigns());
    this.emit('status_change', { status: this.status, config: campaign.getMetrics() });
    return campaign.getMetrics();
  }

  /**
   * Dapatkan daftar sesi siaran yang terputus (uncompleted) akibat server crash/reboot
   */
  getInterruptedCampaigns() {
    try {
      return sqliteManager.getActiveCampaignStates();
    } catch (e) {
      return [];
    }
  }

  /**
   * Pulihkan sesi siaran yang terputus secara otomatis
   */
  resumeCampaign(campaignState) {
    if (!campaignState || !campaignState.config) return null;
    this.addLog('SUCCESS', `🔄 Crash Recovery: Memulihkan sesi siaran [${campaignState.id}]...`);
    try {
      sqliteManager.clearActiveCampaignState(campaignState.id);
    } catch (e) {}
    return this.createCampaign(campaignState.config);
  }

  /**
   * Backward-compatible: Start single / default campaign
   */
  async startCampaign(campaignConfig = {}) {
    return this.createCampaign(campaignConfig);
  }

  /**
   * Hentikan kampanye tertentu berdasarkan ID
   * @param {string} campaignId
   * @param {string} [reason]
   */
  stopCampaignById(campaignId, reason = 'manual_stop') {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign) {
      return { success: false, message: 'Kampanye tidak ditemukan.' };
    }
    const metrics = campaign.stop(reason);
    this.emit('campaigns_updated', this.getAllCampaigns());
    this.emit('status_change', { status: this.status });
    this.emit('stats', this.getMetrics());
    return { success: true, metrics };
  }

  /**
   * Hentikan seluruh kampanye yang sedang aktif (atau primary)
   */
  async stopCampaign(reason = 'manual_stop') {
    let stoppedCount = 0;
    for (const campaign of this.campaigns.values()) {
      if (campaign.status === 'RUNNING') {
        campaign.stop(reason);
        stoppedCount++;
      }
    }

    this.emit('campaigns_updated', this.getAllCampaigns());
    this.emit('status_change', { status: this.status });
    this.emit('stats', this.getMetrics());

    return {
      success: true,
      status: this.status,
      stoppedCount,
      totalViews: this.getAggregateAccumulatedViews()
    };
  }

  /**
   * Hapus kampanye yang sudah selesai dari daftar
   */
  removeCampaign(campaignId) {
    const campaign = this.campaigns.get(campaignId);
    if (campaign) {
      if (campaign.status === 'RUNNING') {
        campaign.stop('removed');
      }
      this.campaigns.delete(campaignId);
      this.emit('campaigns_updated', this.getAllCampaigns());
      return true;
    }
    return false;
  }

  getAllCampaigns() {
    return Array.from(this.campaigns.values()).map(c => c.getMetrics());
  }

  getActiveCampaigns() {
    return Array.from(this.campaigns.values())
      .filter(c => c.status === 'RUNNING')
      .map(c => c.getMetrics());
  }

  get status() {
    const running = Array.from(this.campaigns.values()).some(c => c.status === 'RUNNING');
    return running ? 'RUNNING' : 'IDLE';
  }

  getActiveViewerCount() {
    let total = 0;
    for (const campaign of this.campaigns.values()) {
      total += campaign.getActiveViewerCount();
    }
    return total;
  }

  getAggregateAccumulatedViews() {
    let total = 0;
    for (const campaign of this.campaigns.values()) {
      total += campaign.accumulatedViews;
    }
    return total;
  }

  getAggregateChurnCount() {
    let total = 0;
    for (const campaign of this.campaigns.values()) {
      total += campaign.totalChurnRotations;
    }
    return total;
  }

  getAggregateBandwidthKb() {
    let total = 0;
    for (const campaign of this.campaigns.values()) {
      total += campaign.getMetrics().bandwidthKb;
    }
    return total;
  }

  getAggregateLikesCount() {
    let total = 0;
    for (const campaign of this.campaigns.values()) {
      total += (campaign.totalLikes || 0);
    }
    return total;
  }

  getAggregateCommentsCount() {
    let total = 0;
    for (const campaign of this.campaigns.values()) {
      total += (campaign.totalComments || 0);
    }
    return total;
  }

  getAggregateCartClicksCount() {
    let total = 0;
    for (const campaign of this.campaigns.values()) {
      total += (campaign.totalCartClicks || 0);
    }
    return total;
  }

  getMetrics() {
    const all = this.getAllCampaigns();
    const primary = this.primaryCampaignId ? this.campaigns.get(this.primaryCampaignId) : null;
    const primaryMetrics = primary ? primary.getMetrics() : {};

    return {
      status: this.status,
      maxCapacity: this.maxPoolCapacity > 0 ? this.maxPoolCapacity : 'Unlimited',
      remainingCapacity: this.maxPoolCapacity > 0 ? Math.max(0, this.maxPoolCapacity - this.getActiveViewerCount()) : 'Unlimited',
      capacityUsagePercent: this.maxPoolCapacity > 0 ? Math.min(100, Math.round((this.getActiveViewerCount() / this.maxPoolCapacity) * 100)) : 0,
      isUnlimitedCapacity: !this.maxPoolCapacity || this.maxPoolCapacity <= 0,
      activeViewers: this.getActiveViewerCount(),
      accumulatedViews: this.getAggregateAccumulatedViews(),
      totalChurnRotations: this.getAggregateChurnCount(),
      bandwidthKb: this.getAggregateBandwidthKb(),
      totalCampaigns: this.campaigns.size,
      activeCampaignCount: this.getActiveCampaigns().length,
      aliveProxies: proxyManager.getAliveProxies().length,
      totalAccounts: getAllAccounts().length,
      availableAccounts: getAvailableCount(),
      busyAccounts: getBusyCount(),
      accountSummary: getAccountSummary(),
      totalLikes: this.getAggregateLikesCount(),
      totalComments: this.getAggregateCommentsCount(),
      totalCartClicks: this.getAggregateCartClicksCount(),
      healthTelemetry: systemTelemetry.getSnapshot(this, proxyManager),
      campaigns: all,
      // Backward-compatible properties with single campaign view
      roomId: primaryMetrics.roomId || '',
      targetViewers: primaryMetrics.targetViewers || 0,
      retentionMode: primaryMetrics.retentionMode || 'dynamic_churn',
      elapsedSec: primaryMetrics.elapsedSec || 0
    };
  }

  /**
   * Ambil daftar komentar/chat terbaru dari seluruh sesi siaran aktif
   */
  getRecentChats() {
    const allChats = [];
    for (const campaign of this.campaigns.values()) {
      if (campaign.recentComments && Array.isArray(campaign.recentComments)) {
        allChats.push(...campaign.recentComments);
      }
    }
    allChats.sort((a, b) => (a.timestamp > b.timestamp ? 1 : -1));
    return allChats.slice(-30);
  }

  updateCampaignInteraction(campaignId, settings) {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign) throw new Error('Sesi kampanye tidak ditemukan.');
    const updated = campaign.updateInteractionSettings(settings);
    this.emit('campaigns_updated', this.getAllCampaigns());
    return updated;
  }

  async sendInstantComment(campaignId, text) {
    const runningCampaigns = Array.from(this.campaigns.values()).filter(c => c.status === 'RUNNING');
    let target = null;
    if (campaignId && campaignId !== 'active') {
      target = this.campaigns.get(campaignId);
    } else {
      target = runningCampaigns[0] || (this.primaryCampaignId ? this.campaigns.get(this.primaryCampaignId) : null);
    }
    if (!target) throw new Error('Tidak ada sesi siaran Shopee Live yang sedang aktif.');
    return target.sendInstantComment(text);
  }

  sendInstantLike(campaignId, taps = 10) {
    const runningCampaigns = Array.from(this.campaigns.values()).filter(c => c.status === 'RUNNING');
    let target = null;
    if (campaignId && campaignId !== 'active') {
      target = this.campaigns.get(campaignId);
    } else {
      target = runningCampaigns[0] || (this.primaryCampaignId ? this.campaigns.get(this.primaryCampaignId) : null);
    }
    if (!target) throw new Error('Tidak ada sesi siaran Shopee Live yang sedang aktif.');
    return target.sendInstantLike(taps);
  }

  async sendInstantCartClick(campaignId, count = 5) {
    const runningCampaigns = Array.from(this.campaigns.values()).filter(c => c.status === 'RUNNING');
    let target = null;
    if (campaignId && campaignId !== 'active') {
      target = this.campaigns.get(campaignId);
    } else {
      target = runningCampaigns[0] || (this.primaryCampaignId ? this.campaigns.get(this.primaryCampaignId) : null);
    }
    if (!target) throw new Error('Tidak ada sesi siaran Shopee Live yang sedang aktif.');
    return target.sendInstantCartClick(count);
  }

  /**
   * Menyesuaikan target penonton secara real-time saat siaran sedang berjalan (Live Scaling)
   * @param {string} campaignId 
   * @param {number} newTarget 
   */
  updateCampaignTargetViewers(campaignId, newTarget) {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign) throw new Error('Sesi siaran tidak ditemukan.');
    const parsedTarget = Math.max(1, parseInt(newTarget, 10));
    const currentViewers = this.getActiveViewerCount();
    const diff = parsedTarget - campaign.targetViewers;
    if (this.maxPoolCapacity > 0 && diff > 0 && (currentViewers + diff > this.maxPoolCapacity)) {
      const remaining = Math.max(0, this.maxPoolCapacity - currentViewers);
      throw new Error(`Kapasitas pool tidak mencukupi: Penambahan ${diff} viewer melebihi sisa kapasitas server (${remaining} dari batas ${this.maxPoolCapacity} bot view).`);
    }
    const result = campaign.updateTargetViewers(parsedTarget);
    this.emit('campaigns_updated', this.getAllCampaigns());
    this.emit('stats', this.getMetrics());
    return result;
  }
}

const multiCampaignManagerInstance = new MultiCampaignManager();

module.exports = multiCampaignManagerInstance;
