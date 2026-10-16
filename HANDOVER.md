# AI Agent Handover & Technical Specification
**Project Name:** GitHub Multi-Project Roadmap Monitor
**Current Version:** v2.0 (P1-P4 DONE)
**Live:** https://github-roadmap-monitor-sekawan.vercel.app (publik, SSO dibuka)
**Repo:** https://github.com/Satsetx4/github-roadmap-monitor
**Lokal:** `D:/!AGY/github-roadmap-monitor`
**Commits:** `a97b443` P1, `5835212` P2+P3+P4
**SHA index.html live==repo (2026-10-17):** `6e8b50859d73b5811a371ac027f201c9fc35de886e5403e2bb28386478fa884b`

---

## 0. Status Terkini (lanjut sesi berikut baca ini dulu)

Semua goals P1-P4 DONE. QA browser 32/32 lolos. Visual 4/4 aman.

* **P1 DONE:** `api/roadmaps.js` proxy GraphQL + cache memori 12 menit + `?force=1`. Frontend proxy-first, badge `Live via Server Aman`. Token manual + Mode Demo tetap fallback.
* **P2 DONE:** Switcher 4 mode GRID/TABLE/TIMELINE/KANBAN (default GRID). `renderTimeline()` per bulan + badge Overdue/H-<=14 hari + klik buka modal. `renderKanban()` 3 kolom To Do/Doing/Done. Filter/search/sort berlaku semua view. Mobile aman (timeline scroll-x dalam section, kanban stack vertikal).
* **P3 DONE:** `parseMarkdownChecklist()` + `phaseProgress[]` per heading. `ROADMAP_QUERY` + `projectsV2(first:10)` di `index.html` dan `api/roadmaps.js` via builder + fallback query dasar bila API tolak. `normalize` aditif `phaseProgress` + `projectsV2`. Badge + bar fase di kartu/modal. Mock 2 board di repo-2.
* **P4 DONE (owner izinkan eksplisit):** `api/actions.js` (`closeIssue`, `updateProjectV2ItemFieldValue`, token `GITHUB_WRITE_PAT` server saja, validasi, audit tanpa token). `api/webhook-github.js` (HMAC SHA256 `X-Hub-Signature-256`, timing-safe, events issues/milestone/push best-effort). Frontend Quick Actions 2 langkah di modal (tombol nonaktif jujur bila ID node belum ada). `vercel.json` rewrite `/api/webhook/github` -> `/api/webhook-github`.

Struktur repo:
* `index.html` — seluruh aplikasi.
* `api/roadmaps.js` — GET proxy + cache.
* `api/actions.js` — POST Quick Actions tulis.
* `api/webhook-github.js` — POST webhook receiver.
* `vercel.json` — rewrite webhook kanonis.
* `.env.example` — `GITHUB_PAT`, `GITHUB_WRITE_PAT`, `GITHUB_WEBHOOK_SECRET`, `CACHE_TTL_SECONDS`.
* `README.md` — cara pakai + pasang token.

Endpoint live jawab benar (2026-10-17):
* `/api/roadmaps` -> `NO_TOKEN` (normal, env belum diisi).
* `/api/actions` POST -> `NO_WRITE_TOKEN` (normal, env belum diisi).
* `/api/webhook/github` GET -> `METHOD` (normal, wajib POST).

Tugas owner via dashboard Vercel (jangan di chat):
1. `GITHUB_PAT` (Contents + Issues read, + Projects read) -> data live.
2. `GITHUB_WRITE_PAT` (Issues + Projects tulis) -> Quick Actions.
3. `GITHUB_WEBHOOK_SECRET` (acak 32+ char) -> webhook. Payload URL `https://github-roadmap-monitor-sekawan.vercel.app/api/webhook/github`, JSON, Events Issues + Milestone + Push.

Batas jujur: invalidate cache webhook best-effort (function terisolasi). Upgrade path KV bila butuh real-time penuh.

---

## 1. Instruksi Utama untuk Agent Penerima (System Context)

Anda melanjutkan pengembangan proyek **GitHub Multi-Project Roadmap Monitor**.

**Peran & Aturan Kerja Anda:**
* **Baca `index.html` terlebih dahulu** sebelum menulis atau memodifikasi kode apa pun. Jangan menghapus fitur yang sudah berjalan.
* **Pertahankan Arsitektur GraphQL Hibrida:** Aplikasi ini menggunakan **GitHub GraphQL API v4** (`POST https://api.github.com/graphql`) untuk menarik seluruh repositori, *Milestones*, isi file `ROADMAP.md`, dan rasio *Issues* hanya dalam **1 kali panggilan HTTP** per 50 repositori. **DILARANG** mengubah pengambilan data utama menjadi REST API v3 yang memicu masalah *N+1 HTTP requests*.
* **Pertahankan Logika 3-Tier Fallback:** Setiap repositori memiliki cara pencatatan *roadmap* yang berbeda. Jangan merusak urutan prioritas kalkulasi progres yang sudah ada.
* **Pertahankan Mode Demo Simulasi:** Aplikasi harus tetap memiliki data simulasi (`getMockRawGraphQLNodes()`) agar UI dapat diuji secara interaktif meskipun pengguna belum memasukkan *Personal Access Token* (PAT) atau saat *backend* belum aktif.

---

## 2. Arsitektur & Fitur yang Sudah Selesai di `index.html` (Status Saat Ini)

### A. Query GraphQL API v4 (`ROADMAP_QUERY`)
* Mengambil metrik `rateLimit { limit cost remaining resetAt }`.
* Mengambil daftar repositori milik pengguna (`ownerAffiliations: [OWNER]`, `isFork: false`, diurutkan berdasarkan `PUSHED_AT DESC`) lengkap dengan dukungan *auto-pagination* berbasis kursor (`pageInfo { hasNextPage endCursor }`).
* Mengambil `milestones(first: 10, states: [OPEN, CLOSED])` beserta jumlah `openIssues` dan `closedIssues` di tiap *milestone*.
* Mengambil teks mentah file Markdown langsung dari *branch* utama menggunakan GraphQL Blob alias:
  * `roadmapUpper: object(expression: "HEAD:ROADMAP.md") { ... on Blob { text } }`
  * `roadmapLower: object(expression: "HEAD:roadmap.md") { ... on Blob { text } }`
* Mengambil total `openIssues` dan `closedIssues` di tingkat repositori.
* P3: tambah `projectsV2(first: 10)` + `fieldValues(first: 20)` + `fields(first: 20)` via `buildRoadmapQuery(true)`. Fallback `ROADMAP_QUERY_BASE` tanpa Projects bila API tolak. Tetap 1 HTTP call per 50 repo.

### B. Logika 3-Tier Fallback (`normalizeRepositoryRoadmap(repo)`)
1. **Tier 1 (`MILESTONE`):** progres dari akumulasi *closed issues* / total *issues* seluruh *milestone* (atau rata-rata `progressPercentage` bila tanpa issue). Target terdekat dari *milestone* `OPEN`.
2. **Tier 2 (`ROADMAP.MD`):** `parseMarkdownChecklist()` ekstrak `- [x]` vs `- [ ]` + `section` dari `#`, `##`, `###`. P3 tambah `phaseProgress[]` per section.
3. **Tier 3 (`ISSUES`):** progres dari `closedIssues / (openIssues + closedIssues)`.
4. **Tier 4 (`NONE`):** ketiganya kosong -> `No Roadmap`.

### C. Evaluasi Kesehatan Proyek (`evaluateProjectHealth()`)
* `Completed`: progres 100% dan total tugas > 0.
* `Overdue`: ada *milestone* aktif `dueOn` terlewati.
* `Stale`: < 100% dan tanpa push > 30 hari.
* `On Track`: aktif, ada roadmap, tak lewat tenggat.
* `No Roadmap`: total tugas = 0.

### D. Komponen Antarmuka (UI/UX)
* **Header & Rate Limit Counter:** mode (*Live via Server Aman* vs *Live GitHub API* vs *Mode Demo Simulasi*), bar kuota, biaya, waktu reset.
* **Global Portfolio Summary Cards:** 6 kartu metrik + quick-filter saat diklik.
* **Filter, Search & Multi-View Switcher:** search real-time, filter health, filter source, sort, toggle **Grid / Tabel / Timeline / Kanban**.
* **Modal Detail Roadmap:** Milestones / checklist + bar fase + daftar Projects v2 + salin JSON + Quick Actions P4.
* **Modal Konfigurasi Token:** input Fine-Grained PAT + `localStorage`.
* **Modal GraphQL Query Inspector:** tampilkan `ROADMAP_QUERY` + salin.

---

## 3. Kontrak Data Ternormalisasi (Data Schema)

Perubahan visualisasi **WAJIB** ikut struktur `normalizeRepositoryRoadmap(repo)` (aditif saja, key lama jangan ubah):

```json
{
  "id": "string",
  "name": "string",
  "description": "string",
  "url": "string (URL GitHub)",
  "isPrivate": true,
  "language": "string",
  "languageColor": "#hexcolor",
  "pushedAt": "ISO-8601 Date String",
  "updatedAt": "ISO-8601 Date String",
  "roadmap": {
    "source": "MILESTONE | ROADMAP.MD | ISSUES | NONE",
    "healthStatus": "On Track | Overdue | Stale | Completed | No Roadmap",
    "progress": 75,
    "completedTasks": 6,
    "openTasks": 2,
    "totalTasks": 8,
    "activeMilestoneTitle": "string | null",
    "nextDueDate": "ISO-8601 Date String | null",
    "milestonesList": [
      {
        "id": "string",
        "title": "string",
        "state": "OPEN | CLOSED",
        "dueOn": "ISO-8601 Date String | null",
        "progress": 75,
        "open": 3,
        "closed": 9
      }
    ],
    "checklistItems": [
      {
        "done": true,
        "text": "string",
        "section": "string (Heading Markdown)"
      }
    ],
    "rawMarkdown": "string | null",
    "phaseProgress": [{ "section": "string", "done": 1, "total": 2, "progress": 50 }],
    "projectsV2": [{ "id": "string | null", "title": "string", "status": "string | null", "targetDate": "ISO-8601 | null" }]
  }
}
```

---

## 4. Backlog (semua DONE, tinggal tugas owner)

* Prioritas 1 DONE: backend proxy + cache server + frontend proxy-first.
* Prioritas 2 DONE: Timeline/Gantt + Kanban Aggregator.
* Prioritas 3 DONE: sub-progress per heading + Projects v2.
* Prioritas 4 DONE kode: Quick Actions + webhook receiver. Aktivasinya tugas owner (env + webhook daftar, lihat section 0).

---

## 5. Spesifikasi Teknis & Desain yang Wajib Dijaga (Guardrails)

* **Styling:** **Tailwind CSS** palet `slate-950`, `slate-900`, `slate-800`, aksen `indigo-500/600`, `cyan-400`, `emerald-400`, `rose-400`, `amber-400`.
* **Tipografi:** `Inter` umum, `JetBrains Mono` repo/angka/persentase/kode.
* **Zero External UI Framework Bloat:** tetap Single-File + Vanilla JS, tanpa library baru. Migrasi React/Vue hanya bila owner minta eksplisit.

---

## 6. Prompt Kickoff Siap Pakai (Copy-Paste ke Agent Baru)

> "Saya melampirkan `HANDOVER.md` dan repo `Satsetx4/github-roadmap-monitor` (live https://github-roadmap-monitor-sekawan.vercel.app). Status P1-P4 DONE, baca section 0 HANDOVER dulu. Tugas: [sebutkan target]. Jaga query hibrida 1 call/50 repo, urutan 3-Tier, Mode Demo, kontrak aditif. Verifikasi browser + push + deploy + bukti live."
