/**
 * Stream Sentinel - Host Stream Drop & Offline Watchdog
 * Secara proaktif memantau apakah host live stream Shopee masih aktif mengudara (streaming).
 * Jika siaran diakhiri oleh penjual atau koneksi host terputus, sentinel akan otomatis
 * menghentikan bot secara wajar dan mengembalikan akun ke pool bebas.
 */

const EventEmitter = require('events');

class StreamSentinel extends EventEmitter {
  constructor(options = {}) {
    super();
    this.checkIntervalSec = options.checkIntervalSec || 25;
    this.timer = null;
    this.monitoredCampaigns = new Map(); // campaignId -> { id, roomId, name, failCount, lastStatus }
    this.mockStatusOverrides = new Map(); // campaignId -> status ('ONLINE' | 'OFFLINE')
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.timer = setInterval(() => this.checkAllActiveStreams(), this.checkIntervalSec * 1000);
  }

  stop() {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  registerCampaign(campaign) {
    if (!campaign || !campaign.id) return;
    this.monitoredCampaigns.set(campaign.id, {
      id: campaign.id,
      roomId: campaign.roomId,
      name: campaign.name || `Siaran #${campaign.id.slice(-4)}`,
      failCount: 0,
      lastStatus: 'ONLINE',
      lastChecked: Date.now()
    });
  }

  unregisterCampaign(campaignId) {
    this.monitoredCampaigns.delete(campaignId);
    this.mockStatusOverrides.delete(campaignId);
  }

  setMockStatus(campaignId, status) {
    this.mockStatusOverrides.set(campaignId, status);
  }

  async probeStreamStatus(campaignId, roomId) {
    // Jika ada override status untuk pengujian QA otomatis
    if (this.mockStatusOverrides.has(campaignId)) {
      return this.mockStatusOverrides.get(campaignId);
    }

    // Probe nyata ke API Shopee: cek apakah room masih aktif
    try {
      const { fetchLiveRoomInfo } = require('./protocol-client');
      const result = await fetchLiveRoomInfo(roomId, { timeout: 5000 });

      if (result.success && result.roomData) {
        // Format response baru: roomData.status (1=Live, 2=Ended) + roomData.isTerminate
        if (result.roomData.isTerminate || result.roomData.status === 2 || result.roomData.status === 3) {
          return 'OFFLINE';
        }
        return 'ONLINE';
      }

      // Jika request berhasil tapi tidak ada data room → kemungkinan room tidak ditemukan
      if (result.status === 404 || result.status === 410) {
        return 'OFFLINE';
      }

      // errCode 90309999 = session ended atau auth error
      if (result.errCode === 90309999) {
        return 'UNKNOWN';
      }

      // Network error atau timeout → jangan langsung declare offline
      return 'UNKNOWN';
    } catch (err) {
      return 'UNKNOWN';
    }
  }

  async checkAllActiveStreams() {
    for (const [campaignId, info] of this.monitoredCampaigns.entries()) {
      try {
        const status = await this.probeStreamStatus(campaignId, info.roomId);
        info.lastChecked = Date.now();
        info.lastStatus = status;

        if (status === 'OFFLINE' || status === 'ENDED') {
          info.failCount++;
          // 3x konfirmasi berturut-turut sebelum trigger penghentian (menghindari false positive)
          if (info.failCount >= 3) {
            this.emit('host_offline', {
              campaignId,
              roomId: info.roomId,
              campaignName: info.name,
              reason: 'HOST_OFFLINE_DETECTED',
              consecutiveFailures: info.failCount,
              timestamp: new Date().toISOString()
            });
            this.unregisterCampaign(campaignId);
          }
        } else if (status === 'UNKNOWN') {
          // Network error: hitung setengah kegagalan, jangan langsung offline
          info.failCount += 0.5;
          if (info.failCount >= 5) {
            this.emit('host_offline', {
              campaignId,
              roomId: info.roomId,
              campaignName: info.name,
              reason: 'NETWORK_UNREACHABLE',
              consecutiveFailures: info.failCount,
              timestamp: new Date().toISOString()
            });
            this.unregisterCampaign(campaignId);
          }
        } else {
          // Reset counter saat confirmed ONLINE
          info.failCount = 0;
        }
      } catch (e) {}
    }
  }

  getStatus() {
    return {
      running: this.isRunning,
      monitoredCount: this.monitoredCampaigns.size,
      campaigns: Array.from(this.monitoredCampaigns.values())
    };
  }
}

// Singleton
const streamSentinel = new StreamSentinel();

module.exports = streamSentinel;
