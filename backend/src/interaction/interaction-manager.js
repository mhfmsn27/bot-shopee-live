/**
 * Interaction Manager - Shopee Live Interaction Engine
 * Mengelola setelan default master interaksi (Global Settings)
 * dan menjembatani penyimpanan konfigurasi ke config.json
 */

const fs = require('fs');
const path = require('path');
const commentBank = require('./comment-bank');

const CONFIG_PATH = path.join(__dirname, '../../data/config.json');

const DEFAULT_INTERACTION_CONFIG = {
  enableLike: true,
  likeRatePerMin: 60, // Total target tap like per menit per sesi siaran
  likeBurstMin: 3,    // Jumlah tap cepat per burst
  likeBurstMax: 8,
  enableComment: true,
  commentIntervalSec: 20, // Interval pengiriman chat (detik)
  defaultCategory: 'general',
  enableShare: true,
  shareIntervalSec: 60,
  enableCartClick: true,
  cartClickRatePerMin: 15, // Total target klik keranjang oranye per menit
  maxCommentsPerSession: 500,
  antiSpamJitterSec: 4
};

function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return {};
    const data = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(data || '{}');
  } catch (err) {
    console.error('Gagal membaca config.json:', err.message);
    return {};
  }
}

function saveConfig(cfg) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Gagal menyimpan config.json:', err.message);
    return false;
  }
}

/**
 * Dapatkan konfigurasi interaksi global master
 */
function getGlobalConfig() {
  const fullCfg = loadConfig();
  return {
    ...DEFAULT_INTERACTION_CONFIG,
    ...(fullCfg.interaction || {})
  };
}

/**
 * Perbarui konfigurasi interaksi global master
 */
function updateGlobalConfig(newSettings = {}) {
  const fullCfg = loadConfig();
  fullCfg.interaction = {
    ...getGlobalConfig(),
    ...newSettings
  };
  saveConfig(fullCfg);
  return fullCfg.interaction;
}

module.exports = {
  getGlobalConfig,
  updateGlobalConfig,
  commentBank,
  DEFAULT_INTERACTION_CONFIG
};
