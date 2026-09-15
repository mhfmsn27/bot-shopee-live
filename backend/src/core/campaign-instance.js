/**
 * Campaign Instance - Individual Shopee Live Stream Session
 * Mengelola 1 sesi siaran live stream secara independen (Room ID, target viewer, masa aktif/retensi, timer 72 jam)
 */

const EventEmitter = require('events');
const ShopeeLiveWorker = require('./shopee-live-worker');
const { parseLiveRoomId } = require('./protocol-client');
const proxyManager = require('../proxy/proxy-manager');
const { 
  getAllAccounts, 
  getAvailableAccounts, 
  claimAccount, 
  releaseAccount, 
  releaseAllForCampaign, 
  incrementAccountWatchCount 
} = require('../identity/account-manager');
const { getGlobalConfig, commentBank } = require('../interaction/interaction-manager');

class CampaignInstance extends EventEmitter {
  constructor(options = {}) {
    super();
    this.id = options.id || `cmp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    this.clientName = (options.clientName || options.storeLabel || options.storeName || '').trim();
    if (this.clientName && !options.name) {
      this.name = this.clientName;
    } else {
      this.name = options.name || (this.clientName ? this.clientName : `Siaran Shopee #${this.id.slice(-4).toUpperCase()}`);
    }
    this.roomId = parseLiveRoomId(options.urlOrRoomId || options.roomId || options.liveUrl || options.shopeeLiveUrl);
    this.rawInputUrl = options.urlOrRoomId || options.roomId || options.liveUrl || options.shopeeLiveUrl || '';
    this.targetViewers = Math.max(1, parseInt(options.targetViewers, 10) || 100);
    this.retentionMode = options.retentionMode || 'dynamic_churn'; // dynamic_churn | fixed_duration | infinite_24h | organic_curve
    this.minWatchMinutes = Math.max(1, parseFloat(options.minWatchMinutes) || 5);
    this.maxWatchMinutes = Math.max(this.minWatchMinutes, parseFloat(options.maxWatchMinutes) || 15);
    this.fixedDurationMinutes = Math.max(1, parseInt(options.fixedDurationMinutes, 10) || 60);
    
    // Durasi total kampanye dalam menit (misal: 72 jam = 4320 menit)
    const durationHours = parseFloat(options.durationHours) || 0;
    this.campaignDurationMinutes = durationHours > 0 
      ? Math.round(durationHours * 60) 
      : (parseInt(options.campaignDurationMinutes, 10) || 0);

    this.rampUpRatePerMin = Math.max(5, parseInt(options.rampUpRatePerMin, 10) || 30);
    this.hybridMode = options.hybridMode !== undefined ? Boolean(options.hybridMode) : true;

    // Lifecycle
    this.status = 'IDLE'; // IDLE | RUNNING | STOPPING | FINISHED
    this.startTime = null;
    this.workers = new Map(); // workerId -> ShopeeLiveWorker
    this.rampUpInterval = null;
    this.campaignTimer = null;
    this.microActionInterval = null;
    this.healthCheckInterval = null;
    this.degradedCycles = 0;
    this.zeroWorkerDurationSec = 0;

    // Metrics
    this.accumulatedViews = 0;
    this.totalChurnRotations = 0;
    this.lastMilestoneNotified = 0;
    this.totalBytes = 0;

    // Interaction Settings (Inherit Global or Override Per-Session)
    const globalInter = getGlobalConfig();
    const userInter = options.interaction || {};

    this.enableLike = userInter.enableLike !== undefined ? Boolean(userInter.enableLike) : Boolean(globalInter.enableLike);
    this.likeRatePerMin = userInter.likeRatePerMin !== undefined 
      ? Math.max(0, parseInt(userInter.likeRatePerMin, 10)) 
      : (options.likeRatePerMin !== undefined ? Math.max(0, parseInt(options.likeRatePerMin, 10)) : globalInter.likeRatePerMin);
    this.enableComment = userInter.enableComment !== undefined ? Boolean(userInter.enableComment) : Boolean(globalInter.enableComment);
    this.commentIntervalSec = userInter.commentIntervalSec !== undefined 
      ? Math.max(5, parseInt(userInter.commentIntervalSec, 10)) 
      : (options.commentIntervalSec !== undefined ? Math.max(5, parseInt(options.commentIntervalSec, 10)) : globalInter.commentIntervalSec);
    this.commentCategory = userInter.commentCategory || options.commentCategory || globalInter.defaultCategory || 'general';
    this.customComments = Array.isArray(userInter.customComments) ? userInter.customComments : (Array.isArray(options.customComments) ? options.customComments : []);

    // Cart / Product Bag Click Settings
    this.enableCartClick = userInter.enableCartClick !== undefined ? Boolean(userInter.enableCartClick) : (globalInter.enableCartClick !== undefined ? Boolean(globalInter.enableCartClick) : true);
    this.cartClickRatePerMin = userInter.cartClickRatePerMin !== undefined 
      ? Math.max(0, parseInt(userInter.cartClickRatePerMin, 10)) 
      : (options.cartClickRatePerMin !== undefined ? Math.max(0, parseInt(options.cartClickRatePerMin, 10)) : (globalInter.cartClickRatePerMin || 15));

    // Interaction Timers & Stats
    this.likeInterval = null;
    this.commentInterval = null;
    this.cartInterval = null;
    this.totalLikes = 0;
    this.totalComments = 0;
    this.totalCartClicks = 0;
    this.recentComments = []; // Max 25 comments: { sender, text, timestamp, avatar }
  }

  start() {
    if (this.status === 'RUNNING') return this;
    if (!this.roomId) throw new Error(`Room ID atau URL Shopee Live tidak valid untuk [${this.name}].`);

    // Zero-Limiter Elastic Scaling: Distribusi puluhan ribu bot view
    const availableAccounts = getAvailableAccounts();
    const anchorCount = Math.min(this.targetViewers, availableAccounts.length);
    const guestCount = Math.max(0, this.targetViewers - anchorCount);

    if (guestCount > 0) {
      this.emit('log', 'INFO', `⚡ Skala Enterprise Aktif [${this.name}]: Target ${this.targetViewers.toLocaleString('id-ID')} Viewers didistribusikan ke ${anchorCount} Anchor Viewers (Akun Ber-Cookie) + ${guestCount.toLocaleString('id-ID')} Persistent Streamers (Multi-Proxy Residential).`);
    } else {
      this.emit('log', 'INFO', `⚡ Skala Dedicated [${this.name}]: Seluruh ${this.targetViewers.toLocaleString('id-ID')} Viewers menggunakan akun terverifikasi.`);
    }

    this.status = 'RUNNING';
    this.startTime = Date.now();
    this.accumulatedViews = 0;
    this.totalChurnRotations = 0;
    this.degradedCycles = 0;
    this.zeroWorkerDurationSec = 0;
    this.workers.clear();

    this.emit('log', 'INFO', `Memulai sesi [${this.name}] - Room ID: ${this.roomId} dengan Target ${this.targetViewers} Viewers.`);

    // Ramp up engine
    this.startRampUpEngine();

    // Micro-Actions & Stealth Emulation Engine
    this.startMicroActionEngine();

    // Health Monitor Aggregate Engine
    this.startHealthMonitorEngine();

    // Interaction engines
    if (this.enableLike) this.startLikeEngine();
    if (this.enableComment) this.startCommentEngine();
    if (this.enableCartClick) this.startCartEngine();

    // Timer total durasi (misal 72 jam)
    if (this.campaignDurationMinutes > 0) {
      const totalMs = this.campaignDurationMinutes * 60 * 1000;
      this.campaignTimer = setTimeout(() => {
        this.emit('log', 'INFO', `Batas durasi kampanye [${this.name}] (${this.campaignDurationMinutes / 60} jam) telah tercapai.`);
        this.stop('duration_reached');
      }, totalMs);
    }

    this.emit('status_change', { id: this.id, status: this.status, campaign: this.getMetrics() });
    return this;
  }

  /**
   * Hitung target penonton organik secara dinamis mengikuti kurva Sigmoid/Poisson
   * dengan fluktuasi alami ±5-8% di sekitar peak
   * @param {number} elapsedMinutes
   */
  calculateOrganicTarget(elapsedMinutes) {
    const rampPeriod = Math.min(10, Math.max(2, this.targetViewers / 30));
    const progress = Math.min(1, elapsedMinutes / rampPeriod);
    const sigmoid = 1 / (1 + Math.exp(-6 * (progress - 0.5)));
    const baseTarget = Math.max(1, Math.round(this.targetViewers * sigmoid));

    if (progress >= 0.9) {
      // Fluktuasi organik alami di sekitar puncak target
      const fluctuationPercent = (Math.sin(Date.now() / 60000) * 0.05) + ((Math.random() - 0.5) * 0.03);
      return Math.max(1, Math.round(this.targetViewers * (1 + fluctuationPercent)));
    }
    return baseTarget;
  }

  startRampUpEngine() {
    if (this.rampUpInterval) clearInterval(this.rampUpInterval);

    const stepSeconds = 2;
    const batchSize = Math.max(1, Math.ceil((this.rampUpRatePerMin / 60) * stepSeconds));

    const doRampStep = () => {
      if (this.status !== 'RUNNING') return;

      const currentCount = this.getActiveViewerCount();
      let effectiveTarget = this.targetViewers;
      if (this.retentionMode === 'organic_curve') {
        const elapsedMinutes = (Date.now() - (this.startTime || Date.now())) / 60000;
        effectiveTarget = this.calculateOrganicTarget(elapsedMinutes);
      }

      const needed = effectiveTarget - currentCount;

      if (needed > 0) {
        const toSpawn = Math.min(needed, batchSize);
        for (let i = 0; i < toSpawn; i++) {
          if (i === 0) {
            this.spawnWorker();
          } else {
            setTimeout(() => {
              if (this.status === 'RUNNING') this.spawnWorker();
            }, i * (Math.floor(Math.random() * 200) + 150));
          }
        }
      }
    };

    // Eksekusi batch pertama secara instan
    doRampStep();
    this.rampUpInterval = setInterval(doRampStep, stepSeconds * 1000);
  }

  spawnWorker() {
    if (this.status !== 'RUNNING') return;
    if (this.getActiveViewerCount() >= this.targetViewers) return;

    // Klaim akun aktif: untuk 25 penonton pertama (Anchor Viewers), prioritaskan akun ber-cookie otentik
    const isAnchorBatch = this.workers.size < 25;
    const account = claimAccount(this.id, this.name, { preferAuthenticated: isAnchorBatch });
    if (!account && !this.hybridMode) {
      // Tidak ada akun yang bebas saat ini pada mode standar, hentikan penambahan worker baru
      return;
    }

    const workerId = `wrk-${Math.random().toString(36).slice(2, 8)}`;

    // Ambil proxy aktif: prioritaskan sticky proxy yang terikat pada akun, rotating gateway, atau alokasi residential
    let proxy = null;
    if (account && account.assignedProxy) {
      proxy = proxyManager.getAll().find(p => p.id === account.assignedProxy.id && p.status !== 'dead') 
        || account.assignedProxy;
    } else {
      const gateway = proxyManager.getRotatingGateway();
      if (gateway) {
        proxy = proxyManager.allocateProxyForWorker(workerId, 'rotating');
      } else {
        proxy = proxyManager.allocateProxyForWorker(workerId, 'residential') || proxyManager.getNextProxy();
      }
    }

    // Hitung masa aktif menonton berdasarkan mode
    let watchDurationMs = null;
    if (this.retentionMode === 'dynamic_churn') {
      const minMs = this.minWatchMinutes * 60 * 1000;
      const maxMs = this.maxWatchMinutes * 60 * 1000;
      watchDurationMs = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
    } else if (this.retentionMode === 'organic_curve') {
      const minMs = this.minWatchMinutes * 60 * 1000;
      const maxMs = this.maxWatchMinutes * 60 * 1000;
      const medianMs = (minMs + maxMs) / 2;
      const variance = (Math.random() - 0.5) * (maxMs - minMs);
      watchDurationMs = Math.max(minMs, Math.round(medianMs + variance));
    } else if (this.retentionMode === 'fixed_duration') {
      watchDurationMs = this.fixedDurationMinutes * 60 * 1000;
    } // infinite_24h = null (nonstop)

    // Anti-Detection: Interval heartbeat natural 25-35 detik (dengan random jitter)
    const naturalHeartbeatInterval = Math.floor(Math.random() * 11) + 25;
    const worker = new ShopeeLiveWorker({
      id: workerId,
      roomId: this.roomId,
      account,
      proxy,
      watchDurationMs,
      heartbeatIntervalSec: this.heartbeatIntervalSec || naturalHeartbeatInterval
    });

    this.workers.set(worker.id, worker);
    this.accumulatedViews++;

    worker.on('connected', (data) => {
      if (account) incrementAccountWatchCount(account.id);
      this.checkMilestone();
    });

    worker.on('retention_expired', (data) => {
      this.totalChurnRotations++;
      if (this.status === 'RUNNING' && (this.retentionMode === 'dynamic_churn' || this.retentionMode === 'organic_curve')) {
        setTimeout(() => this.spawnWorker(), Math.floor(Math.random() * 2000) + 500);
      }
    });

    worker.on('room_ended', (data) => {
      if (this.status === 'RUNNING') {
        this.emit('log', 'INFO', `🏁 Sesi siaran live [${this.name}] telah selesai/diakhiri oleh streamer Shopee.`);
        this.stop('stream_ended_by_host');
      }
    });

    worker.on('leave', (data) => {
      if (account) releaseAccount(account.id);
      proxyManager.releaseWorkerProxy(worker.id);
      this.totalBytes += worker.bytesTransferred;
      this.workers.delete(worker.id);
    });

    worker.on('error', (err) => {
      if (account) releaseAccount(account.id);
      proxyManager.releaseWorkerProxy(worker.id);
      if (proxy) proxyManager.reportFailure(proxy.id);
      this.workers.delete(worker.id);
      if (this.status === 'RUNNING') {
        setTimeout(() => this.spawnWorker(), 2000);
      }
    });

    worker.start();
  }

  /**
   * Engine simulasi micro-actions penonton nyata secara probabilistik
   */
  startMicroActionEngine() {
    if (this.microActionInterval) clearInterval(this.microActionInterval);

    this.microActionInterval = setInterval(async () => {
      if (this.status !== 'RUNNING' || this.workers.size === 0) return;

      const activeWorkers = Array.from(this.workers.values()).filter(w => w.state === 'VIEWING');
      if (activeWorkers.length === 0) return;

      // 1. Mute toggle (probabilitas 20%)
      if (Math.random() < 0.20) {
        const randomWorker = activeWorkers[Math.floor(Math.random() * activeWorkers.length)];
        try { await randomWorker.sendMuteToggle(); } catch (e) {}
      }

      // 2. Resolution adaptive probe (probabilitas 15%)
      if (Math.random() < 0.15) {
        const randomWorker = activeWorkers[Math.floor(Math.random() * activeWorkers.length)];
        try { await randomWorker.sendResolutionProbe(); } catch (e) {}
      }

      // 3. Profile streamer click (probabilitas 10%)
      if (Math.random() < 0.10) {
        const randomWorker = activeWorkers[Math.floor(Math.random() * activeWorkers.length)];
        try { await randomWorker.sendProfileClick(); } catch (e) {}
      }
    }, 4000);
  }

  checkMilestone() {
    const count = this.accumulatedViews;
    const milestones = [50, 100, 250, 500, 1000, 2500, 5000, 10000];
    const hit = milestones.find(m => m <= count && m > this.lastMilestoneNotified);
    if (hit) {
      this.lastMilestoneNotified = hit;
      this.emit('log', 'MILESTONE', `🎉 [${this.name}] Mencapai ${hit} akumulasi tayangan Shopee Live!`);
      this.emit('milestone', { campaignId: this.id, campaignName: this.name, count: hit, roomId: this.roomId });
    }
  }

  getActiveViewerCount() {
    let count = 0;
    for (const worker of this.workers.values()) {
      if (worker.state === 'VIEWING' || worker.state === 'CONNECTING') count++;
    }
    return count;
  }

  /**
   * Health Monitor Aggregate Engine
   * Memonitor rasio worker aktif vs target setiap 30 detik untuk mendeteksi network failure masif,
   * proxy drop, atau pemblokiran WAF. Memberikan peringatan dini dan auto-stop jika seluruh worker mati.
   */
  startHealthMonitorEngine() {
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);

    this.healthCheckInterval = setInterval(() => {
      if (this.status !== 'RUNNING') return;

      const activeViewers = this.getActiveViewerCount();
      const target = this.targetViewers || 1;
      const activeRatio = activeViewers / target;

      // 1. Deteksi kondisi degraded (< 30% worker aktif)
      if (activeRatio < 0.30 && this.accumulatedViews > 0) {
        this.degradedCycles++;
        // 4 siklus berturut-turut (2 menit) dalam kondisi degraded
        if (this.degradedCycles >= 4) {
          const warnMsg = `⚠️ [${this.name}] Performa siaran degraded: Hanya ${activeViewers}/${target} (${Math.round(activeRatio * 100)}%) worker aktif selama >2 menit. Memicu auto-recovery penambahan worker.`;
          this.emit('log', 'WARN', warnMsg);
          this.emit('campaign_degraded', {
            campaignId: this.id,
            campaignName: this.name,
            activeViewers,
            targetViewers: target,
            ratio: activeRatio,
            timestamp: new Date().toISOString()
          });

          // Pemicu auto-recovery: jalankan ramp-up step untuk mengisi kekurangan worker
          this.startRampUpEngine();
        }
      } else {
        this.degradedCycles = 0;
      }

      // 2. Deteksi kondisi seluruh worker mati (0 worker aktif selama > 3 menit)
      if (activeViewers === 0 && this.accumulatedViews > 0) {
        this.zeroWorkerDurationSec += 30;
        if (this.zeroWorkerDurationSec >= 180) {
          this.emit('log', 'ERROR', `🛑 [${this.name}] Seluruh worker terputus (0 penonton aktif) selama >3 menit. Melakukan auto-stop proteksi kampanye.`);
          this.emit('campaign_critical_failure', {
            campaignId: this.id,
            campaignName: this.name,
            reason: 'all_workers_dead',
            timestamp: new Date().toISOString()
          });
          this.stop('all_workers_dead');
        }
      } else {
        this.zeroWorkerDurationSec = 0;
      }
    }, 30000);
  }

  stop(reason = 'manual_stop') {
    if (this.status === 'IDLE' || this.status === 'FINISHED') return this.getMetrics();

    this.status = 'STOPPING';
    this.emit('log', 'WARN', `Menghentikan sesi [${this.name}] (Alasan: ${reason}).`);

    if (this.rampUpInterval) {
      clearInterval(this.rampUpInterval);
      this.rampUpInterval = null;
    }
    if (this.campaignTimer) {
      clearTimeout(this.campaignTimer);
      this.campaignTimer = null;
    }
    if (this.microActionInterval) {
      clearInterval(this.microActionInterval);
      this.microActionInterval = null;
    }
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    if (this.likeInterval) {
      clearInterval(this.likeInterval);
      this.likeInterval = null;
    }
    if (this.commentInterval) {
      clearTimeout(this.commentInterval);
      this.commentInterval = null;
    }
    if (this.cartInterval) {
      clearInterval(this.cartInterval);
      this.cartInterval = null;
    }

    const workerArray = Array.from(this.workers.values());
    for (const worker of workerArray) {
      try {
        worker.stop();
        worker.leave(reason);
      } catch (e) {}
    }
    this.workers.clear();

    // Lepaskan seluruh akun yang diklaim oleh sesi siaran ini kembali ke pool
    releaseAllForCampaign(this.id);

    // Bersihkan memori riwayat chat anti-duplikat sesi ini
    if (commentBank && typeof commentBank.clearSessionHistory === 'function') {
      commentBank.clearSessionHistory(this.id);
    }

    this.status = 'IDLE';
    this.emit('log', 'INFO', `Sesi [${this.name}] dihentikan. Total Views: ${this.accumulatedViews}, Churn: ${this.totalChurnRotations}x.`);
    this.emit('status_change', { id: this.id, status: this.status, campaign: this.getMetrics() });
    this.emit('campaign_stopped', {
      id: this.id,
      name: this.name,
      reason,
      totalViews: this.accumulatedViews,
      churn: this.totalChurnRotations,
      elapsedSec: this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0
    });

    return this.getMetrics();
  }

  getMetrics() {
    const elapsedSec = this.startTime && this.status === 'RUNNING'
      ? Math.floor((Date.now() - this.startTime) / 1000)
      : 0;

    let totalBytes = this.totalBytes;
    for (const worker of this.workers.values()) {
      totalBytes += worker.bytesTransferred;
    }

    // Hitung sisa waktu jika ada batas durasi
    let remainingSec = null;
    if (this.campaignDurationMinutes > 0 && this.startTime) {
      const totalSec = this.campaignDurationMinutes * 60;
      remainingSec = Math.max(0, totalSec - elapsedSec);
    }

    return {
      id: this.id,
      name: this.name,
      clientName: this.clientName || this.name,
      roomId: this.roomId,
      rawInputUrl: this.rawInputUrl,
      targetViewers: this.targetViewers,
      hybridMode: this.hybridMode,
      activeViewers: this.getActiveViewerCount(),
      accumulatedViews: this.accumulatedViews,
      totalChurnRotations: this.totalChurnRotations,
      retentionMode: this.retentionMode,
      campaignDurationMinutes: this.campaignDurationMinutes,
      status: this.status,
      elapsedSec,
      remainingSec,
      bandwidthKb: Math.round(totalBytes / 1024),
      healthStatus: this.zeroWorkerDurationSec >= 60 ? 'critical' : (this.degradedCycles >= 4 ? 'degraded' : 'healthy'),
      activeRatio: Math.round((this.getActiveViewerCount() / (this.targetViewers || 1)) * 100),
      // Interaction Metrics
      totalLikes: this.totalLikes,
      totalComments: this.totalComments,
      totalCartClicks: this.totalCartClicks,
      interaction: {
        enableLike: this.enableLike,
        likeRatePerMin: this.likeRatePerMin,
        enableComment: this.enableComment,
        commentIntervalSec: this.commentIntervalSec,
        commentCategory: this.commentCategory,
        customCommentsCount: this.customComments.length,
        enableCartClick: this.enableCartClick,
        cartClickRatePerMin: this.cartClickRatePerMin
      },
      recentComments: this.recentComments.slice(-15)
    };
  }

  /**
   * Mengubah target viewers secara dinamis saat siaran sedang berlangsung (Scale Up / Scale Down)
   * @param {number} newTarget
   */
  updateTargetViewers(newTarget) {
    const parsed = Math.max(1, parseInt(newTarget, 10));
    const oldTarget = this.targetViewers;
    this.targetViewers = parsed;

    this.emit('log', 'INFO', `🎚️ Skala Penonton [${this.name}]: Target diubah dari ${oldTarget} menjadi ${parsed} viewers.`);

    if (parsed < oldTarget) {
      // Scale Down: kurangi worker penonton secara bertahap dan alami
      const excess = this.getActiveViewerCount() - parsed;
      if (excess > 0) {
        this.gracefulScaleDown(excess);
      }
    } else if (parsed > oldTarget && this.status === 'RUNNING') {
      // Scale Up: picu penambahan worker awal
      const need = Math.min(parsed - this.getActiveViewerCount(), 10);
      for (let i = 0; i < need; i++) {
        setTimeout(() => this.spawnWorker(), i * 350);
      }
    }

    this.emit('status_change', { id: this.id, status: this.status, campaign: this.getMetrics() });
    return {
      success: true,
      oldTarget,
      newTarget: parsed,
      activeViewers: this.getActiveViewerCount()
    };
  }

  /**
   * Mengurangi penonton aktif secara halus bertahap agar grafik Shopee tidak anjlok seketika
   * @param {number} count
   */
  gracefulScaleDown(count) {
    const viewingWorkers = Array.from(this.workers.values()).filter(w => w.state === 'VIEWING');
    const toRemove = Math.min(count, viewingWorkers.length);
    if (toRemove <= 0) return;

    const selected = viewingWorkers.slice(0, toRemove);
    selected.forEach((worker, idx) => {
      setTimeout(() => {
        try {
          worker.leave('scaled_down');
        } catch (e) {}
      }, idx * 600);
    });
  }

  // =========================================================================
  // INTERACTION ENGINE METHODS (TAP-TAP LIKE, AUTO-CHAT, INSTANT ACTIONS)
  // =========================================================================

  startLikeEngine() {
    if (this.likeInterval) {
      clearInterval(this.likeInterval);
      this.likeInterval = null;
    }
    if (!this.enableLike || this.likeRatePerMin <= 0) return;

    const stepSeconds = 3;
    const targetLikesPerStep = Math.max(1, Math.round((this.likeRatePerMin / 60) * stepSeconds));

    this.likeInterval = setInterval(() => {
      if (this.status !== 'RUNNING' || !this.enableLike) return;
      const viewingWorkers = Array.from(this.workers.values()).filter(w => w.state === 'VIEWING');
      if (viewingWorkers.length === 0) return;

      const pickCount = Math.min(viewingWorkers.length, Math.floor(Math.random() * 3) + 1);
      const shuffled = viewingWorkers.sort(() => 0.5 - Math.random());

      let burstTotal = 0;
      for (let i = 0; i < pickCount; i++) {
        const worker = shuffled[i];
        const taps = Math.max(1, Math.round(targetLikesPerStep / pickCount));
        worker.sendTapLike(taps);
        burstTotal += taps;
      }

      this.totalLikes += burstTotal;
      this.emit('like_burst', {
        campaignId: this.id,
        campaignName: this.name,
        taps: burstTotal,
        totalLikes: this.totalLikes
      });
    }, stepSeconds * 1000);
  }

  startCommentEngine() {
    if (this.commentInterval) {
      clearTimeout(this.commentInterval);
      this.commentInterval = null;
    }
    if (!this.enableComment || this.commentIntervalSec <= 0) return;

    const scheduleNextComment = () => {
      if (this.status !== 'RUNNING' || !this.enableComment) return;

      const jitter = (Math.random() * 0.6 - 0.3) * this.commentIntervalSec;
      const nextDelayMs = Math.max(5, (this.commentIntervalSec + jitter)) * 1000;

      this.commentInterval = setTimeout(async () => {
        if (this.status !== 'RUNNING' || !this.enableComment) return;

        try {
          const viewingWorkers = Array.from(this.workers.values()).filter(w => w.state === 'VIEWING');
          if (viewingWorkers.length > 0) {
            // Prioritaskan akun ber-cookie otentik (Anchor Viewers) karena hanya akun resmi yang diizinkan chat oleh Shopee
            const authCandidates = viewingWorkers.filter(w => w.account && w.account.cookies && w.account.status === 'ready');
            const targetPool = authCandidates.length > 0 ? authCandidates : viewingWorkers;

            const now = Date.now();
            let candidates = targetPool.filter(w => (now - w.lastCommentTime) > 20000);
            if (candidates.length === 0) candidates = targetPool;

            const selectedWorker = candidates[Math.floor(Math.random() * candidates.length)];
            const text = commentBank.generateNaturalComment(this.commentCategory, this.customComments, this.id);

            const result = await selectedWorker.sendComment(text);
            if (result.success && result.comment) {
              this.totalComments++;
              const chatItem = {
                id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                campaignId: this.id,
                campaignName: this.name,
                sender: result.comment.account.name,
                username: result.comment.account.username,
                avatar: result.comment.account.avatar,
                text: result.comment.text,
                timestamp: result.comment.timestamp
              };

              this.recentComments.push(chatItem);
              if (this.recentComments.length > 25) this.recentComments.shift();

              this.emit('chat_message', chatItem);
              this.emit('log', 'INFO', `💬 [${this.name}] Chat: "${chatItem.text}" (@${chatItem.username})`);
            }
          }
        } catch (e) {}

        scheduleNextComment();
      }, nextDelayMs);
    };

    scheduleNextComment();
  }

  async sendInstantComment(customText) {
    let viewingWorkers = Array.from(this.workers.values()).filter(w => w.state === 'VIEWING');
    if (viewingWorkers.length === 0) {
      viewingWorkers = Array.from(this.workers.values()).filter(w => w.state === 'CONNECTING');
    }
    if (viewingWorkers.length === 0) {
      throw new Error(`Belum ada bot penonton aktif di siaran [${this.name}] untuk mengirim chat.`);
    }

    // Prioritaskan akun ber-cookie otentik
    const authWorkers = viewingWorkers.filter(w => w.account && w.account.cookies && w.account.status === 'ready');
    const targetPool = authWorkers.length > 0 ? authWorkers : viewingWorkers;
    const selectedWorker = targetPool[Math.floor(Math.random() * targetPool.length)];
    const text = (customText && customText.trim()) 
      ? customText.trim() 
      : commentBank.generateNaturalComment(this.commentCategory, this.customComments, this.id);

    const res = await selectedWorker.sendComment(text);
    if (res.success && res.comment) {
      this.totalComments++;
      const chatItem = {
        id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        campaignId: this.id,
        campaignName: this.name,
        sender: (res.comment.account && res.comment.account.name) || (res.comment.account && res.comment.account.username) || 'Pengguna Shopee',
        username: (res.comment.account && res.comment.account.username) || 'shopee_user',
        avatar: (res.comment.account && res.comment.account.avatar) || null,
        text: res.comment.text,
        timestamp: res.comment.timestamp,
        isManual: true
      };
      this.recentComments.push(chatItem);
      if (this.recentComments.length > 25) this.recentComments.shift();
      this.emit('chat_message', chatItem);
      this.emit('log', 'INFO', `💬 [${this.name}] Chat Instan: "${chatItem.text}" (@${chatItem.username})`);
      return chatItem;
    }
    return null;
  }

  sendInstantLike(taps = 10) {
    let viewingWorkers = Array.from(this.workers.values()).filter(w => w.state === 'VIEWING');
    if (viewingWorkers.length === 0) {
      viewingWorkers = Array.from(this.workers.values()).filter(w => w.state === 'CONNECTING');
    }
    if (viewingWorkers.length === 0) {
      throw new Error(`Belum ada bot penonton aktif di siaran [${this.name}] untuk mengirim like.`);
    }
    const count = Math.max(1, parseInt(taps, 10) || 10);
    const worker = viewingWorkers[Math.floor(Math.random() * viewingWorkers.length)];
    worker.sendTapLike(count);
    this.totalLikes += count;
    this.emit('like_burst', {
      campaignId: this.id,
      campaignName: this.name,
      taps: count,
      totalLikes: this.totalLikes
    });
    return { success: true, taps: count, totalLikes: this.totalLikes };
  }

  startCartEngine() {
    if (this.cartInterval) {
      clearInterval(this.cartInterval);
      this.cartInterval = null;
    }
    if (!this.enableCartClick || this.cartClickRatePerMin <= 0) return;

    const stepSeconds = 4;
    const targetClicksPerStep = Math.max(1, Math.round((this.cartClickRatePerMin / 60) * stepSeconds));

    this.cartInterval = setInterval(async () => {
      if (this.status !== 'RUNNING' || !this.enableCartClick) return;
      let viewingWorkers = Array.from(this.workers.values()).filter(w => w.state === 'VIEWING');
      if (viewingWorkers.length === 0) {
        viewingWorkers = Array.from(this.workers.values()).filter(w => w.state === 'CONNECTING');
      }
      if (viewingWorkers.length === 0) return;

      const pickCount = Math.min(viewingWorkers.length, Math.floor(Math.random() * 2) + 1);
      const shuffled = viewingWorkers.sort(() => 0.5 - Math.random());

      let clicksTotal = 0;
      for (let i = 0; i < pickCount; i++) {
        const worker = shuffled[i];
        await worker.sendCartClick();
        clicksTotal++;
      }

      this.totalCartClicks += clicksTotal;
      this.emit('cart_click', {
        campaignId: this.id,
        campaignName: this.name,
        clicks: clicksTotal,
        totalCartClicks: this.totalCartClicks
      });
    }, stepSeconds * 1000);
  }

  async sendInstantCartClick(count = 5) {
    let viewingWorkers = Array.from(this.workers.values()).filter(w => w.state === 'VIEWING');
    if (viewingWorkers.length === 0) {
      viewingWorkers = Array.from(this.workers.values()).filter(w => w.state === 'CONNECTING');
    }
    if (viewingWorkers.length === 0) {
      throw new Error(`Belum ada bot penonton aktif di siaran [${this.name}] untuk simulasi klik keranjang.`);
    }
    const safeCount = Math.max(1, parseInt(count, 10) || 5);
    for (let i = 0; i < safeCount; i++) {
      const worker = viewingWorkers[Math.floor(Math.random() * viewingWorkers.length)];
      await worker.sendCartClick();
    }
    this.totalCartClicks += safeCount;
    this.emit('cart_click', {
      campaignId: this.id,
      campaignName: this.name,
      clicks: safeCount,
      totalCartClicks: this.totalCartClicks,
      isManual: true
    });
    this.emit('log', 'INFO', `🛒 [${this.name}] Simulasi ${safeCount}x Klik Keranjang Oranye (Bag Click) terkirim.`);
    return { success: true, clicks: safeCount, totalCartClicks: this.totalCartClicks };
  }

  updateInteractionSettings(settings = {}) {
    if (settings.enableLike !== undefined) this.enableLike = Boolean(settings.enableLike);
    if (settings.likeRatePerMin !== undefined) this.likeRatePerMin = Math.max(0, parseInt(settings.likeRatePerMin, 10) || 0);
    if (settings.enableComment !== undefined) this.enableComment = Boolean(settings.enableComment);
    if (settings.commentIntervalSec !== undefined) this.commentIntervalSec = Math.max(5, parseInt(settings.commentIntervalSec, 10) || 15);
    if (settings.commentCategory !== undefined) this.commentCategory = settings.commentCategory;
    if (Array.isArray(settings.customComments)) this.customComments = settings.customComments;
    if (settings.enableCartClick !== undefined) this.enableCartClick = Boolean(settings.enableCartClick);
    if (settings.cartClickRatePerMin !== undefined) this.cartClickRatePerMin = Math.max(0, parseInt(settings.cartClickRatePerMin, 10) || 0);

    // Refresh engine
    if (this.status === 'RUNNING') {
      this.startLikeEngine();
      this.startCommentEngine();
      this.startCartEngine();
    }

    this.emit('log', 'INFO', `⚙️ [${this.name}] Setelan interaksi diupdate (Like: ${this.enableLike ? 'ON' : 'OFF'}, Chat: ${this.enableComment ? 'ON' : 'OFF'}, Cart: ${this.enableCartClick ? 'ON' : 'OFF'}).`);
    return this.getMetrics();
  }
}

module.exports = CampaignInstance;
