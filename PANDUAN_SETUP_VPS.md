# 🌐 Panduan Lengkap Setup & Deployment Shopee Live View Bot di VPS
### Menggunakan SSH (Terminal / PuTTY), FileZilla (SFTP), & Domain Beda Provider

Panduan ini disusun secara terstruktur langkah-demi-langkah (step-by-step) untuk memandu Anda mendeploy aplikasi **Shopee Live View Bot Pro** ke VPS Linux (Ubuntu 22.04 / 24.04 LTS), menghubungkannya dengan domain milik Anda (meskipun domain dan VPS berada di provider berbeda), serta mengamankannya dengan SSL HTTPS gratis 24/7.

---

## 📌 Gambaran Arsitektur

```
[ Domain Provider ]                  [ VPS Cloud Server ]
(Cloudflare / Niagahoster /          (Ubuntu 22.04 / 24.04 LTS)
 Namecheap / Domainesia)
         │                                   │
    DNS A-Record                             ▼
   domainanda.com  ──────────────►  [ Nginx Reverse Proxy ]
                                        (Port 80 / 443 SSL)
                                             │ (proxy_pass)
                                             ▼
                                    [ Node.js v22 App ]
                                        (Port 3000)
                                             │
                                    [ PM2 Process Manager ]
                                     (Auto-Restart 24/7)
                                             │
                                    [ SQLite Database ]
                                     (node:sqlite AES-256)
```

---

## 📋 Prasyarat Sebelum Memulai

1. **VPS Cloud**: Minimal RAM 2GB (direkomendasikan 4GB untuk bot multi-sesi), OS **Ubuntu 22.04 LTS** atau **Ubuntu 24.04 LTS**.
   - Catat: **IP Publik VPS**, **Username** (biasanya `root`), dan **Password / SSH Key**.
2. **Domain**: Akses ke dashboard manajemen DNS domain Anda.
3. **Software di PC/Laptop Anda**:
   - **Terminal / PowerShell** (Bawaan Windows) atau **PuTTY** untuk akses SSH.
   - **FileZilla Client** untuk transfer file via SFTP.

---

## FASE 1: Menghubungkan Domain ke VPS (DNS Setup Beda Provider)

Karena domain dan VPS Anda berada di provider yang berbeda, langkah pertama adalah mengarahkan domain ke alamat IP publik VPS Anda.

1. Buka dashboard tempat Anda membeli domain (misal: *Niagahoster, Domainesia, Namecheap, Cloudflare, GoDaddy, dll.*).
2. Masuk ke menu **DNS Management** / **DNS Zone Editor**.
3. Tambahkan 2 buah **A Record**:
   - **Record 1 (Domain Utama)**:
     - Type: `A`
     - Name / Host: `@` (atau kosongkan / ketik nama domain)
     - Value / Points to: `[ALAMAT_IP_PUBLIK_VPS_ANDA]` (Contoh: `103.187.145.20`)
     - TTL: `Auto` atau `300` detik
   - **Record 2 (Subdomain WWW)**:
     - Type: `A`
     - Name / Host: `www`
     - Value / Points to: `[ALAMAT_IP_PUBLIK_VPS_ANDA]`
     - TTL: `Auto` atau `300` detik
4. *(Opsi jika ingin menggunakan subdomain khusus bot, misal `bot.domainanda.com`)*:
   - Type: `A`, Name: `bot`, Value: `[ALAMAT_IP_PUBLIK_VPS_ANDA]`.
5. **Catatan Penting jika Menggunakan Cloudflare**:
   - Untuk sementara, ubah **Proxy Status** menjadi **DNS Only (Awan Abu-abu / Grey Cloud)** terlebih dahulu agar proses verifikasi sertifikat SSL Let's Encrypt berjalan lancar. Setelah SSL aktif, Anda dapat mengubahnya kembali ke Proxied jika diinginkan.
6. **Verifikasi Propagasi DNS**:
   - Buka CMD/PowerShell di PC Anda, ketik:
     ```bash
     ping domainanda.com
     ```
   - Jika IP yang merespon sudah sama dengan IP VPS Anda, berarti domain telah terhubung.

---

## FASE 2: Koneksi SSH & Instalasi Environment di VPS

Buka **PowerShell** atau **Terminal** di komputer Anda, lalu jalankan langkah-langkah berikut:

### 1. Login ke VPS via SSH
```bash
ssh root@IP_PUBLIK_VPS
```
*(Ketik `yes` jika muncul konfirmasi sidik jari SSH pertama kali, lalu masukkan password VPS Anda. Karakter password memang tidak akan terlihat saat diketik, langsung tekan Enter).*

### 2. Update Sistem Operasi & Pasang Paket Dasar
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl wget git ufw build-essential
```

### 3. Wajib: Pasang Node.js v22 LTS (Engine node:sqlite)
> [!IMPORTANT]
> Aplikasi ini menggunakan driver database native `node:sqlite` (`DatabaseSync`), yang **wajib membutuhkan Node.js v22.5.0 ke atas**. Jangan menggunakan Node.js versi 18 atau 20 bawaan Ubuntu repo lama.

Jalankan perintah instalasi Node.js 22 LTS resmi dari NodeSource:
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

Periksa versi yang terpasang (harus v22.x):
```bash
node -v
npm -v
```

### 4. Pasang PM2 (Process Manager untuk 24/7 Autorestart)
```bash
sudo npm install -g pm2
```

### 5. Pasang Nginx Web Server & Certbot SSL
```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 6. Siapkan Folder Aplikasi di VPS
```bash
sudo mkdir -p /var/www/shopee-live-bot
sudo chown -R $USER:$USER /var/www/shopee-live-bot
```

---

## FASE 3: Upload File Aplikasi Menggunakan FileZilla (SFTP)

Buka aplikasi **FileZilla** di PC/Laptop Anda:

### 1. Konfigurasi Site Manager di FileZilla
1. Klik menu **File** > **Site Manager** (atau tekan `Ctrl + S`).
2. Klik tombol **New site**, beri nama misalnya: `VPS Shopee Bot`.
3. Di panel sebelah kanan, atur:
   - **Protocol**: Pilih **SFTP - SSH File Transfer Protocol**
   - **Host**: Masukkan `[ALAMAT_IP_PUBLIK_VPS]` (atau domain Anda jika DNS sudah propagasi)
   - **Port**: `22` (default port SSH)
   - **Logon Type**: 
     - Pilih **Normal** jika VPS menggunakan password (masukkan User `root` dan Password Anda).
     - Pilih **Key file** jika VPS menggunakan file kunci SSH (`.pem` / `.ppk`).
4. Klik **Connect**.

### 2. Memilih & Mengupload File
1. Pada kolom **Remote site** (panel kanan / VPS):
   - Masuk ke direktori: `/var/www/shopee-live-bot`
2. Pada kolom **Local site** (panel kiri / PC Anda):
   - Masuk ke folder proyek: `d:\Web Dev Project Apps\Shopee Live View Bot Apps`
3. **PILIH FILE YANG HARUS DIUPLOAD**:
   - ✅ Folder `backend`
   - ✅ Folder `frontend`
   - ✅ File `package.json`
   - ✅ File `package-lock.json`
   - ✅ File `ecosystem.config.js`
   - ✅ File `.env.example`
   - ✅ File `Dockerfile` & `docker-compose.yml` (opsional)

> [!CAUTION]
> **JANGAN UPLOAD FOLDER `node_modules` DARI WINDOWS KE LINUX!**
> Modul Node.js dari Windows memiliki binary yang berbeda dengan Linux. Biarkan server VPS mengunduh dan mengompilasi `node_modules` Linux secara bersih via terminal.

4. Klik kanan pada file/folder yang dipilih di panel kiri, lalu pilih **Upload**. Tunggu hingga semua berkas selesai terkirim (status di tab *Queued files* menjadi 0).

---

## FASE 4: Setup Dependensi & Environment di VPS

Kembali ke jendela SSH Terminal VPS Anda:

### 1. Masuk ke Folder Aplikasi
```bash
cd /var/www/shopee-live-bot
```

### 2. Konfigurasi File Environment (.env)
Salin contoh template `.env.example`:
```bash
cp .env.example .env
nano .env
```

Sesuaikan nilai-nilai di dalam file `.env`:
```ini
# Generate secret 64-karakter acak untuk sesi keamanan
SESSION_SECRET=shopee_enterprise_secret_production_key_64bit_random

# Kunci enkripsi SQLite AES-256 (PENTING untuk enkripsi Cookie Vault)
APP_SECRET_KEY=shopee-live-enterprise-secret-key-32b!

# Master password dashboard
APP_MASTER_PASSWORD=PasswordKuatAnda123!

# Konfigurasi Server
NODE_ENV=production
PORT=3000
```
*(Tekan `Ctrl + O`, lalu `Enter` untuk menyimpan, kemudian `Ctrl + X` untuk keluar dari nano editor).*

### 3. Install Dependensi Khusus Linux
```bash
npm install --production
```

### 4. Uji Coba Menjalankan Aplikasi
```bash
node backend/src/server.js
```
Jika muncul pesan terminal:
```
================================================================
🚀 SHOPEE LIVE VIEW BOT PRO - ENTERPRISE EDITION ONLINE
================================================================
[Security] SQLite At-Rest Encryption: ACTIVE (AES-256-GCM)
[Database] SQLite Database Connected: shopee_bot.db
[Server] Listening on http://localhost:3000
```
Tekan `Ctrl + C` untuk menghentikannya sementara (karena selanjutnya kita akan menjalankannya secara permanen via PM2).

---

## FASE 5: Menjalankan Aplikasi 24/7 Menggunakan PM2

PM2 memastikan aplikasi tetap hidup tanpa henti, otomatis menyala kembali saat server reboot, dan memantau penggunaan memori.

### 1. Jalankan Aplikasi dengan PM2
```bash
cd /var/www/shopee-live-bot
pm2 start ecosystem.config.js --env production
```

### 2. Kunci Status & Jadwalkan Startup Otomatis
```bash
pm2 save
pm2 startup
```
*(Perhatikan terminal: jika PM2 mengeluarkan perintah `sudo env PATH=...`, salin baris perintah tersebut dan jalankan di terminal).*

### 3. Perintah Berguna untuk Monitoring PM2:
- Cek status aplikasi: `pm2 status`
- Pantau logs real-time: `pm2 logs shopee-live-view-bot`
- Restart aplikasi: `pm2 restart shopee-live-view-bot`
- Stop aplikasi: `pm2 stop shopee-live-view-bot`

---

## FASE 6: Konfigurasi Nginx Reverse Proxy & Server-Sent Events (SSE)

Nginx berfungsi menjembatani lalu lintas dari internet (Port 80/443 dengan domain Anda) ke aplikasi Node.js internal (Port 3000), serta mengalirkan Server-Sent Events (SSE) secara instan tanpa terhalang buffering.

### 1. Buat Berkas Konfigurasi Nginx
```bash
sudo nano /etc/nginx/sites-available/shopee-live-bot
```

### 2. Tempelkan Konfigurasi Berikut (Ganti `domainanda.com` dengan domain asli Anda):
```nginx
server {
    listen 80;
    server_name domainanda.com www.domainanda.com;

    # Ukuran maksimum body upload (untuk import bulk cookies/proxies)
    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # Header standar reverse proxy
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Konfigurasi KRUSIAL untuk SSE (Server-Sent Events) & Real-time Chart
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
```
*(Simpan dengan `Ctrl + O`, `Enter`, lalu keluar dengan `Ctrl + X`).*

### 3. Aktifkan Konfigurasi & Reload Nginx
```bash
sudo ln -s /etc/nginx/sites-available/shopee-live-bot /etc/nginx/sites-enabled/
sudo nginx -t
```
*(Jika muncul `nginx: configuration file /etc/nginx/nginx.conf test is successful`, lanjutkan reload)*:
```bash
sudo systemctl reload nginx
```

---

## FASE 7: Memasang SSL HTTPS Gratis (Certbot Let's Encrypt)

Jalankan Certbot untuk memasang sertifikat enkripsi SSL HTTPS resmi:

```bash
sudo certbot --nginx -d domainanda.com -d www.domainanda.com
```

- Masukkan alamat email Anda saat diminta (untuk notifikasi masa berlaku sertifikat).
- Tekan `Y` untuk menyetujui Ketentuan Layanan (Terms of Service).
- Pilih opsi untuk otomatis mengalihkan semua akses HTTP ke HTTPS (Redirect).
- Certbot akan otomatis memperbarui konfigurasi Nginx dan menjadwalkan perpanjangan otomatis (*auto-renewal*).

Uji pembaharuan otomatis SSL:
```bash
sudo certbot renew --dry-run
```

---

## FASE 8: Konfigurasi Firewall Keamanan (UFW)

Lindungi VPS Anda dari pemindaian port yang tidak perlu:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
```

Periksa status firewall:
```bash
sudo ufw status
```
*(Pastikan port 22/SSH, 80/HTTP, dan 443/HTTPS berstatus `ALLOW`).*

---

## ✅ FASE 9: Pengujian & Operasional Akhir

1. Buka browser di laptop atau HP Anda:
   👉 **`https://domainanda.com`**
2. Anda akan disambut oleh **Access Gatekeeper Security Modal**. Masukkan Master PIN default (`123456` atau PIN yang Anda konfigurasikan).
3. Sambungkan **WhatsApp Gateway**:
   - Masuk ke tab WhatsApp → Klik *Pairing QR Code* → Scan dari aplikasi WhatsApp di HP Anda.
4. Konfigurasikan **Residential Rotating Proxy Gateway**:
   - Masuk ke tab Proxy Manager → Klik *Import Proxy* → Masukkan kredensial provider proxy Anda dan klik *Test Koneksi & IP Probe*.
5. Siap beroperasi 24/7 tanpa perlu laptop Anda tetap menyala!

---

## 🆘 Panduan Pemecahan Masalah (Troubleshooting)

| Gejala Masalah | Penyebab Umum | Solusi Cepat |
|:---|:---|:---|
| **502 Bad Gateway** | Node.js / PM2 belum berjalan di port 3000 | Jalankan `pm2 status`, jika mati ketik `pm2 restart shopee-live-view-bot`. Cek log error: `pm2 logs`. |
| **Halaman Loading Terus (Tidak Muncul)** | DNS belum terpropagasi atau Firewall memblokir | Cek status propagasi di [dnschecker.org](https://dnschecker.org). Pastikan `ufw allow 'Nginx Full'` aktif. |
| **Error: Cannot find module 'node:sqlite'** | Versi Node.js di VPS di bawah v22.5.0 | Pasang Node.js 22 LTS via NodeSource: `curl -fsSL https://deb.nodesource.com/setup_22.x \| sudo bash -` lalu `sudo apt install -y nodejs`. |
| **Grafik / Real-time Log Macet di VPS** | Buffer Nginx menahan paket SSE | Pastikan baris `proxy_buffering off;` dan `proxy_read_timeout 86400s;` ada di blok konfigurasi Nginx Anda. |
| **Sertifikat SSL Gagal Diverifikasi** | A-Record domain belum mengarah ke IP VPS | Pastikan ping domain mengembalikan IP VPS Anda dan matikan sementara mode Proxy Cloudflare (*DNS Only*). |
