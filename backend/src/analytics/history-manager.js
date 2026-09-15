/**
 * History Manager & Performance Analytics
 * Merekam riwayat sesi kampanye Shopee Live yang telah selesai ke database persisten
 * dan menyediakan fungsi ekspor laporan performa dalam format CSV siap cetak/unduh.
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const sqliteManager = require('../db/sqlite-manager');

const HISTORY_PATH = path.join(__dirname, '../../data/campaign-history.json');

class HistoryManager extends EventEmitter {
  constructor() {
    super();
    this.history = [];
    this.loadHistory();
  }

  loadHistory() {
    try {
      this.history = sqliteManager.getAllHistory();
      if (!this.history || this.history.length === 0) {
        if (fs.existsSync(HISTORY_PATH)) {
          const raw = fs.readFileSync(HISTORY_PATH, 'utf8');
          this.history = JSON.parse(raw || '[]');
          if (this.history.length > 0) {
            for (const h of this.history) {
              sqliteManager.addHistory(h);
            }
          }
        }
      }
    } catch (e) {
      this.history = [];
    }
  }

  saveHistory() {
    try {
      sqliteManager.exportHistorySnapshot();
      return true;
    } catch (e) {
      console.error('Gagal menyimpan campaign-history ke SQLite:', e.message);
      try {
        fs.writeFileSync(HISTORY_PATH, JSON.stringify(this.history, null, 2), 'utf8');
        return true;
      } catch (err) {
        return false;
      }
    }
  }

  recordSession(campaignMetrics = {}, stopReason = 'manual_stop') {
    const elapsedSec = campaignMetrics.elapsedSec || 0;
    const durationMinutes = Math.max(1, Math.round(elapsedSec / 60));

    const record = {
      id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      campaignId: campaignMetrics.id || 'cmp-unknown',
      name: campaignMetrics.name || 'Siaran Shopee Live',
      clientName: campaignMetrics.clientName || campaignMetrics.name || 'Pelanggan Shopee Live',
      roomId: campaignMetrics.roomId || '0',
      startTime: campaignMetrics.startTime 
        ? new Date(campaignMetrics.startTime).toISOString() 
        : new Date(Date.now() - elapsedSec * 1000).toISOString(),
      endTime: new Date().toISOString(),
      durationMinutes,
      peakViewers: campaignMetrics.targetViewers || campaignMetrics.activeViewers || 0,
      accumulatedViews: campaignMetrics.accumulatedViews || 0,
      totalLikes: campaignMetrics.totalLikes || 0,
      totalComments: campaignMetrics.totalComments || 0,
      totalCartClicks: campaignMetrics.totalCartClicks || 0,
      totalChurnRotations: campaignMetrics.totalChurnRotations || 0,
      bandwidthKb: campaignMetrics.bandwidthKb || 0,
      stopReason: stopReason || 'manual_stop',
      createdAt: new Date().toISOString()
    };

    // Tambahkan di urutan paling awal (terbaru di atas)
    this.history.unshift(record);

    // Maksimal simpan 150 riwayat terakhir
    if (this.history.length > 150) {
      this.history = this.history.slice(0, 150);
    }

    try {
      sqliteManager.addHistory(record);
    } catch (e) {}

    this.saveHistory();
    this.emit('history_updated', record);
    return record;
  }

  getAllHistory() {
    return this.history;
  }

  getAll() {
    return this.history;
  }

  getSummary() {
    const totalSessions = this.history.length;
    let totalViews = 0;
    let totalLikes = 0;
    let totalComments = 0;
    let totalCartClicks = 0;
    let totalDurationMin = 0;

    for (const item of this.history) {
      totalViews += item.accumulatedViews || 0;
      totalLikes += item.totalLikes || 0;
      totalComments += item.totalComments || 0;
      totalCartClicks += item.totalCartClicks || 0;
      totalDurationMin += item.durationMinutes || 0;
    }

    return {
      totalSessions,
      totalViews,
      totalLikes,
      totalComments,
      totalCartClicks,
      totalDurationMin,
      averageViewsPerSession: totalSessions > 0 ? Math.round(totalViews / totalSessions) : 0
    };
  }

  deleteItem(id) {
    const initialLen = this.history.length;
    this.history = this.history.filter(item => item.id !== id && item.campaignId !== id);
    if (this.history.length !== initialLen) {
      try {
        sqliteManager.deleteHistory(id);
      } catch (e) {}
      this.saveHistory();
      return true;
    }
    return false;
  }

  clearAll() {
    this.history = [];
    try {
      sqliteManager.clearHistory();
    } catch (e) {}
    this.saveHistory();
    return true;
  }

  exportCsv() {
    const headers = [
      'ID Rekaman',
      'Nama Siaran',
      'Room ID',
      'Waktu Mulai',
      'Waktu Selesai',
      'Durasi (Menit)',
      'Puncak Viewers',
      'Akumulasi Views',
      'Total Likes',
      'Total Komentar',
      'Klik Keranjang Oranye',
      'Rotasi Churn',
      'Alasan Berhenti'
    ];

    const rows = this.history.map(item => {
      const escape = (val) => `"${String(val || '').replace(/"/g, '""')}"`;
      return [
        escape(item.id),
        escape(item.name),
        escape(item.roomId),
        escape(item.startTime ? new Date(item.startTime).toLocaleString('id-ID') : '-'),
        escape(item.endTime ? new Date(item.endTime).toLocaleString('id-ID') : '-'),
        item.durationMinutes || 0,
        item.peakViewers || 0,
        item.accumulatedViews || 0,
        item.totalLikes || 0,
        item.totalComments || 0,
        item.totalCartClicks || 0,
        item.totalChurnRotations || 0,
        escape(item.stopReason)
      ].join(',');
    });

    return [headers.join(','), ...rows].join('\r\n');
  }
}

// Singleton
const historyManager = new HistoryManager();

module.exports = historyManager;
