const express  = require('express');
const { Pool } = require('pg');
const multer   = require('multer');
const cors     = require('cors');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

// To'liq CORS sozlamasi
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-admin-token, Authorization, Accept');
  res.header('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

/* ── PostgreSQL ── */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: (process.env.DATABASE_URL || '').includes('railway.internal')
    ? false : { rejectUnauthorized: false }
});

/* ── Jadval yaratish ── */
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS movies (
      id             TEXT PRIMARY KEY,
      title          TEXT    NOT NULL,
      genre          TEXT    DEFAULT '',
      price          INTEGER DEFAULT 0,
      poster         TEXT    DEFAULT '',
      poster_id      TEXT    DEFAULT '',
      videos         JSONB   DEFAULT '[]',
      video_keys     JSONB   DEFAULT '[]',
      episode_prices JSONB   DEFAULT '{}',
      created_at     TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS video_files (
      id         SERIAL PRIMARY KEY,
      movie_id   TEXT,
      part_num   INTEGER DEFAULT 1,
      data       BYTEA   NOT NULL,
      mimetype   TEXT    DEFAULT 'video/mp4',
      size       BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS users (
      id           TEXT PRIMARY KEY,
      name         TEXT    DEFAULT '',
      username     TEXT    DEFAULT '',
      balance      BIGINT  DEFAULT 0,
      expiry       BIGINT  DEFAULT 0,
      blocked      BOOLEAN DEFAULT FALSE,
      card_number  TEXT    DEFAULT '',
      last_seen    TIMESTAMPTZ DEFAULT NOW(),
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('✅ PostgreSQL jadval tayyor');
}
initDB().catch(console.error);

/* ── Admin token ── */
function checkAdmin(req, res) {
  if (req.headers['x-admin-token'] !== process.env.ADMIN_TOKEN) {
    res.status(403).json({ ok: false, error: 'Ruxsat yoq' });
    return false;
  }
  return true;
}

/* ── Multer (xotiraga yuklash) ── */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB
});

/* ═══════════════════════════════════════
   VIDEO YUKLASH  POST /api/upload/video
═══════════════════════════════════════ */
app.post('/api/upload/video', upload.single('video'), async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Fayl yuklanmadi' });

    const { movie_id, part_num } = req.body;
    const { buffer, mimetype, size } = req.file;

    const { rows } = await pool.query(
      `INSERT INTO video_files (movie_id, part_num, data, mimetype, size)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [movie_id || null, parseInt(part_num) || 1, buffer, mimetype, size || buffer.length]
    );

    const videoId = rows[0].id;
    const base = process.env.RAILWAY_PUBLIC_DOMAIN
      ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN
      : 'https://ilova-production.up.railway.app';
    const videoUrl = `${base}/api/video/${videoId}`;

    res.json({ ok: true, video_id: videoId, url: videoUrl });
  } catch (e) {
    console.error('Video upload error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ═══════════════════════════════════════
   POSTER YUKLASH  POST /api/upload/poster
═══════════════════════════════════════ */
app.post('/api/upload/poster', upload.single('poster'), async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Rasm yuklanmadi' });

    const { buffer, mimetype } = req.file;

    const { rows } = await pool.query(
      `INSERT INTO video_files (part_num, data, mimetype, size)
       VALUES (0, $1, $2, $3) RETURNING id`,
      [buffer, mimetype, buffer.length]
    );

    const imgId = rows[0].id;
    const base = process.env.RAILWAY_PUBLIC_DOMAIN
      ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN
      : 'https://ilova-production.up.railway.app';
    const imgUrl = `${base}/api/image/${imgId}`;

    res.json({ ok: true, image_id: imgId, url: imgUrl });
  } catch (e) {
    console.error('Poster upload error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ═══════════════════════════════════════
   VIDEO STREAM  GET /api/video/:id
═══════════════════════════════════════ */
app.get('/api/video/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT data, mimetype, size FROM video_files WHERE id=$1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Topilmadi' });

    const { data, mimetype, size } = rows[0];
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const total = size || buf.length;

    const range = req.headers.range;
    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
      const start = parseInt(startStr, 10);
      const end   = endStr ? parseInt(endStr, 10) : total - 1;
      const chunk = end - start + 1;
      res.writeHead(206, {
        'Content-Range':  `bytes ${start}-${end}/${total}`,
        'Accept-Ranges':  'bytes',
        'Content-Length': chunk,
        'Content-Type':   mimetype || 'video/mp4',
      });
      res.end(buf.slice(start, end + 1));
    } else {
      res.writeHead(200, {
        'Content-Length': total,
        'Content-Type':   mimetype || 'video/mp4',
        'Accept-Ranges':  'bytes',
      });
      res.end(buf);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* ═══════════════════════════════════════
   RASM  GET /api/image/:id
═══════════════════════════════════════ */
app.get('/api/image/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT data, mimetype FROM video_files WHERE id=$1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).end();
    const buf = Buffer.isBuffer(rows[0].data) ? rows[0].data : Buffer.from(rows[0].data);
    res.writeHead(200, { 'Content-Type': rows[0].mimetype || 'image/jpeg', 'Content-Length': buf.length });
    res.end(buf);
  } catch (e) {
    res.status(500).end();
  }
});

/* ═══════════════════════════════════════
   KINOLAR API
═══════════════════════════════════════ */
app.get('/api/movies', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM movies ORDER BY created_at DESC');
    res.json({ ok: true, movies: rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/movies', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const { id, title, genre, price, poster, posterId, videos, videoKeys, episodePrices } = req.body;
    if (!title) return res.status(400).json({ ok: false, error: 'title majburiy' });
    const { rows } = await pool.query(
      `INSERT INTO movies (id, title, genre, price, poster, poster_id, videos, video_keys, episode_prices)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         title=$2, genre=$3, price=$4, poster=$5, poster_id=$6,
         videos=$7, video_keys=$8, episode_prices=$9
       RETURNING *`,
      [id, title, genre||'', price||0, poster||'', posterId||'',
       JSON.stringify(videos||[]), JSON.stringify(videoKeys||[]), JSON.stringify(episodePrices||{})]
    );
    res.json({ ok: true, movie: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.put('/api/movies/:id', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const { title, genre, price, poster, posterId, videos, videoKeys, episodePrices } = req.body;
    const { rows } = await pool.query(
      `UPDATE movies SET title=$2, genre=$3, price=$4, poster=$5, poster_id=$6,
         videos=$7, video_keys=$8, episode_prices=$9
       WHERE id=$1 RETURNING *`,
      [req.params.id, title, genre||'', price||0, poster||'', posterId||'',
       JSON.stringify(videos||[]), JSON.stringify(videoKeys||[]), JSON.stringify(episodePrices||{})]
    );
    res.json({ ok: true, movie: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.delete('/api/movies/:id', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    await pool.query('DELETE FROM movies WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.patch('/api/movies/:id/episode-prices', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const { episodePrices } = req.body;
    await pool.query('UPDATE movies SET episode_prices=$1 WHERE id=$2', [JSON.stringify(episodePrices), req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ═══════════════════════════════════════
   FOYDALANUVCHILAR API  (users)
═══════════════════════════════════════ */

// Barcha foydalanuvchilarni olish (admin panel uchun)
app.get('/api/users', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const { rows } = await pool.query('SELECT * FROM users ORDER BY last_seen DESC');
    res.json({ ok: true, users: rows, total: rows.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Bitta foydalanuvchini olish (login/init paytida, admin tokensiz — faqat o'qish)
app.get('/api/users/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.json({ ok: true, user: null });
    res.json({ ok: true, user: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Foydalanuvchini yaratish yoki yangilash (upsert) — login/sync paytida chaqiriladi
app.post('/api/users', async (req, res) => {
  try {
    const { id, name, username, balance, expiry, cardNumber } = req.body;
    if (!id) return res.status(400).json({ ok: false, error: 'id majburiy' });

    const { rows } = await pool.query(
      `INSERT INTO users (id, name, username, balance, expiry, card_number, last_seen)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (id) DO UPDATE SET
         name        = COALESCE($2, users.name),
         username    = COALESCE($3, users.username),
         balance      = COALESCE($4, users.balance),
         expiry       = COALESCE($5, users.expiry),
         card_number  = COALESCE($6, users.card_number),
         last_seen    = NOW()
       RETURNING *`,
      [String(id), name || null, username || null,
       (balance === undefined || balance === null) ? null : balance,
       (expiry  === undefined || expiry  === null) ? null : expiry,
       cardNumber || null]
    );
    res.json({ ok: true, user: rows[0] });
  } catch (e) {
    console.error('User upsert error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Faqat balans/muddatni yangilash (premium sotib olish, balans yechish/qo'shish)
app.patch('/api/users/:id/balance', async (req, res) => {
  try {
    const { balance, expiry } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO users (id, balance, expiry, last_seen)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE SET
         balance    = COALESCE($2, users.balance),
         expiry     = COALESCE($3, users.expiry),
         last_seen  = NOW()
       RETURNING *`,
      [req.params.id,
       (balance === undefined || balance === null) ? null : balance,
       (expiry  === undefined || expiry  === null) ? null : expiry]
    );
    res.json({ ok: true, user: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Blokirovka qilish / ochish (faqat admin)
app.patch('/api/users/:id/block', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const { blocked } = req.body;
    const { rows } = await pool.query(
      `UPDATE users SET blocked=$2 WHERE id=$1 RETURNING *`,
      [req.params.id, !!blocked]
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Topilmadi' });
    res.json({ ok: true, user: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Karta raqamini saqlash (foydalanuvchi profilida ko'rsatish uchun, admin paneldan)
app.patch('/api/users/:id/card', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const { cardNumber } = req.body;
    const { rows } = await pool.query(
      `UPDATE users SET card_number=$2 WHERE id=$1 RETURNING *`,
      [req.params.id, cardNumber || '']
    );
    if (!rows.length) return res.status(404).json({ ok: false, error: 'Topilmadi' });
    res.json({ ok: true, user: rows[0] });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Foydalanuvchini o'chirish (admin)
app.delete('/api/users/:id', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ═══════════════════════════════════════
   POSTER BASE64  POST /api/upload/poster-base64
   Telegram Mini App ichidan ishlaydi
═══════════════════════════════════════ */
app.post('/api/upload/poster-base64', async (req, res) => {
  if (!checkAdmin(req, res)) return;
  try {
    const { base64, mimetype } = req.body;
    if (!base64) return res.status(400).json({ ok: false, error: 'base64 kerak' });

    const buffer = Buffer.from(base64, 'base64');
    const mime = mimetype || 'image/jpeg';

    const { rows } = await pool.query(
      `INSERT INTO video_files (part_num, data, mimetype, size)
       VALUES (0, $1, $2, $3) RETURNING id`,
      [buffer, mime, buffer.length]
    );

    const imgId = rows[0].id;
    const base = process.env.RAILWAY_PUBLIC_DOMAIN
      ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN
      : 'https://ilova-production.up.railway.app';
    const imgUrl = `${base}/api/image/${imgId}`;

    res.json({ ok: true, image_id: imgId, url: imgUrl });
  } catch (e) {
    console.error('Poster base64 upload error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});


/* ═══════════════════════════════════════
   B2 UPLOAD PROXY  POST /b2upload
   (Cloudflare Worker o'rniga Railway backend ishlatadi)
═══════════════════════════════════════ */
app.post('/b2upload', upload.single('file'), async (req, res) => {
  try {
    const keyId    = req.headers['x-b2-key-id'];
    const appKey   = req.headers['x-b2-app-key'];
    const bucket   = req.headers['x-b2-bucket'];
    const region   = req.headers['x-b2-region'];
    const objKey   = req.headers['x-b2-key'];
    const fileType = req.headers['x-file-type'] || 'application/octet-stream';

    if (!keyId || !appKey || !bucket || !region || !objKey) {
      return res.status(400).json({ error: "Kerakli headerlar yo'q" });
    }

    // Raw body olish
    const fileBuffer = req.file ? req.file.buffer : await getRawBody(req);

    const { createHmac, createHash } = require('crypto');

    function sha256hex(data) {
      return createHash('sha256').update(data).digest('hex');
    }
    function hmacSha256(key, data) {
      return createHmac('sha256', key).update(data).digest();
    }

    const now = new Date();
    const pad = n => String(n).padStart(2,'0');
    const amzDate   = now.toISOString().replace(/[-:]/g,'').replace(/\.\d+/,'').slice(0,15) + 'Z';
    const dateStamp = amzDate.slice(0,8);

    const host      = `s3.${region}.backblazeb2.com`;
    const uploadUrl = `https://${host}/${bucket}/${objKey}`;

    const payloadHash = sha256hex(fileBuffer);

    const canonHeaders = `content-type:${fileType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
    const canonReq = `PUT\n/${bucket}/${objKey}\n\n${canonHeaders}\n${signedHeaders}\n${payloadHash}`;
    const credScope = `${dateStamp}/${region}/s3/aws4_request`;
    const strToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credScope}\n${sha256hex(canonReq)}`;

    const kDate    = hmacSha256('AWS4' + appKey, dateStamp);
    const kRegion  = hmacSha256(kDate, region);
    const kService = hmacSha256(kRegion, 's3');
    const kSign    = hmacSha256(kService, 'aws4_request');
    const signature = createHmac('sha256', kSign).update(strToSign).digest('hex');

    const authHeader = `AWS4-HMAC-SHA256 Credential=${keyId}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const https = require('https');
    const urlMod = require('url');

    const parsed = urlMod.parse(uploadUrl);
    const options = {
      hostname: parsed.hostname,
      path: parsed.path,
      method: 'PUT',
      headers: {
        'Authorization': authHeader,
        'Content-Type': fileType,
        'Content-Length': fileBuffer.length,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
      }
    };

    await new Promise((resolve, reject) => {
      const reqB2 = https.request(options, (respB2) => {
        let body = '';
        respB2.on('data', d => body += d);
        respB2.on('end', () => {
          if (respB2.statusCode >= 200 && respB2.statusCode < 300) {
            const publicUrl = `https://s3.${region}.backblazeb2.com/${bucket}/${objKey}`;
            res.json({ url: publicUrl });
            resolve();
          } else {
            res.status(500).json({ error: `B2 xato ${respB2.statusCode}: ${body.slice(0,200)}` });
            resolve();
          }
        });
      });
      reqB2.on('error', (e) => {
        res.status(500).json({ error: e.message });
        reject(e);
      });
      reqB2.write(fileBuffer);
      reqB2.end();
    });

  } catch (e) {
    console.error('b2upload error:', e);
    res.status(500).json({ error: e.message });
  }
});


app.get('/health', (_, res) => res.json({ ok: true, time: new Date() }));

app.listen(PORT, () => console.log(`🎬 KinoDrama API: http://localhost:${PORT}`));
