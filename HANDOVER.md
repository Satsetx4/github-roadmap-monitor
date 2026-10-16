# AI Agent Handover & Technical Specification
**Project Name:** GitHub Multi-Project Roadmap Monitor  
**Current Version:** v1.0 (MVP Single-Page Application)  
**Included Artifact:** `index.html` (Self-contained HTML + Tailwind CSS + Vanilla ES6+ JS)

---

## 1. Instruksi Utama untuk Agent Penerima (System Context)

Anda melanjutkan pengembangan proyek **GitHub Multi-Project Roadmap Monitor**. Pengguna membawa dua file ke lingkungan kerja Anda:
1. `HANDOVER.md` (Dokumen spesifikasi & instruksi ini).
2. `index.html` (Prototipe MVP fungsional yang sudah berjalan penuh).

**Peran & Aturan Kerja Anda:**
* **Baca `index.html` terlebih dahulu** sebelum menulis atau memodifikasi kode apa pun. Jangan menghapus fitur yang sudah berjalan.
* **Pertahankan Arsitektur GraphQL Hibrida:** Aplikasi ini menggunakan **GitHub GraphQL API v4** (`POST https://api.github.com/graphql`) untuk menarik seluruh repositori, *Milestones*, isi file `ROADMAP.md`, dan rasio *Issues* hanya dalam **$1$ kali panggilan HTTP** per $50$ repositori. **DILARANG** mengubah pengambilan data utama menjadi REST API v3 yang memicu masalah *$N+1$ HTTP requests*.
* **Pertahankan Logika 3-Tier Fallback:** Setiap repositori memiliki cara pencatatan *roadmap* yang berbeda. Jangan merusak urutan prioritas kalkulasi progres yang sudah ada.
* **Pertahankan Mode Demo Simulasi:** Aplikasi harus tetap memiliki data simulasi (`getMockRawGraphQLNodes()`) agar UI dapat diuji secara interaktif meskipun pengguna belum memasukkan *Personal Access Token* (PAT) atau saat *backend* belum aktif.

---

## 2. Arsitektur & Fitur yang Sudah Selesai di `index.html` (Status Saat Ini)

Di dalam `index.html`, seluruh fondasi MVP telah diimplementasikan dan berfungsi dengan baik:

### A. Query GraphQL API v4 (`ROADMAP_QUERY`)
* Mengambil metrik `rateLimit { limit cost remaining resetAt }`.
* Mengambil daftar repositori milik pengguna (`ownerAffiliations: [OWNER]`, `isFork: false`, diurutkan berdasarkan `PUSHED_AT DESC`) lengkap dengan dukungan *auto-pagination* berbasis kursor (`pageInfo { hasNextPage endCursor }`).
* Mengambil `milestones(first: 10, states: [OPEN, CLOSED])` beserta jumlah `openIssues` dan `closedIssues` di tiap *milestone*.
* Mengambil teks mentah file Markdown langsung dari *branch* utama menggunakan GraphQL Blob alias:
  * `roadmapUpper: object(expression: "HEAD:ROADMAP.md") { ... on Blob { text } }`
  * `roadmapLower: object(expression: "HEAD:roadmap.md") { ... on Blob { text } }`
* Mengambil total `openIssues` dan `closedIssues` di tingkat repositori.

### B. Logika 3-Tier Fallback (`normalizeRepositoryRoadmap(repo)`)
Aplikasi menormalisasi setiap repositori dengan urutan prioritas berikut:
1. **Tier 1 (`MILESTONE`):** Jika repositori memiliki $\ge 1$ GitHub Milestone, progres dihitung dari akumulasi *closed issues* dibagi total *issues* di seluruh *milestone* (atau rata-rata `progressPercentage` jika *milestone* belum memiliki *issue*). Target tenggat terdekat diambil dari *milestone* berstatus `OPEN`.
2. **Tier 2 (`ROADMAP.MD`):** Jika tidak ada *Milestone*, fungsi `parseMarkdownChecklist()` mengekstrak *task list* Markdown (`- [x]` vs `- [ ]`) menggunakan *Regular Expression* beserta pengelompokan *sub-heading* (`#`, `##`, `###`).
3. **Tier 3 (`ISSUES`):** Jika tidak ada *Milestone* maupun `ROADMAP.md`, progres dihitung dari rasio `closedIssues / (openIssues + closedIssues)` pada repositori tersebut.
4. **Tier 4 (`NONE`):** Jika ketiganya kosong, repositori ditandai berstatus `No Roadmap`.

### C. Evaluasi Kesehatan Proyek (`evaluateProjectHealth()`)
Setiap repositori diberi *badge* status kesehatan otomatis:
* `Completed` (Biru): Progres mencapai $100\%$ dan total tugas $> 0$.
* `Overdue` (Merah): Memiliki *Milestone* aktif yang tanggal `dueOn`-nya sudah terlewati (`new Date(nextDueDate) < now`).
* `Stale` (Kuning): Proyek belum selesai ($< 100\%$) dan tidak memiliki aktivitas *git push* selama $> 30$ hari.
* `On Track` (Hijau): Proyek aktif, memiliki *roadmap*, dan tidak melewati tenggat waktu.
* `No Roadmap` (Abu-abu): Total tugas $= 0$.

### D. Komponen Antarmuka (UI/UX)
* **Header & Rate Limit Counter:** Indikator mode (*Live GitHub API* vs *Mode Demo Simulasi*), bar kuota GraphQL API (`remaining / limit`), biaya per sinkronisasi, dan waktu *reset*.
* **Global Portfolio Summary Cards:** $6$ kartu metrik di bagian atas yang sekaligus berfungsi sebagai tombol *quick-filter* saat diklik.
* **Filter, Search & Multi-View Switcher:** Pencarian *real-time*, filter status kesehatan, filter sumber *roadmap* (`MILESTONE`, `ROADMAP.MD`, `ISSUES`, `NONE`), pengurutan (*sorting*), serta *toggle* antara **Grid View** dan **Compact Table View**.
* **3 Modal Interaktif:**
  1. **Modal Detail Roadmap:** Menampilkan daftar *Milestones* atau daftar *checklist* hasil *parsing* `ROADMAP.md` beserta tombol salin JSON proyek.
  2. **Modal Konfigurasi Token:** Input *Fine-Grained PAT* dengan opsi penyimpanan `localStorage`.
  3. **Modal GraphQL Query Inspector:** Menampilkan kode `ROADMAP_QUERY` dan tombol salin.

---

## 3. Kontrak Data Ternormalisasi (Data Schema)

Setiap perubahan atau penambahan fitur visualisasi **WAJIB** mengikuti struktur objek hasil keluaran `normalizeRepositoryRoadmap(repo)` berikut agar kompatibel dengan komponen yang sudah ada:

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
    "rawMarkdown": "string | null"
  }
}
```

---

## 4. Peta Jalan Pengembangan Selanjutnya (Backlog untuk Agent Berikutnya)

Berikut adalah urutan prioritas fitur dan arsitektur yang harus dikerjakan oleh Agent selanjutnya sesuai instruksi pengguna:

### Prioritas 1: Pembuatan Backend Proxy & Server-Side Caching (Keamanan Token)
Saat ini `index.html` menyimpan token di `localStorage` dan memanggil GitHub API langsung dari *browser*. Untuk penggunaan produksi di *hosting*/VPS:
1. Buat *backend endpoint* ringan (pilih sesuai permintaan pengguna: **Node.js/Express**, **Next.js API Route**, atau **PHP `api-roadmap.php`**).
2. Simpan `GITHUB_PAT` di sisi server menggunakan variabel lingkungan (`.env`), sehingga *frontend* tidak pernah mengekspos token ke publik.
3. Tambahkan mekanisme **Server-Side File/Memory Cache** dengan TTL $10\text{--}15$ menit, serta parameter `?force=1` untuk tombol **Sync Sekarang**.
4. Ubah fungsi `fetchAllGitHubRoadmaps()` di *frontend* agar memanggil *endpoint proxy* lokal terlebih dahulu jika tersedia, dan tetap mempertahankan input token manual sebagai *fallback*.

### Prioritas 2: Penambahan Tampilan "Timeline / Gantt View" & "Kanban Aggregator"
Saat ini tombol *View Switcher* memiliki mode **Grid** dan **Tabel**. Tambahkan $2$ tab tampilan baru:
1. **Timeline / Gantt View:** Memvisualisasikan seluruh proyek yang memiliki `milestonesList` atau target tanggal rilis dalam bentuk garis waktu horizontal per bulan/kuartal, menyorot *milestone* yang mendekati tenggat waktu atau `Overdue`.
2. **Kanban Aggregator View:** Mengumpulkan seluruh item yang sedang berjalan dari semua repositori ke dalam $3$ kolom papan kerja terpadu:
   * **To Do / Open:** Item `checklistItems` yang belum dicentang (`done: false`) dan *Milestone* yang baru dimulai ($0\%$).
   * **In Progress:** *Milestone* atau fase `ROADMAP.md` dengan progres antara $1\%$ hingga $99\%$.
   * **Done / Completed:** *Milestone* berstatus `CLOSED` atau proyek yang sudah $100\%$.

### Prioritas 3: Pengelompokan Fase `ROADMAP.md` Setara Milestone & GitHub Projects v2
1. **Sub-Progress per Heading di `ROADMAP.md`:** Fungsi `parseMarkdownChecklist()` sudah menyimpan properti `section` (nama sub-heading seperti `## Fase 1`). Kembangkan fungsi tersebut agar mengelompokkan persentase progres per sub-heading sehingga proyek berbasis `ROADMAP.MD` juga menampilkan daftar kemajuan per fase layaknya *GitHub Milestones*.
2. **Integrasi `projectsV2`:** Tambahkan pengambilan node `projectsV2(first: 10)` pada `ROADMAP_QUERY` untuk membaca papan *GitHub Projects* lintas repositori beserta *custom field* `Status` dan `Target Date`.

### Prioritas 4: Quick Actions (GraphQL Mutations) & Webhook Receiver
1. **Quick Actions dari Modal Detail:** Tambahkan kemampuan menutup *issue* atau mencentang item langsung dari *dashboard* menggunakan mutasi GraphQL (`closeIssue`, `updateProjectV2ItemFieldValue`).
2. **GitHub Webhook Endpoint:** Buat *endpoint* penerima *webhook* (`POST /api/webhook/github`) dengan verifikasi tanda tangan HMAC `X-Hub-Signature-256` untuk langsung memperbarui *cache* setiap kali ada perubahan `issues`, `milestone`, atau `push` di GitHub.

---

## 5. Spesifikasi Teknis & Desain yang Wajib Dijaga (Guardrails)

* **Styling:** Gunakan **Tailwind CSS** dengan palet warna utama `slate-950` (latar utama), `slate-900` (kartu/panel), `slate-800` (garis batas), aksen `indigo-500/600` (elemen utama & Milestone), `cyan-400` (`ROADMAP.md`), `emerald-400` (*On Track*), `rose-400` (*Overdue*), dan `amber-400` (*Stale* / *Issues*).
* **Tipografi:** Gunakan font `Inter` untuk antarmuka umum dan `JetBrains Mono` untuk nama repositori, metrik angka, persentase, serta kode *query*.
* **Zero External UI Framework Bloat (Kecuali Diminta Migrasi):** Jika pengguna meminta tetap dalam format *Single-File HTML* atau *Vanilla JS*, jangan menambahkan *library* berat yang memerlukan proses *build* rumit. Namun, jika pengguna meminta migrasi ke **React / Next.js / Vue**, pecah komponen secara modular (`SummaryCards`, `FilterBar`, `ProjectCard`, `TimelineView`, `DetailModal`) sambil mempertahankan 100% logika di `normalizeRepositoryRoadmap()`.

---

## 6. Prompt Kickoff Siap Pakai (Copy-Paste ke Agent Baru)

> **Salin teks di bawah ini saat memulai sesi di harness/agent baru Anda:**
>
> "Saya melampirkan dua file: `HANDOVER.md` dan `index.html`. Tolong baca keduanya secara menyeluruh. `index.html` adalah aplikasi **GitHub Multi-Project Roadmap Monitor** berbasis GitHub GraphQL API v4 dengan sistem *3-Tier Fallback* (`MILESTONE` -> `ROADMAP.MD` -> `ISSUES`) yang sudah berjalan. Tugas pertama Anda adalah memahami arsitektur yang ada di `HANDOVER.md`, memastikan tidak ada fitur di `index.html` yang rusak, lalu bantu saya mengerjakan **[Sebutkan target Anda, misal: Prioritas 1 - Membuat Backend Proxy & Caching / Prioritas 2 - Menambahkan Timeline & Kanban View]**."