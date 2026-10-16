# GitHub Multi-Project Roadmap Monitor

Dashboard satu file untuk memantau progres roadmap semua repo GitHub: Milestones → ROADMAP.md → Issues (3-Tier Fallback), via GitHub GraphQL API v4 (1 HTTP call per 50 repo).

## Cara pakai (user)

1. Buka link live → langsung jalan dalam **Mode Demo** (9 proyek contoh).
2. **Tanpa token:** klik "Konfigurasi Token GitHub", masukkan Fine-Grained PAT (Contents + Issues, Read-only), klik "Hubungkan & Tarik Data".
3. **Jika server sudah dipasang token:** tombol "Sync Sekarang" langsung tarik data live via server proxy, tanpa input token.

## Cara pasang token server (buat owner)

1. Buat Fine-Grained PAT GitHub (Contents + Issues: Read-only).
2. Di Vercel: Project > Settings > Environment Variables > tambah `GITHUB_PAT` = token → Redeploy.
3. Cek: buka `<live-url>/api/roadmaps` → harus balas JSON `{"ok":true,...}`. Kalau `NO_TOKEN`, berarti env belum masuk.

Lokal: copy `.env.example` jadi `.env`, isi `GITHUB_PAT`, jalankan via `vercel dev`.

## Struktur

- `index.html` — seluruh aplikasi (UI + logika 3-Tier Fallback + Mode Demo).
- `api/roadmaps.js` — proxy server (Vercel Function): simpan token, cache memori 12 menit, `?force=1` = sync ulang.
- `HANDOVER.md` — spesifikasi + backlog P2–P4.

## Status

- P1 DONE: backend proxy + cache + frontend proxy-first (token manual tetap fallback).
- Berikutnya: P2 Timeline/Gantt + Kanban, P3 sub-progress heading + Projects v2, P4 Quick Actions + webhook.
