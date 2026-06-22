# KINO DRAMA PREMIUM — Railway Bundle

## Tarkibi
- `index.html` — frontend (qism qo'shishda **galereyadan video tanlash** + **URL kiritish** ikkala variant)
- `backend/`   — Node.js + Express + MySQL backend (Railway uchun)

## Railway sozlash (1 marta)

1. Railway'da **New Project → Deploy from GitHub** (yoki ZIP)
2. **+ New → Database → MySQL** qo'shing — env auto bog'lanadi (`MYSQLHOST`, `MYSQLUSER`, `MYSQLPASSWORD`, `MYSQLDATABASE`, `MYSQLPORT`).
3. **Settings → Networking → Generate Domain** (masalan `ilova-production.up.railway.app`).
4. Disk persist uchun: **Service → Settings → Volumes → New Volume**, mount path `/app/uploads`.

## Frontend
`index.html` ichida 2540-qator atrofidagi `RAILWAY_API` o'zgaruvchisi sizning Railway domeningiz bilan moslangan bo'lsin:

```js
const RAILWAY_API = window.RAILWAY_API_URL || 'https://ilova-production.up.railway.app';
```

## Limit
- Bitta video — **700 MB** gacha.
- Saqlanadigan joy — Railway Volume (`/app/uploads`).
- Metadata — MySQL `videos` jadvali.

## Qanday ishlaydi
Foydalanuvchi qism qo'shadi → **galereyadan video tanlaydi** → fayl `POST /api/upload-video` ga ketadi → backend uni `uploads/` ga saqlaydi va `https://<domain>/videos/<filename>` URL qaytaradi → bu URL avtomatik `vfUrl` inputiga yoziladi → "KINONI SAYTGA JOYLASH" tugmasi bosilganda mavjud movies API ga boradi.
