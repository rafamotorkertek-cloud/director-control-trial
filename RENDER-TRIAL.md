# Director Control — Trial Online Render

Paket ini siap dideploy sebagai Node.js Web Service di Render.

## Cara deploy dari HP
1. Buat repository baru di GitHub, misalnya `director-control-trial`.
2. Upload seluruh isi folder paket ini ke repository tersebut (termasuk `render.yaml`).
3. Di Render pilih **New + → Web Service**.
4. Hubungkan repository GitHub tadi.
5. Jika Render membaca `render.yaml`, gunakan konfigurasi yang ada.
6. Deploy.
7. Setelah selesai, buka URL `https://<nama-service>.onrender.com`.

## Login demo
- Direktur: `direktur` / `123456`
- Manager: `manager` / `123456`
- Leader: `leader` / `123456`
- Accounting: `accounting` / `123456`

## Catatan trial
Render Free cocok untuk pengujian. Service dapat sleep ketika tidak digunakan. SQLite dan file upload berada di storage lokal/container, sehingga data trial dapat hilang saat instance diganti/redeploy. Jangan gunakan data perusahaan yang sensitif untuk trial ini.

Untuk produksi nanti: gunakan database PostgreSQL, persistent/object storage untuk evidence, secret yang kuat, HTTPS, backup otomatis, dan proteksi upload yang lebih ketat.
