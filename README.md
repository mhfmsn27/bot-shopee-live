# Shopee Live View Bot Pro - Enterprise Edition

Sistem automasi penonton live streaming Shopee Live berbasis server cloud dengan fitur manajemen retensi penonton (*Dynamic Organic Churn*), generator akun beridentitas lengkap (*Indonesian realistic identity & avatar*), integrasi auto-create email, *rotating proxy pool*, proteksi proaktif *Canary Security Watchdog*, dan notifikasi real-time *WhatsApp Gateway*.

---

## 🚀 Fitur Utama

1. **Bot View Streaming 24 Jam Nonstop**:
   - Emulasi protokol ringan (*Lightweight Socket & Heartbeat Protocol Emulation*) tanpa beban browser Chromium.
   - 1.000–5.000 concurrent viewer dapat berjalan stabil hanya dengan 1–2 GB RAM di VPS cloud ekonomis.

2. **Kontrol Masa Aktif Menonton (Watch Duration & Retention Controller)**:
   - **Mode Dynamic Churn**: Rentang waktu menonton acak per bot (misal: 5–15 menit). Bot keluar wajar (*clean disconnect*) dan digantikan bot baru secara mulus (*seamless handover*), menjaga concurrent viewers konstan sambil melipatgandakan akumulasi total views dan lolos sistem deteksi anti-fraud.
   - **Mode Fixed Duration**: Menonton sesuai durasi tetap (misal: 60 menit) lalu ramp-down otomatis.
   - **Mode Infinite 24H**: Standby terus menerus 24 jam nonstop.
   - **Ramp-Up & Ramp-Down Speed**: Mengatur laju akselerasi view agar kurva statistik tampak alami.

3. **Auto-Create Email & Akun Beridentitas Lengkap**:
   - Otomatis membuat email unik dengan inbox listener untuk membaca OTP verifikasi.
   - **Identitas Realistis Indonesia**: Nama asli (pria/wanita), username natural, tanggal lahir realistis (19–42 tahun), domisili kota Indonesia (Jakarta, Surabaya, Bandung, Medan, dll), dan bio belanja kasual.
   - **Auto-Upload Avatar**: Memasang foto profil beresolusi optimal (*high trust score*).
   - **Audit Kesehatan Akun**: Menghitung indeks kesehatan akun (0–100%) dan mengevaluasi kelengkapan profil.
   - Ekspor database akun ke format CSV sewaktu-waktu.

4. **Proxy Pool Manager & Health Scoring**:
   - Manajemen IP perantara dengan pengujian latensi otomatis (alive/dead status).
   - Indikator rasio kesehatan proxy secara real-time.
   - Fitur **1-Click Pembersihan Proxy Mati (*Purge Dead Proxies*)**.
   - Rotasi otomatis per worker untuk menjaga performa koneksi.

5. **WhatsApp Gateway Notification Engine**:
   - QR Code pairing langsung di dashboard.
   - Notifikasi otomatis: Live stream dimulai, pencapaian milestone view (50, 100, 250, 500, 1.000 views), laporan siaran selesai, dan peringatan darurat WAF.
   - Panel preferensi toggle event notifikasi di dashboard.

6. **Canary Security Watchdog & WAF Alert**:
   - Pengawas proaktif yang menguji handshake gateway CDN Shopee secara berkala.
   - Deteksi challenge anti-bot (403/429) sebelum berdampak pada akun operasional.
   - Mode Circuit Breaker otomatis untuk melindungi akun penonton saat terjadi pembaruan keamanan pihak ketiga.
   - Badge status WAF interaktif di bilah navigasi atas.

7. **Multi-Campaign Concurrency (Multi-Sesi Siaran Simultan)**:
   - Mendukung penyuntikan ke **banyak toko/siaran Shopee Live berbeda secara paralel**.
   - Masing-masing sesi memiliki target view tersendiri dan kontrol stop independen.
   - Dilengkapi **Preset Durasi 72 Jam (3 Hari Nonstop)** untuk kampanye live skala besar.

8. **Interaksi Otomatis (Tap-Tap Like & Live Chat Organik)**:
   - Floating heart burst reactions dengan pengaturan frekuensi like per menit.
   - Pustaka bank komentar per kategori (Fashion, Elektronik, Kecantikan, Makanan, Umum, Custom) dengan variasi kalimat alami anti-spam.

9. **Modern Reactive Glassmorphism Dashboard**:
   - Dukungan tema ganda: **Dark Cosmic Mode** dan **Light Executive Mode** dengan persistensi tema.
   - Bilah status mengambang (*Floating Bottom Live Bar*) untuk pemantauan cepat tanpa perlu scroll.
   - Grafik canvas viewer real-time dan terminal log interaktif.

---

## 🛠️ Cara Menjalankan Aplikasi

### 1. Menjalankan di Komputer Lokal / Server

Pastikan Node.js (v18 ke atas) telah terinstal.

```bash
# Masuk ke direktori proyek
cd "Shopee Live View Bot Apps"

# Install dependensi (jika belum)
npm install

# Jalankan server aplikasi
npm start
```

Buka browser dan akses antarmuka dashboard di:
👉 **`http://localhost:3000`**

---

### 2. Panduan Deployment Cloud Server (Ubuntu VPS)

1. **Clone / Upload source code** ke VPS Cloud Anda (DigitalOcean, Contabo, AWS, atau Biznet).
2. **Install Node.js & PM2** di VPS:
   ```bash
   sudo apt update && sudo apt install -y nodejs npm
   sudo npm install -g pm2
   ```
3. **Jalankan Background Service dengan PM2**:
   ```bash
   cd /var/www/shopee-live-bot
   npm install
   pm2 start backend/src/server.js --name "shopee-live-bot"
   pm2 startup
   pm2 save
   ```
4. **Konfigurasi Domain & Nginx SSL**:
   Arahkan domain ke IP VPS Anda, lalu pasang Nginx reverse proxy ke port `3000` dan pasang SSL gratis via Certbot Let's Encrypt.

---

## 📁 Struktur Direktori

```
Shopee Live View Bot Apps/
├── backend/
│   ├── src/
│   │   ├── core/
│   │   │   ├── protocol-client.js       # Header spoofing & fingerprint emulasi
│   │   │   ├── shopee-live-worker.js    # Protocol-level viewer worker
│   │   │   ├── campaign-instance.js     # Instance sesi siaran live independen
│   │   │   └── retention-controller.js  # Kontrol retensi, churn & multi-session
│   │   ├── identity/
│   │   │   ├── identity-generator.js    # Generator nama Indonesia, TTL, bio, domisili
│   │   │   ├── avatar-manager.js        # Foto profil realistis & fallback
│   │   │   ├── email-creator.js         # Auto-create email & inbox listener
│   │   │   └── account-manager.js       # Pengelola akun, database, audit & ekspor CSV
│   │   ├── proxy/
│   │   │   └── proxy-manager.js         # Pool proxy, healthcheck, purge & failover
│   │   ├── security/
│   │   │   └── canary-watchdog.js       # Pengawas proaktif keamanan WAF & Circuit Breaker
│   │   ├── interaction/
│   │   │   ├── comment-banks.js         # Bank komentar per kategori industri
│   │   │   └── interaction-manager.js   # Pengatur tap-tap love & chat bot
│   │   ├── wa-gateway/
│   │   │   └── whatsapp-service.js      # WhatsApp Gateway & lifecycle alerts
│   │   ├── api/
│   │   │   └── routes.js                # REST API & SSE streaming
│   │   └── server.js                    # Entrypoint server Express
│   └── data/
│       ├── accounts.json                # Database akun lokal
│       ├── proxies.json                 # Database proxy lokal
│       └── config.json                  # Konfigurasi sistem
├── frontend/
│   ├── index.html                       # Dashboard UI utama
│   ├── css/
│   │   └── dashboard.css                # Desain Glassmorphism & Multi-Theme
│   └── js/
│       ├── app.js                       # Controller frontend & realtime SSE
│       └── charts.js                    # Engine grafik live canvas
├── package.json
└── README.md
```
