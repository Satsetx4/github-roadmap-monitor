// POST /api/webhook-github — receiver webhook GitHub.
// Verifikasi HMAC SHA-256 header X-Hub-Signature-256 (crypto stdlib, timing-safe)
// memakai GITHUB_WEBHOOK_SECRET. Event issues/milestone/push: best-effort
// invalidate + log. Secret salah / tak ada: tolak tanpa bocorkan alasan kripto.
// ponytail: function terisolasi — tak bisa hapus cache memori /api/roadmaps milik
// instance lain. Upgrade path: cache terpusat (KV/Upstash) + tulis flag revalidate di sini.
// Daftarkan di GitHub repo/org: Settings > Webhooks > payload JSON, event
// issues + milestone + push. (Path kanonis HANDOVER /api/webhook/github dipetakan
// via vercel.json rewrite — lihat p4_insert_guide.md.)

const crypto = require('crypto');
const MAX_BODY_BYTES = 1024 * 1024;
const CACHED_EVENTS = ['issues', 'milestone', 'push'];

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    if (req.rawBody) return resolve(Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(req.rawBody));
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) reject(new Error('Payload melebihi 1MB.'));
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sign(secret, raw) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
}

function verifySignature(secret, raw, header) {
  if (!secret || !header || typeof header !== 'string') return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return false;
  let a, b;
  try {
    a = Buffer.from(m[1].toLowerCase(), 'hex');
    b = Buffer.from(crypto.createHmac('sha256', secret).update(raw).digest('hex'), 'hex');
  } catch { return false; }
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function logEvent(delivery, event, action, repo, extra) {
  console.log(JSON.stringify(Object.assign({
    ts: new Date().toISOString(), scope: 'webhook',
    delivery: String(delivery || '-').slice(0, 64), event, action: action || null, repo: repo || null,
  }, extra)));
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'METHOD', message: 'Gunakan POST.' });
    return;
  }

  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    res.status(503).json({ ok: false, error: 'NO_SECRET', message: 'Webhook belum dikonfigurasi server.' });
    return;
  }

  let raw;
  try { raw = await readRawBody(req); }
  catch (e) { res.status(400).json({ ok: false, error: 'BODY', message: e.message }); return; }

  if (!verifySignature(secret, raw, req.headers && req.headers['x-hub-signature-256'])) {
    logEvent(req.headers && req.headers['x-github-delivery'], req.headers && req.headers['x-github-event'], null, null, { ok: false, note: 'tanda tangan tak valid' });
    res.status(401).json({ ok: false, error: 'BAD_SIGNATURE', message: 'Tanda tangan webhook tak valid.' });
    return;
  }

  let payload = {};
  try { payload = JSON.parse(raw.toString('utf8')); }
  catch { res.status(400).json({ ok: false, error: 'BODY', message: 'Payload bukan JSON valid.' }); return; }

  const event = req.headers && req.headers['x-github-event'];
  const delivery = req.headers && req.headers['x-github-delivery'];
  const action = payload.action || null;
  const repo = payload.repository && payload.repository.full_name;

  if (event === 'ping') {
    logEvent(delivery, event, null, repo, { ok: true, note: 'pong' });
    res.status(200).json({ ok: true, pong: true });
    return;
  }

  if (CACHED_EVENTS.includes(event)) {
    // Best-effort: instance ini tak pegang cache instance lain — catat agar
    // sinkronisasi berikut (?force=1) menarik ulang. Tak ada invalidate silang.
    logEvent(delivery, event, action, repo, { ok: true, invalidated: false, note: 'best-effort; upgrade KV' });
    res.status(200).json({ ok: true, event, action, invalidated: false, note: 'Cache di-refresh pada sinkronisasi berikut.' });
    return;
  }

  logEvent(delivery, event, action, repo, { ok: true, ignored: true });
  res.status(200).json({ ok: true, ignored: true, event: event || null });
}

handler._test = { sign, verifySignature, CACHED_EVENTS };

module.exports = handler;
