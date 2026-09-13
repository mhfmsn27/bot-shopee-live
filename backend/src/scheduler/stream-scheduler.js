/**
 * Smart Scheduler - Automated Shopee Live Stream Scheduler
 * Menjadwalkan sesi live stream otomatis berdasarkan jam dan hari yang ditentukan pengguna,
 * memulai bot secara mandiri saat waktu tiba tanpa perlu intervensi manual.
 */

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const sqliteManager = require('../db/sqlite-manager');

const SCHEDULES_PATH = path.join(__dirname, '../../data/schedules.json');

class StreamScheduler extends EventEmitter {
  constructor() {
    super();
    this.schedules = [];
    this.checkInterval = null;
    this.isRunning = false;
    this.loadSchedules();
  }

  loadSchedules() {
    try {
      this.schedules = sqliteManager.getAllSchedules();
      if (!this.schedules || this.schedules.length === 0) {
        if (fs.existsSync(SCHEDULES_PATH)) {
          const raw = fs.readFileSync(SCHEDULES_PATH, 'utf8');
          this.schedules = JSON.parse(raw || '[]');
          if (this.schedules.length > 0) {
            for (const s of this.schedules) {
              sqliteManager.saveSchedule(s);
            }
          }
        }
      }
    } catch (e) {
      this.schedules = [];
    }
  }

  saveSchedules() {
    try {
      for (const s of this.schedules) {
        try { sqliteManager.saveSchedule(s); } catch (e) {}
      }
      sqliteManager.exportSchedulesSnapshot();
      return true;
    } catch (e) {
      console.error('Gagal menyimpan schedules ke SQLite:', e.message);
      try {
        fs.writeFileSync(SCHEDULES_PATH, JSON.stringify(this.schedules, null, 2), 'utf8');
        return true;
      } catch (err) {
        return false;
      }
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    // Cek jadwal tiap 10 detik
    this.checkInterval = setInterval(() => this.evaluateSchedules(), 10000);
  }

  stop() {
    this.isRunning = false;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  createSchedule(data = {}) {
    const id = `sch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const newSchedule = {
      id,
      title: data.title || `Jadwal Live #${id.slice(-4)}`,
      liveUrl: data.liveUrl || data.urlOrRoomId || '',
      targetViewers: Math.max(1, parseInt(data.targetViewers, 10) || 50),
      durationMinutes: Math.max(5, parseInt(data.durationMinutes, 10) || 60),
      retentionMode: data.retentionMode || 'dynamic_churn',
      scheduledTime: data.scheduledTime || '20:00', // Format HH:mm
      daysOfWeek: Array.isArray(data.daysOfWeek) ? data.daysOfWeek : [1, 2, 3, 4, 5, 6, 7], // 1=Senin s/d 7=Minggu
      enabled: data.enabled !== undefined ? Boolean(data.enabled) : true,
      interaction: {
        enableLike: data.enableLike !== undefined ? Boolean(data.enableLike) : true,
        likeRatePerMin: Math.max(0, parseInt(data.likeRatePerMin, 10) || 60),
        enableComment: data.enableComment !== undefined ? Boolean(data.enableComment) : true,
        commentIntervalSec: Math.max(5, parseInt(data.commentIntervalSec, 10) || 20),
        commentCategory: data.commentCategory || 'general',
        enableCartClick: data.enableCartClick !== undefined ? Boolean(data.enableCartClick) : true,
        cartClickRatePerMin: Math.max(0, parseInt(data.cartClickRatePerMin, 10) || 15)
      },
      lastTriggeredDate: null,
      createdAt: new Date().toISOString()
    };

    this.schedules.push(newSchedule);
    this.saveSchedules();
    this.emit('schedules_updated', this.schedules);
    return newSchedule;
  }

  toggleSchedule(id, enabled) {
    const item = this.schedules.find(s => s.id === id);
    if (!item) return false;
    item.enabled = enabled !== undefined ? Boolean(enabled) : !item.enabled;
    this.saveSchedules();
    this.emit('schedules_updated', this.schedules);
    return item;
  }

  deleteSchedule(id) {
    const prevLen = this.schedules.length;
    this.schedules = this.schedules.filter(s => s.id !== id);
    if (this.schedules.length !== prevLen) {
      try { sqliteManager.deleteSchedule(id); } catch (e) {}
      this.saveSchedules();
      this.emit('schedules_updated', this.schedules);
      return true;
    }
    return false;
  }

  getAllSchedules() {
    return this.schedules;
  }

  evaluateSchedules() {
    const now = new Date();
    const currentHours = String(now.getHours()).padStart(2, '0');
    const currentMinutes = String(now.getMinutes()).padStart(2, '0');
    const currentTimeStr = `${currentHours}:${currentMinutes}`;
    
    // Day of week: 1=Senin, 7=Minggu
    let currentDay = now.getDay();
    if (currentDay === 0) currentDay = 7; // Sunday = 7

    const todayDateStr = now.toISOString().slice(0, 10);

    for (const schedule of this.schedules) {
      if (!schedule.enabled) continue;
      if (schedule.lastTriggeredDate === todayDateStr) continue;

      // Cek apakah hari ini termasuk dalam jadwal
      if (Array.isArray(schedule.daysOfWeek) && schedule.daysOfWeek.length > 0) {
        if (!schedule.daysOfWeek.includes(currentDay)) continue;
      }

      // Cek apakah waktu saat ini cocok dengan jam terjadwal
      if (schedule.scheduledTime === currentTimeStr) {
        schedule.lastTriggeredDate = todayDateStr;
        this.saveSchedules();

        this.emit('trigger_schedule', {
          scheduleId: schedule.id,
          title: schedule.title,
          config: {
            name: schedule.title,
            urlOrRoomId: schedule.liveUrl,
            targetViewers: schedule.targetViewers,
            campaignDurationMinutes: schedule.durationMinutes,
            retentionMode: schedule.retentionMode,
            interaction: schedule.interaction
          }
        });
      }
    }
  }
}

// Singleton
const streamScheduler = new StreamScheduler();

module.exports = streamScheduler;
