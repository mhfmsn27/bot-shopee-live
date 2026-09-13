/**
 * Avatar Manager - Realistic Human Profile Pictures Library
 * Menyediakan koleksi foto profil realistis sesuai gender untuk akun Shopee
 */

const AVATARS_MALE = [
  'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=150&auto=format&fit=crop&q=80'
];

const AVATARS_FEMALE = [
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1508214751196-bcfd4ca60f91?w=150&auto=format&fit=crop&q=80',
  'https://images.unsplash.com/photo-1514315384763-ba401779410f?w=150&auto=format&fit=crop&q=80'
];

/**
 * Mendapatkan URL avatar realistis sesuai gender
 * @param {'male' | 'female'} gender
 * @returns {string} URL avatar
 */
function getRealisticAvatar(gender = 'male') {
  const list = gender === 'female' ? AVATARS_FEMALE : AVATARS_MALE;
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Generate fallback SVG data URL avatar dengan inisial nama jika gambar eksternal offline
 * @param {string} name
 * @param {'male' | 'female'} gender
 * @returns {string}
 */
function getFallbackSvgAvatar(name, gender = 'male') {
  const initials = (name || 'Shopee User')
    .split(' ')
    .map(n => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const bgColorsMale = ['#2563eb', '#0d9488', '#0284c7', '#4f46e5', '#334155'];
  const bgColorsFemale = ['#db2777', '#9333ea', '#e11d48', '#d97706', '#c026d3'];
  const colors = gender === 'female' ? bgColorsFemale : bgColorsMale;
  const color = colors[Math.floor(Math.random() * colors.length)];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
    <rect width="100" height="100" rx="50" fill="${color}"/>
    <text x="50" y="58" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="36" font-weight="bold" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${initials}</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

module.exports = {
  getRealisticAvatar,
  getFallbackSvgAvatar,
  AVATARS_MALE,
  AVATARS_FEMALE
};
