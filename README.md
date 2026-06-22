# KINO DRAMA PREMIUM — Railway Bundle

## Tarkibi
- `index.html` — frontend (har bir qismda katta **GALEREYADAN TANLASH** tugmasi + **URL kiritish** ikkala variant)
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
Admin kino yoki yangi qism qo'shadi → **GALEREYADAN TANLASH** tugmasini bosadi → telefon galereyasi/fayllar oynasi ochiladi → video tanlanganda fayl avtomatik `POST /api/upload-video` orqali Railwayga yuklanadi → backend uni `uploads/` ga saqlaydi va `https://<domain>/videos/<filename>` URL qaytaradi → URL avtomatik inputga yoziladi → saqlaganda kino/qismlar MySQL `movies` jadvaliga yoziladi.

Poster rasmi ham Railwayga yuklanadi (`/api/upload-poster`) va qaytgan URL saqlanadi.
