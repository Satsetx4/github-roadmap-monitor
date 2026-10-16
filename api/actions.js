// POST /api/actions — Quick Actions tulis, same-origin only.
// Auth: token tulis dari env GITHUB_WRITE_PAT saja. JANGAN pakai GITHUB_PAT
// (read-only) dan JANGAN terima token dari browser (body/header/cookie).
// Aksi: closeIssue { issueId } | updateProjectV2Item { projectId, itemId, fieldId, value }
// Audit log JSON tanpa token. Pesan error aman (tak bocorkan PAT / mentahan upstream).
// ponytail: Vercel function terisolasi — invalidate cache /api/roadmaps lintas
// instance tak dijamin (best-effort). Upgrade path: cache terpusat (KV/Upstash)
// lalu panggil revalidate dari sini.

const GITHUB_GRAPHQL_ENDPOINT = 'https://api.github.com/graphql';
const MAX_BODY_BYTES = 64 * 1024;
// Node ID GitHub = base64: huruf, angka, + / = plus pemisah umum, 4-200 char.
const ID_RE = /^[A-Za-z0-9_+\/=:.~-]{4,200}$/;
const VALUE_KEYS = ['singleSelectOptionId', 'text', 'number', 'date'];

const MUTATIONS = {
  closeIssue: `mutation CloseIssue($issueId: ID!) {
    closeIssue(input: { issueId: $issueId }) { issue { id closed closedAt } }
  }`,
  updateProjectV2Item: `mutation UpdateItem($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
    updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: $value }) {
      projectV2Item { id }
    }
  }`,
};

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body !== undefined) {
      if (req.body && typeof req.body === 'object') return resolve(req.body);
      if (typeof req.body === 'string' && req.body.length) {
        try { return resolve(JSON.parse(req.body)); }
        catch { return reject(new Error('Body bukan JSON valid.')); }
      }
    }
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) reject(new Error('Body melebihi 64KB.'));
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('Body bukan JSON valid.')); }
    });
    req.on('error', reject);
  });
}

function fail(res, http, error, message) {
  res.status(http).json({ ok: false, error, message });
}

function short(id) {
  const s = String(id || '-');
  return s.length > 12 ? s.slice(0, 8) + '…' : s;
}

function audit(action, target, ok, note) {
  // Tanpa token, tanpa header auth, tanpa body mentah.
  console.log(JSON.stringify({
    ts: new Date().toISOString(), scope: 'actions',
    action: String(action || '?'), target: short(target), ok: !!ok,
    note: note ? String(note).slice(0, 120) : undefined,
  }));
}

function checkId(v) {
  return typeof v === 'string' && ID_RE.test(v);
}

// Validasi di trust boundary. Kembalikan { mutation, variables, target } atau { error }.
function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Body JSON { action, ... } wajib.' };
  }
  if (body.action === 'closeIssue') {
    if (!checkId(body.issueId)) return { error: 'issueId (node ID GitHub) wajib, format ID tak valid.' };
    return { mutation: MUTATIONS.closeIssue, variables: { issueId: body.issueId }, target: body.issueId };
  }
  if (body.action === 'updateProjectV2Item') {
    for (const k of ['projectId', 'itemId', 'fieldId']) {
      if (!checkId(body[k])) return { error: k + ' wajib, format ID tak valid.' };
    }
    const v = body.value;
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      return { error: 'value wajib objek ProjectV2FieldValue.' };
    }
    const keys = Object.keys(v).filter((k) => VALUE_KEYS.includes(k));
    if (keys.length !== 1) return { error: 'value wajib tepat 1 dari: ' + VALUE_KEYS.join(', ') + '.' };
    if (String(v[keys[0]]).length > 500) return { error: 'value terlalu panjang (maks 500 char).' };
    return {
      mutation: MUTATIONS.updateProjectV2Item,
      variables: { projectId: body.projectId, itemId: body.itemId, fieldId: body.fieldId, value: { [keys[0]]: v[keys[0]] } },
      target: body.itemId,
    };
  }
  return { error: 'action tak dikenal. Pilih: closeIssue | updateProjectV2Item.' };
}

// Same-origin best-effort: tolak bila header Origin browser tak cocok dengan host.
// Tanpa Origin (curl/server-to-server) tetap lolos — CSRF hanya relevan di browser.
function sameOrigin(req) {
  const origin = req.headers && req.headers.origin;
  if (!origin) return true;
  try {
    const rawHost = req.headers['x-forwarded-host'] || req.headers.host || '';
    const host = String(rawHost).split(',')[0].trim();
    return new URL(origin).host === host;
  } catch { return false; }
}

async function githubMutate(pat, mutation, variables) {
  if (process.env.ACTIONS_MOCK === '1') return { mock: true, data: { mock: true } }; // test-only, tanpa jaringan
  const r = await fetch(GITHUB_GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pat}`, 'User-Agent': 'github-roadmap-monitor-actions' },
    body: JSON.stringify({ query: mutation, variables }),
  });
  if (!r.ok) throw new Error('GitHub HTTP ' + r.status);
  const j = await r.json();
  if (j.errors && j.errors.length) throw new Error(String(j.errors[0].message).slice(0, 200));
  return { mock: false, data: j.data };
}

async function handler(req, res) {
  if (req.method !== 'POST') { fail(res, 405, 'METHOD', 'Gunakan POST.'); return; }
  if (!sameOrigin(req)) { audit('?', '-', false, 'cross-origin ditolak'); fail(res, 403, 'FORBIDDEN', 'Lintas origin ditolak.'); return; }

  const pat = process.env.GITHUB_WRITE_PAT;
  if (!pat) {
    audit('?', '-', false, 'GITHUB_WRITE_PAT kosong');
    fail(res, 503, 'NO_WRITE_TOKEN', 'Server belum punya token tulis. Owner: isi GITHUB_WRITE_PAT via dashboard Vercel.');
    return;
  }

  let body;
  try { body = await readJsonBody(req); }
  catch (e) { fail(res, 400, 'BODY', e.message); return; }

  const v = validate(body);
  if (v.error) { audit(body.action, '-', false, 'validasi: ' + v.error); fail(res, 400, 'VALIDATION', v.error); return; }

  try {
    const out = await githubMutate(pat, v.mutation, v.variables);
    audit(body.action, v.target, true, out.mock ? 'mock' : undefined);
    res.status(200).json({ ok: true, action: body.action, mock: out.mock || undefined, data: out.data });
  } catch (err) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), scope: 'actions', action: body.action, ok: false, upstream: String((err && err.message) || err).slice(0, 120) }));
    fail(res, 502, 'UPSTREAM', 'GitHub menolak mutasi. Cek izin tulis token / kebenaran ID node.');
  }
}

handler._test = { validate, sameOrigin, checkId, ID_RE, MUTATIONS };

module.exports = handler;
