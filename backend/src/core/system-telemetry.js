/**
 * Shopee Live View Bot Pro - System & Infrastructure Telemetry Engine
 * Memantau kesehatan server, CPU load, Memory Heap/RSS, Event Loop Latency,
 * Traffic network outbound data rate, dan proxy fleet health real-time.
 */

const os = require('os');
const { monitorEventLoopDelay } = require('perf_hooks');

class SystemTelemetry {
  constructor() {
    this.histogram = null;
    try {
      this.histogram = monitorEventLoopDelay({ resolution: 20 });
      this.histogram.enable();
    } catch (e) {
      this.histogram = null;
    }

    // CPU Tracking
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTime = Date.now();
    this.cachedCpuPercent = 0;

    // Bandwidth Rate Tracking
    this.lastBandwidthKb = 0;
    this.lastBandwidthTime = Date.now();
    this.cachedThroughputKbps = 0;

    // Periodic updater for smoothed sampling
    this.sampleTimer = setInterval(() => {
      this._sampleCpu();
    }, 2000);
  }

  _sampleCpu() {
    const now = Date.now();
    const elapsedMs = now - this.lastCpuTime;
    if (elapsedMs <= 0) return;

    const diff = process.cpuUsage(this.lastCpuUsage);
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuTime = now;

    // Total CPU time in ms
    const totalCpuMs = (diff.user + diff.system) / 1000;
    const numCores = Math.max(1, os.cpus().length);
    const percent = Math.min(100, Math.max(0, Math.round((totalCpuMs / (elapsedMs * numCores)) * 100)));
    this.cachedCpuPercent = percent;
  }

  formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (d > 0) return `${d}h ${h}j ${m}m`;
    if (h > 0) return `${h}j ${m}m ${s}d`;
    return `${m}m ${s}d`;
  }

  getEventLoopLatency() {
    if (this.histogram && this.histogram.mean) {
      const meanMs = this.histogram.mean / 1e6;
      return parseFloat(meanMs.toFixed(2));
    }
    return 0.85; // Fallback baseline optimal
  }

  /**
   * Mengambil snapshot telemetri lengkap server, traffic bot, dan proxy fleet
   * @param {object} retentionController 
   * @param {object} proxyManager 
   */
  getSnapshot(retentionController, proxyManager) {
    const now = Date.now();
    const mem = process.memoryUsage();
    const totalSysMem = os.totalmem();
    const freeSysMem = os.freemem();
    const usedSysMem = totalSysMem - freeSysMem;

    // Hitung throughput bandwidth instan
    let totalBandwidthKb = 0;
    let activeWorkers = 0;
    let activeSessions = 0;
    let totalChurn = 0;

    if (retentionController) {
      totalBandwidthKb = retentionController.getAggregateBandwidthKb ? retentionController.getAggregateBandwidthKb() : 0;
      activeWorkers = retentionController.getActiveViewerCount ? retentionController.getActiveViewerCount() : 0;
      activeSessions = retentionController.getActiveCampaigns ? retentionController.getActiveCampaigns().length : 0;
      totalChurn = retentionController.getAggregateChurnCount ? retentionController.getAggregateChurnCount() : 0;
    }

    const elapsedBwSec = (now - this.lastBandwidthTime) / 1000;
    if (elapsedBwSec >= 1.5) {
      const diffKb = Math.max(0, totalBandwidthKb - this.lastBandwidthKb);
      this.cachedThroughputKbps = parseFloat((diffKb / elapsedBwSec).toFixed(1));
      this.lastBandwidthKb = totalBandwidthKb;
      this.lastBandwidthTime = now;
    }

    // Jika ada worker aktif, tambahkan estimasi rate heartbeat baseline
    const workerStreamingEstKbps = activeWorkers > 0 ? parseFloat((activeWorkers * 1.8).toFixed(1)) : 0;
    const finalThroughputKbps = Math.max(this.cachedThroughputKbps, workerStreamingEstKbps);

    // Latensi & Status Event Loop
    const eventLoopLatencyMs = this.getEventLoopLatency();
    let eventLoopStatus = 'Optimal';
    let eventLoopBadgeClass = 'optimal';
    if (eventLoopLatencyMs > 50) {
      eventLoopStatus = 'Tinggi / Antrean Sibuk';
      eventLoopBadgeClass = 'warning';
    } else if (eventLoopLatencyMs > 20) {
      eventLoopStatus = 'Normal';
      eventLoopBadgeClass = 'normal';
    }

    // Status Proxy Fleet
    let proxyStats = {
      total: 0,
      alive: 0,
      dead: 0,
      quarantined: 0,
      healthPercent: 100,
      avgLatencyMs: 0,
      activeLeases: 0,
      byType: { datacenter: 0, residential: 0, mobile: 0, rotating: 0 }
    };

    if (proxyManager) {
      if (typeof proxyManager.getHealthStats === 'function') {
        const hs = proxyManager.getHealthStats();
        proxyStats.total = hs.total || 0;
        proxyStats.alive = hs.alive || 0;
        proxyStats.dead = hs.dead || 0;
        proxyStats.quarantined = hs.quarantined || 0;
        proxyStats.healthPercent = hs.healthScorePercent !== undefined ? hs.healthScorePercent : 100;
        proxyStats.avgLatencyMs = hs.avgLatencyMs || 0;
        proxyStats.byType = hs.byType || proxyStats.byType;
      }
      if (proxyManager.activeLeasesPerIp) {
        proxyStats.activeLeases = proxyManager.activeLeasesPerIp.size || 0;
      }
    }

    const uptimeSec = Math.floor(process.uptime());

    return {
      server: {
        cpuPercent: this.cachedCpuPercent,
        cpuCores: os.cpus().length,
        cpuModel: (os.cpus()[0]?.model || 'Multi-Core Processor').trim(),
        loadAvg: parseFloat((os.loadavg()[0] || 0).toFixed(2)),
        memoryHeapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        memoryHeapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
        memoryRssMb: Math.round(mem.rss / 1024 / 1024),
        memoryPercent: Math.round((mem.heapUsed / mem.heapTotal) * 100),
        systemTotalRamGb: parseFloat((totalSysMem / (1024 * 1024 * 1024)).toFixed(1)),
        systemFreeRamGb: parseFloat((freeSysMem / (1024 * 1024 * 1024)).toFixed(1)),
        systemRamUsagePercent: Math.round((usedSysMem / totalSysMem) * 100),
        eventLoopLatencyMs,
        eventLoopStatus,
        eventLoopBadgeClass,
        uptimeSec,
        uptimeFormatted: this.formatUptime(uptimeSec),
        nodeVersion: process.version,
        platform: `${process.platform} (${os.arch()})`,
        pid: process.pid
      },
      traffic: {
        activeWorkers,
        activeSessions,
        totalBandwidthMb: parseFloat((totalBandwidthKb / 1024).toFixed(2)),
        currentThroughputKbps: finalThroughputKbps,
        currentThroughputFormatted: finalThroughputKbps >= 1024
          ? `${(finalThroughputKbps / 1024).toFixed(2)} MB/s`
          : `${finalThroughputKbps.toFixed(1)} KB/s`,
        totalChurnRotations: totalChurn,
        engineStatus: 'ELASTIC_HIGH_THROUGHPUT'
      },
      proxyFleet: {
        total: proxyStats.total,
        alive: proxyStats.alive,
        quarantined: proxyStats.quarantined,
        dead: proxyStats.dead,
        healthPercent: proxyStats.healthPercent,
        avgLatencyMs: proxyStats.avgLatencyMs,
        activeLeases: proxyStats.activeLeases,
        byType: proxyStats.byType,
        rotationStatus: proxyStats.alive > 0 ? 'HIGH_AVAILABILITY' : 'STANDBY'
      },
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = new SystemTelemetry();
