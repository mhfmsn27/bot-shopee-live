/**
 * Identity Generator - Realistic Indonesian Identity Engine
 * Menghasilkan identitas Indonesia realistis (Nama, Username, Tanggal Lahir, Gender, Domisili, Bio)
 */

const FIRST_NAMES_MALE = [
  'Dimas', 'Reza', 'Bagus', 'Bayu', 'Fajar', 'Aditya', 'Ilham', 'Rizky', 'Fauzan',
  'Hendra', 'Gilang', 'Kevin', 'Farhan', 'Teguh', 'Arif', 'Danang', 'Budi', 'Wahyu',
  'Angga', 'Rian', 'Galih', 'Daffa', 'Alif', 'Satria', 'Bima', 'Yoga', 'Eko', 'Rangga'
];

const FIRST_NAMES_FEMALE = [
  'Siti', 'Dewi', 'Putri', 'Ayu', 'Anisa', 'Rina', 'Lestari', 'Nabila', 'Fitri',
  'Indah', 'Maya', 'Kartika', 'Tiara', 'Wulandari', 'Melati', 'Sarah', 'Desi', 'Dian',
  'Mega', 'Sari', 'Gita', 'Zahra', 'Tasya', 'Nadya', 'Amalia', 'Safira', 'Clara', 'Annisa'
];

const LAST_NAMES = [
  'Pratama', 'Saputra', 'Kusuma', 'Wijaya', 'Hidayat', 'Setiawan', 'Nugroho', 'Utomo',
  'Santoso', 'Siregar', 'Ramadhan', 'Wibowo', 'Permana', 'Syahputra', 'Wardhana',
  'Kurniawan', 'Firmansyah', 'Pangestu', 'Gunawan', 'Subekti', 'Hakim', 'Nasution',
  'Prasetyo', 'Hasan', 'Mahendra', 'Susanto', 'Suharto', 'Yudistira', 'Kusnadi'
];

const CITIES = [
  'Jakarta Selatan', 'Jakarta Barat', 'Jakarta Pusat', 'Jakarta Timur', 'Bandung',
  'Surabaya', 'Semarang', 'Yogyakarta', 'Medan', 'Bekasi', 'Tangerang Selatan',
  'Depok', 'Bogor', 'Malang', 'Solo', 'Denpasar', 'Makassar', 'Palembang'
];

const BIOS = [
  'Happy shopping ✨ Cari promo & diskon seru',
  'Belanja hemat, barang berkualitas 🛍️',
  'Pecinta live stream & flash sale harian 🔥',
  'Reviewer jujur & belanja santai ☕',
  'Suka gratis ongkir & voucher cashback ✨',
  'Live shopper | Fashion & gadget enthusiast 📦',
  'Cari barang unik & toko terpercaya 💫',
  'Belanja cerdas untuk kebutuhan rumah & hobi'
];

function getRandomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomNumber(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generate profil identitas Indonesia lengkap
 * @param {string} [preferredGender] - 'male' | 'female' | 'random'
 */
function generateIndonesianIdentity(preferredGender = 'random') {
  const gender = preferredGender === 'random' 
    ? (Math.random() > 0.5 ? 'male' : 'female') 
    : preferredGender;

  const firstName = gender === 'male' 
    ? getRandomItem(FIRST_NAMES_MALE) 
    : getRandomItem(FIRST_NAMES_FEMALE);
  
  const lastName = getRandomItem(LAST_NAMES);
  const fullName = `${firstName} ${lastName}`;

  // Generate birthdate antara usia 19 - 42 tahun
  const currentYear = new Date().getFullYear();
  const birthYear = currentYear - getRandomNumber(19, 42);
  const birthMonth = String(getRandomNumber(1, 12)).padStart(2, '0');
  const birthDay = String(getRandomNumber(1, 28)).padStart(2, '0');
  const birthdate = `${birthYear}-${birthMonth}-${birthDay}`;

  // Pola username manusiawi yang natural
  const patterns = [
    `${firstName.toLowerCase()}_${lastName.toLowerCase()}${birthYear.toString().slice(-2)}`,
    `${firstName.toLowerCase()}.${lastName.toLowerCase()}${getRandomNumber(10, 99)}`,
    `${firstName.toLowerCase()}${getRandomNumber(100, 999)}`,
    `${lastName.toLowerCase()}_${firstName.toLowerCase()}`,
    `${firstName.toLowerCase()}_${getRandomItem(['shop', 'id', 'official', 'store', 'real'])}${getRandomNumber(1, 99)}`
  ];
  const username = getRandomItem(patterns).replace(/[^a-z0-9_.]/g, '');

  const city = getRandomItem(CITIES);
  const bio = getRandomItem(BIOS);

  return {
    fullName,
    firstName,
    lastName,
    username,
    gender,
    birthdate,
    city,
    bio,
    country: 'ID'
  };
}

module.exports = {
  generateIndonesianIdentity,
  FIRST_NAMES_MALE,
  FIRST_NAMES_FEMALE,
  LAST_NAMES,
  CITIES,
  BIOS
};
