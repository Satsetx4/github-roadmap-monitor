# GitHub Multi-Project Roadmap Monitor

Dashboard satu file untuk memantau progres roadmap semua repo GitHub: Milestones → ROADMAP.md → Issues (3-Tier Fallback), via GitHub GraphQL API v4 (1 HTTP call per 50 repo).

## Cara pakai (user)

1. Buka link live → langsung jalan dalam **Mode Demo** (9 proyek contoh).
2. **Tanpa token:** klik "Konfigurasi Token GitHub", masukkan Fine-Grained PAT (Contents + Issues, Read-only), klik "Hubungkan & Tarik Data".
3. **Jika server sudah dipasang token:** tombol "Sync Sekarang" langsung tarik data live via server proxy, tanpa input token.

## Cara pasang token server (buat owner)

1. Buat Fine-Grained PAT GitHub (Contents + Issues: Read-only, + Projects read bila pakai board Projects v2).
2. Di Vercel: Project > Settings > Environment Variables > tambah `GITHUB_PAT` = token → Redeploy.
3. Cek: buka `<live-url>/api/roadmaps` → harus balas JSON `{"ok":true,...}`. Kalau `NO_TOKEN`, berarti env belum masuk.
4. Aksi tulis (P4): tambah `GITHUB_WRITE_PAT` (Issues + Projects: Read & write) dan `GITHUB_WEBHOOK_SECRET` (string acak 32+ char) → Redeploy.
5. Webhook (P4): GitHub repo/org → Settings → Webhooks → Payload URL `https://<domain>/api/webhook/github` (rewrite ke `/api/webhook-github`), Content type `application/json`, Secret = `GITHUB_WEBHOOK_SECRET`, Events: Issues + Milestone + Push. Batas jujur: invalidate cache webhook best-effort (function terisolasi, upgrade path KV).

Lokal: copy `.env.example` jadi `.env`, isi `GITHUB_PAT`, jalankan via `vercel dev`.

## Struktur

- `index.html` — seluruh aplikasi (UI + logika 3-Tier Fallback + Mode Demo).
- `api/roadmaps.js` — proxy server (Vercel Function): simpan token, cache memori 12 menit, `?force=1` = sync ulang.
- `api/actions.js` — Quick Actions tulis (P4): `closeIssue`, `updateProjectV2ItemFieldValue`, token `GITHUB_WRITE_PAT` di server, konfirmasi dua langkah di modal.
- `api/webhook-github.js` — receiver webhook (P4): verifikasi HMAC `X-Hub-Signature-256`, path kanonis `/api/webhook/github` via `vercel.json`.
- `HANDOVER.md` — spesifikasi + backlog P2–P4.

## Status

- P1 DONE: backend proxy + cache + frontend proxy-first (token manual tetap fallback).
- P2 DONE: Timeline/Gantt + Kanban Aggregator (4 mode view, default Grid).
- P3 DONE: sub-progress per heading ROADMAP.md + Projects v2 (aditif, fallback query bila API tolak).
- P4 DONE: Quick Actions + webhook receiver (butuh `GITHUB_WRITE_PAT` + `GITHUB_WEBHOOK_SECRET` dari owner via dashboard).
