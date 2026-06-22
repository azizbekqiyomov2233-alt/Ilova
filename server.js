/* KINO DRAMA PREMIUM — Railway backend
 * - Video upload (max 700 MB) -> diskka saqlanadi
 * - Metadata MySQL ga saqlanadi
 * - Public URL qaytaradi: https://<railway-domain>/videos/<filename>
 * - Movies CRUD (mavjud frontend bilan mos)
 */
const express = require('express');
const cors    = require('cors');
const multer  = require('multer');
const mysql   = require('mysql2/promise');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const MAX_SIZE   = 700 * 1024 * 1024; // 700 MB

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- MySQL ----------
// Railway MySQL plugin avtomatik beradi: MYSQLHOST, MYSQLUSER, MYSQLPASSWORD, MYSQLDATABASE, MYSQLPORT
// Yoki bitta MYSQL_URL.
let pool;
async function initDb() {
  const cfg = process.env.MYSQL_URL
    ? process.env.MYSQL_URL
    : {
        host: process.env.MYSQLHOST || process.env.DB_HOST,
        port: +(process.env.MYSQLPORT || process.env.DB_PORT || 3306),
        user: process.env.MYSQLUSER || process.env.DB_USER,
        password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD,
        database: process.env.MYSQLDATABASE || process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 10,
      };
  pool = await mysql.createPool(cfg);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS videos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      filename VARCHAR(255) NOT NULL,
      original_name VARCHAR(512),
      mime VARCHAR(128),
      size BIGINT,
      url VARCHAR(1024) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS movies (
      id VARCHAR(64) PRIMARY KEY,
      data JSON NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
  console.log('✅ MySQL ready');
}

// ---------- Multer (700MB limit) ----------
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp4';
    const id  = crypto.randomBytes(12).toString('hex');
    cb(null, `${Date.now()}_${id}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
});

// ---------- App ----------
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '5mb' }));

// Static video serving
app.use('/videos', express.static(UPLOAD_DIR, {
  maxAge: '7d',
  setHeaders: (res) => {
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  },
}));

app.get('/', (_req, res) => res.json({ ok: true, service: 'kdp-backend', maxSize: MAX_SIZE }));
app.get('/health', (_req, res) => res.json({ ok: true }));

// ---------- VIDEO UPLOAD ----------
app.post('/api/upload-video', (req, res) => {
  upload.single('video')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Fayl 700 MB dan katta!' });
      }
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) return res.status(400).json({ error: 'Fayl yo\'q' });

    const host = req.get('host');
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0];
    const url = `${proto}://${host}/videos/${req.file.filename}`;

    try {
      await pool.query(
        'INSERT INTO videos (filename, original_name, mime, size, url) VALUES (?,?,?,?,?)',
        [req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, url]
      );
    } catch (e) { console.error('DB insert err', e); }

    res.json({ ok: true, url, filename: req.file.filename, size: req.file.size });
  });
});

app.get('/api/videos', async (_req, res) => {
  const [rows] = await pool.query('SELECT * FROM videos ORDER BY id DESC LIMIT 500');
  res.json(rows);
});

app.delete('/api/videos/:filename', async (req, res) => {
  const fn = path.basename(req.params.filename);
  const fp = path.join(UPLOAD_DIR, fn);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  await pool.query('DELETE FROM videos WHERE filename=?', [fn]);
  res.json({ ok: true });
});

// ---------- MOVIES CRUD ----------
app.get('/api/movies', async (_req, res) => {
  const [rows] = await pool.query('SELECT data FROM movies ORDER BY updated_at DESC');
  res.json(rows.map(r => typeof r.data === 'string' ? JSON.parse(r.data) : r.data));
});

app.post('/api/movies', async (req, res) => {
  const m = req.body || {};
  if (!m.id) m.id = String(Date.now());
  await pool.query(
    'INSERT INTO movies (id,data) VALUES (?,?) ON DUPLICATE KEY UPDATE data=VALUES(data)',
    [String(m.id), JSON.stringify(m)]
  );
  res.json({ ok: true, id: m.id });
});

app.put('/api/movies/:id', async (req, res) => {
  const id = String(req.params.id);
  const m  = { ...(req.body || {}), id };
  await pool.query(
    'INSERT INTO movies (id,data) VALUES (?,?) ON DUPLICATE KEY UPDATE data=VALUES(data)',
    [id, JSON.stringify(m)]
  );
  res.json({ ok: true });
});

app.put('/api/movies/:id/episode-prices', async (req, res) => {
  const id = String(req.params.id);
  const [rows] = await pool.query('SELECT data FROM movies WHERE id=?', [id]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  const data = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
  data.episodePrices = req.body.episodePrices || {};
  await pool.query('UPDATE movies SET data=? WHERE id=?', [JSON.stringify(data), id]);
  res.json({ ok: true });
});

app.delete('/api/movies/:id', async (req, res) => {
  await pool.query('DELETE FROM movies WHERE id=?', [String(req.params.id)]);
  res.json({ ok: true });
});

// ---------- Start ----------
initDb()
  .then(() => app.listen(PORT, () => console.log(`🚀 listening :${PORT}`)))
  .catch(e => { console.error('DB init failed', e); process.exit(1); });
