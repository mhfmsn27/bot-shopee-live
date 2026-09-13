/**
 * Comment Bank - Shopee Live Interaction Engine
 * Pustaka template komentar multi-kategori dan generator komentar alami dengan variasi anti-spam
 */

const fs = require('fs');
const path = require('path');

const BANK_FILE = path.join(__dirname, '../../data/comment-banks.json');

// Template komentar bawaan terkurasi untuk pasar live streaming Shopee Indonesia
const DEFAULT_BANKS = {
  fashion: [
    'Spill etalase 2 dong kak',
    'Bisa COD gak kak?',
    'Warna sage masih ada gak kak?',
    'Bahannya adem dan lembut gak kak?',
    'BB 55 kg muat ukuran apa ya kak?',
    'Udah checkout ya kak, minta kirim hari ini ya!',
    'Spill etalase 1 kak yang warna hitam',
    'Bahan melar atau pas badan kak?',
    'Ada voucher diskon toko lagi gak kak?',
    'Keren banget modelnya kak, cocok buat hangout',
    'Spill etalase 4 dong kak detail jahitannya',
    'Ukuran XL lingkar dada berapa kak?',
    'Udah co 2 pcs kak, dapet bonus gak?',
    'Warna broken white nerawang gak kak?',
    'Bagus banget kak warnanya kalem'
  ],
  electronic: [
    'Garansi resmi berapa tahun kak?',
    'Spill etalase 1 dong kak',
    'Bisa kirim instan hari ini ke Jakarta?',
    'Original 100% dan tersegel kan kak?',
    'Udah co kak, minta tolong dipacking bubble wrap tebal ya',
    'Kompatibel sama iPhone / Type C gak kak?',
    'Dapet charger dan kabelnya sekalian kak?',
    'Ada diskon flash sale gak kak buat etalase 2?',
    'Kualitas suaranya jernih ngebass gak kak?',
    'Baterainya tahan berapa jam pemakaian kak?',
    'Spill etalase 3 dong kak yang warna silver'
  ],
  beauty: [
    'Bisa untuk kulit berjerawat dan sensitif kak?',
    'Exp date tahun berapa kak?',
    'Bumil dan busui friendly gak kak?',
    'Udah BPOM dan Halal kan kak?',
    'Udah checkout shade 02 kak, makasih ya!',
    'Spill etalase 3 dong kak teksturnya',
    'Cocok untuk tone kulit sawo matang gak kak?',
    'Bikin glowing dan gak dempul kan kak?',
    'Dapet gratis pouch atau brush gak kak?',
    'Udah co paket lengkap kak, semoga cocok'
  ],
  food: [
    'Tahan berapa hari di suhu ruang kak?',
    'Pengiriman aman keluar pulau Jawa kak?',
    'Udah co 3 toples kak buat cemilan di rumah',
    'Spill varian rasa yang paling best seller dong kak',
    'Rasa pedasnya nampol gak kak?',
    'Bisa tahan berapa lama kalau ditaruh di kulkas kak?',
    'Udah checkout kak, tolong dijamin kemasan tidak remuk ya',
    'Keren kak, higienis banget packingnya'
  ],
  general: [
    'Semangat live-nya kak!',
    'Wah promo murah banget malam ini!',
    'Bantu tap tap love ya kak ❤️',
    'Ikut mantau kak, racun banget barangnya',
    'Keren banget kak promosinya',
    'Udah tap love banyak nih kak',
    'Semoga laris manis dan berkah live-nya kak',
    'Rame banget yang nonton, mantap kak!',
    'Hostnya ramah dan penjelasannya detail banget',
    'Bantu up share live-nya ya kak'
  ],
  custom: [
    'Spill promo terbaik hari ini kak',
    'Udah checkout kak makasih',
    'Bisa gratis ongkir gak kak?'
  ]
};

// Variasi emoji Shopee Live untuk anti-spam
const EMOJIS = ['❤️', '✨', '🛍️', '🔥', '🥰', '👍', '💫', '🎉', '🙏', '👏', '😍', '💃'];

// Variasi panggilan ramah
const SUFFIXES = ['', ' kak', ' ya kak', ' dong kak', ' min', ' sis', ' bun'];

const sqliteManager = require('../db/sqlite-manager');

function loadBanks() {
  try {
    let banks = sqliteManager.getAllCommentBanks();
    if (!banks || Object.keys(banks).length === 0) {
      if (fs.existsSync(BANK_FILE)) {
        const data = fs.readFileSync(BANK_FILE, 'utf8');
        banks = JSON.parse(data || '{}');
      }
      if (!banks || Object.keys(banks).length === 0) {
        banks = DEFAULT_BANKS;
      }
      sqliteManager.saveAllCommentBanks(banks);
    }
    return banks;
  } catch (err) {
    console.error('Gagal membaca database comment-banks:', err.message);
    return DEFAULT_BANKS;
  }
}

function saveBanks(banks) {
  try {
    sqliteManager.saveAllCommentBanks(banks);
  } catch (err) {
    console.error('Gagal menyimpan comment-banks ke SQLite:', err.message);
    try {
      const dir = path.dirname(BANK_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(BANK_FILE, JSON.stringify(banks, null, 2), 'utf8');
    } catch (e) {}
  }
}

// Memory untuk mencegah komentar yang sama persis berulang di sesi yang sama
const recentSentPerSession = new Map(); // sessionId -> string[]

/**
 * Hasilkan komentar alami berdasarkan kategori dengan variasi anti-deteksi bot
 * @param {string} category - fashion | electronic | beauty | food | general | custom
 * @param {Array<string>} [customList] - Komentar custom opsional
 * @param {string} [sessionId] - ID sesi untuk cek duplikat
 * @returns {string} Teks komentar yang sudah divariasikan
 */
function generateNaturalComment(category = 'general', customList = null, sessionId = 'global') {
  const banks = loadBanks();
  let pool = [];

  if (Array.isArray(customList) && customList.length > 0) {
    pool = customList.filter(t => typeof t === 'string' && t.trim().length > 0);
  } else if (banks[category] && banks[category].length > 0) {
    pool = banks[category];
  } else {
    pool = banks.general || DEFAULT_BANKS.general;
  }

  if (pool.length === 0) pool = DEFAULT_BANKS.general;

  // Hindari pengulangan kalimat yang sama persis dengan riwayat terakhir
  let history = recentSentPerSession.get(sessionId) || [];
  let availableChoices = pool.filter(c => !history.includes(c));
  if (availableChoices.length === 0) {
    availableChoices = pool;
    history = [];
  }

  const base = availableChoices[Math.floor(Math.random() * availableChoices.length)];
  history.push(base);
  if (history.length > 15) history.shift();
  recentSentPerSession.set(sessionId, history);

  // Variasikan sedikit secara acak (anti-spam footprint)
  let varied = base.trim();

  // 40% chance tambahkan emoji di akhir
  if (Math.random() < 0.45) {
    const emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
    varied += ` ${emoji}`;
  }

  return varied;
}

/**
 * Tambah kalimat komentar ke kategori tertentu
 */
function addCommentToCategory(category, text) {
  if (!text || !text.trim()) return false;
  const banks = loadBanks();
  if (!banks[category]) banks[category] = [];
  if (!banks[category].includes(text.trim())) {
    banks[category].push(text.trim());
    saveBanks(banks);
    return true;
  }
  return false;
}

/**
 * Hapus komentar dari kategori
 */
function removeCommentFromCategory(category, text) {
  const banks = loadBanks();
  if (banks[category]) {
    banks[category] = banks[category].filter(c => c !== text);
    saveBanks(banks);
    return true;
  }
  return false;
}

/**
 * Ambil seluruh bank komentar
 */
function getAllBanks() {
  return loadBanks();
}

/**
 * Simpan seluruh bank komentar kustom
 */
function updateCategoryComments(category, list) {
  if (!Array.isArray(list)) return false;
  const banks = loadBanks();
  banks[category] = list.filter(t => typeof t === 'string' && t.trim().length > 0);
  saveBanks(banks);
  return true;
}

/**
 * Hapus riwayat chat sesi yang sudah selesai agar tidak menumpuk di memori
 */
function clearSessionHistory(sessionId) {
  if (sessionId) recentSentPerSession.delete(sessionId);
}

module.exports = {
  generateNaturalComment,
  getAllBanks,
  addCommentToCategory,
  removeCommentFromCategory,
  updateCategoryComments,
  clearSessionHistory,
  DEFAULT_BANKS
};
