# Free Cloud Gallery

Architecture documentation, technical specifications, and operational guide for a serverless private media gallery running 100% on Cloudflare Free Tier ($0/month operating cost).

> **Looking to deploy your own gallery from scratch?**  
> Read the complete zero-to-production tutorial: **[Step-by-Step Deployment Guide (DEPLOYMENT.md)](DEPLOYMENT.md)**.

---

## 1. Project Overview

Free Cloud Gallery is a private photo and video gallery platform engineered for bit-for-bit raw media fidelity, fast mobile-first ergonomics, and optimal resource utilization within Cloudflare Free Tier quotas.

### Key Highlights:
- **Raw Media Fidelity:** 100% bit-for-bit identical storage without lossy re-encoding or client-side downscaling.
- **Full Metadata Preservation:** Preserves all EXIF tags (camera, lens, ISO, orientation, capture date) and MP4/MOV `mvhd` binary atoms.
- **Client-Side WebP Thumbnails:** Fast grid rendering with zero server compute overhead.
- **HTML5 Video Streaming:** Seamless playback for MP4, MOV, WebM, and M4V files.
- **Two-Level Security (`X-API-KEY`):** Admin vs Guest mode with zero reliance on OAuth or Cloudflare Access redirects, making it CLI and AI agent friendly.
- **Zero-Worker Media Serving:** Media is served directly from an R2 Custom Domain, preserving Worker invocation quotas for API requests only.
- **Direct-to-R2 Uploads via SigV4 Presigned URLs:** Eliminates Worker 10ms CPU limits and memory buffer limits by streaming directly from client browser to R2.
- **Direct-to-Disk Downloads:** Presigned GET URLs with `response-content-disposition=attachment` prevent browser RAM exhaustion and bypass WAF referer checks.

---

## 2. System Architecture

```
[ Client Browser ]
   |
   +---> [ Cloudflare Pages ] : gallery.yourdomain.com (Frontend Web UI)
   |
   +---> [ Cloudflare Worker ] : api-gallery.yourdomain.com (API Routing, Auth, Metadata)
   |        |
   |        +---> [ Cloudflare D1 ] : gallery-db (SQLite Metadata Store)
   |        +---> [ R2 SigV4 Signer ] : Presigned URL Generator
   |
   +===> [ Cloudflare R2 ] : gallery-photos (Direct PUT Uploads via Presigned URL)
   |
   +<--- [ R2 Custom Domain ] : gallery-media.yourdomain.com (Zero-Worker Media Delivery)
```

### Domains & Service Mapping:
1. **Frontend UI (Cloudflare Pages):** `https://gallery.yourdomain.com` (or `https://<project>.pages.dev`)
   - Static asset hosting (`index.html`, `styles.css`, `app.js`).
2. **Backend API (Cloudflare Worker):** `https://api-gallery.yourdomain.com` (or `https://<worker>.<subdomain>.workers.dev`)
   - Worker named `gallery-api` handling auth verification, D1 metadata, SigV4 URL generation, and storage metrics.
3. **Relational Database (Cloudflare D1):** `gallery-db`
   - SQLite tables: `photos` and `albums`.
4. **Media Storage (Cloudflare R2):** `gallery-photos`
   - High-durability object storage for raw media (`photos/`, `videos/`) and thumbnails (`thumbs/`).
5. **Media Delivery CDN (R2 Custom Domain):** `https://gallery-media.yourdomain.com`
   - Direct R2 edge delivery without Worker execution costs.

---

## 3. Cloudflare Free Tier Optimization Strategy

| Free Tier Metric | Free Limit | Architectural Implementation | Efficiency Impact |
| :--- | :--- | :--- | :--- |
| **Worker Invocations** | 100,000 req / day | Media served directly via R2 Custom Domain. | Saves thousands of invocations per session; Workers only handle lightweight JSON. |
| **Worker CPU Time** | 10 ms / req | Direct-to-R2 upload via SigV4 presigned PUT URLs. | Worker CPU usage drops to ~0.2 ms per upload (only signs URL). |
| **Worker Memory** | 128 MB RAM | Payloads bypass Worker memory buffer completely. | Completely prevents Out-of-Memory (Error 1101) and CPU timeouts (Error 1102). |
| **R2 Egress (Bandwidth)** | 100% Free ($0) | Streaming and downloads served directly from R2 edge. | Zero egress fees forever. |
| **R2 Storage** | 10 GB free | Inline realtime storage tracking via `GET /api/storage`. | Complete quota transparency. |
| **D1 Database Reads** | 5,000,000 rows / day | Indexed pagination on `created_at` and `id`. | Minimal read consumption (< 0.1% daily quota). |

---

## 4. Security & Authentication

### 4.1. Two-Level Passcode Gate (`X-API-KEY`)
- **Admin Role:** Configured via Worker secret `UPLOAD_SECRET`. Has full permissions: upload, create/rename/delete albums, edit media details, and delete media.
- **Guest Role:** Configured via `VIEW_SECRET` in `wrangler.toml` (default fallback). Has read-only permissions: view gallery, stream video, filter/sort, and download original files.

### 4.2. R2 Custom Domain Security
- The public custom domain only permits read operations (`GET` and `HEAD`).
- Direct `PUT`, `POST`, or `DELETE` requests from the web without a valid S3 signature are rejected at Cloudflare Edge with HTTP 401/405.

### 4.3. R2 CORS Policy (`cors.example.json`)
Allows browser-based direct PUT uploads to `gallery-photos`:
```json
{
  "rules": [
    {
      "allowed": {
        "origins": [
          "https://your-gallery.pages.dev",
          "https://gallery.yourdomain.com"
        ],
        "methods": [
          "GET",
          "PUT",
          "HEAD"
        ],
        "headers": [
          "*"
        ]
      },
      "exposeHeaders": [
        "ETag"
      ],
      "maxAgeSeconds": 3600
    }
  ]
}
```

---

## 5. Direct-to-R2 Upload Workflow

```
[ Client Browser ]                 [ Worker API ]                [ R2 Storage ]
       |                                 |                             |
       | 1. POST /api/upload/direct-url  |                             |
       |-------------------------------->|                             |
       |   (filename, size, type)        | (Verify admin &             |
       |                                 |  generate SigV4 URL)        |
       | 2. JSON: { upload_url, id }     |                             |
       |<--------------------------------|                             |
       |                                                               |
       | 3. PUT [upload_url] (Streaming binary via XMLHttpRequest)     |
       |-------------------------------------------------------------->|
       |    [Progress bar: 0% -> 100%]                                 |
       | 4. HTTP 200 OK (Stored in R2 bucket)                          |
       |<--------------------------------------------------------------|
       |                                 |                             |
       | 5. POST /api/upload/complete    |                             |
       |-------------------------------->|                             |
       |   (id, metadata, date, album)   | (Insert record into D1)     |
       | 6. HTTP 200 { success: true }   |                             |
       |<--------------------------------|                             |
```

---

## 6. Database Schema (`schema.sql`)

```sql
CREATE TABLE IF NOT EXISTS albums (
  name TEXT PRIMARY KEY,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO albums (name) VALUES ('General');

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  original_url TEXT NOT NULL,
  thumb_url TEXT NOT NULL,
  title TEXT,
  album TEXT DEFAULT 'General',
  size_bytes INTEGER DEFAULT 0,
  media_type TEXT DEFAULT 'image',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_photos_created_at ON photos(created_at);
CREATE INDEX IF NOT EXISTS idx_photos_album ON photos(album);
```

---

## 7. API Reference

All endpoints require header `X-API-KEY`.

### 1. Verify Access Key
- **Method:** `POST /api/verify`
- **Response:** `{ "valid": true, "role": "admin" }`

### 2. Fetch Media List
- **Method:** `GET /api/photos`
- **Query Params:** `limit`, `offset`, `album`, `sort` (`newest`, `oldest`, `title_asc`, `title_desc`, `size_desc`)

### 3. Fetch Album List
- **Method:** `GET /api/albums`
- **Response:** `["General", "Travel", "Family"]`

### 4. Create New Album (Admin Only)
- **Method:** `POST /api/albums`
- **Body:** `{ "name": "Travel" }`

### 5. Rename Album (Admin Only)
- **Method:** `PATCH /api/albums/:name`
- **Body:** `{ "new_name": "Summer 2026" }`
- Renames album and moves all associated photos atomically.

### 6. Delete Album (Admin Only)
- **Method:** `DELETE /api/albums/:name`
- Deletes album and all associated media from R2 and D1.

### 7. Storage Status
- **Method:** `GET /api/storage`

### 8. Direct Upload Presigned URL (Admin Only)
- **Method:** `POST /api/upload/direct-url`
- **Body:** `{ "filename": "video.mp4", "type": "video/mp4", "size": 25000000 }`

### 9. Complete Upload (Admin Only)
- **Method:** `POST /api/upload/complete`

### 10. Presigned Download URL (Direct-to-Disk)
- **Method:** `GET /api/photos/:id/download-url`

### 11. Edit Media Details (Admin Only)
- **Method:** `PATCH /api/photos/:id`
- **Body:** `{ "title": "New Title", "album": "Travel", "created_at": "2026-10-30 22:25:49" }`

### 12. Batch Delete Media (Admin Only)
- **Method:** `POST /api/photos/batch-delete`
- **Body:** `{ "ids": ["id-1", "id-2"] }`

### 13. Single Delete Media (Admin Only)
- **Method:** `DELETE /api/photos/:id`

---

## 8. User Interface & Design System

The interface is built with a minimalist, clean, and content-first philosophy.

### 8.1. Design Principles
- **No Emojis:** Professional descriptive text only ("Admin", "Guest Mode", "Show", "Lock", "Edit", "Upload").
- **Content-First Grid:** Edge-to-edge media thumbnails without distracting overlays.
- **System Typography:** High-performance native font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto`) with zero Google Fonts network requests.

### 8.2. Color Tokens & Themes (Dark / Light Mode)

| CSS Token | Light Mode | Dark Mode | Role |
| :--- | :--- | :--- | :--- |
| `--bg-color` | `#f8fafc` | `#0b0f19` | Page background |
| `--card-bg` | `#ffffff` | `#1e293b` | Cards and modals |
| `--text-main` | `#0f172a` | `#f8fafc` | Primary text |
| `--text-muted` | `#64748b` | `#94a3b8` | Secondary labels |
| `--primary` | `#0051c3` | `#38bdf8` | Primary accent |
| `--primary-hover`| `#003a8c` | `#0284c7` | Accent hover |
| `--border-color`| `#e2e8f0` | `#334155` | Borders and dividers |
| `--input-bg` | `#ffffff` | `#0f172a` | Form inputs |
| `--badge-bg` | `#e2e8f0` | `#334155` | Badges |
| `--danger` | `#dc2626` | `#ef4444` | Delete and error states |

### 8.3. UI Component Anatomy
1. **Lock Screen:**
   - Centered access card with show/hide password toggle.
2. **Header Bar & Inline Storage Status:**
   - Application title "Free Cloud Gallery".
   - Inline R2 capacity metric (e.g., `1.17% Used (120.1 MB of 10 GB)`) with zero cluttered charts.
   - User role badge ("Admin" / "Guest Mode").
   - Theme toggle ("Dark Mode" / "Light Mode") and Lock button.
3. **Navigation, Album Filters & Sorting:**
   - **Inline Filter & Sort Bar:** Category album tabs are placed on the left (horizontally scrollable), aligned with the sorting dropdown on the right.
   - **Minimalist & Content-First:** No redundant search boxes or refresh buttons, keeping the visual layout clean and focused on media.
4. **Media Collection Grid & Infinite Scroll:**
   - Responsive CSS Grid with adaptive columns: `repeat(auto-fill, minmax(220px, 1fr))`.
   - Square tiles (1:1 aspect ratio) with `object-fit: cover`.
   - Minimalist "Video" badge on the top right for video clips.
   - **Modern Infinite Scroll:** Uses browser-native `IntersectionObserver` with a 350px sentinel margin. Photos are fetched in 24-item batches automatically as the user scrolls.
5. **Timeline Headers:**
   - Date headers automatically group media by Month and Year (e.g., "October 2026", "September 2021") like modern mobile gallery apps.
6. **Fullscreen Lightbox:**
   - Dark transparent backdrop (`rgba(0, 0, 0, 0.92)`).
   - **True Fullscreen Mode:** Fullscreen button (or `F` keyboard key) expands media into borderless fullscreen.
   - **Photo Zoom & Pan:** Serverless zoom engine (Double-click/double-tap for 2.2x zoom, mouse wheel for 1x-4x, and drag/pan when zoomed). Resets automatically on navigation.
   - Native HTML5 video player and high-res image viewer.
   - Unified actions bar: "Fullscreen", "Edit" metadata, "Download" presigned direct-to-disk, and "Delete".
7. **Metadata Editor Modal:**
   - Compact modal to edit Title, change Album, and adjust Capture Date using a native `datetime-local` picker.
8. **Floating Action Button (FAB) & Mobile Bottom Sheet:**
   - **Bottom-Right FAB:** Floating `+ Upload` button for Admin users, designed for one-handed thumb navigation on mobile.
   - **Morphing Bottom Sheet (Mobile):** On mobile screens (`<= 768px`), upload form slides up as a bottom sheet.
   - **Center Modal (Desktop):** On screens (`> 768px`), automatically renders as a center modal with full drag-and-drop.
9. **Multi-Select & Floating Batch Action Bar:**
   - **Multi-Select Mode:** "Select" button in the gallery header enables batch selection.
   - **Batch Download:** Downloads selected media items sequentially direct-to-disk without browser RAM bloat.
   - **Batch Delete:** Admin only, deletes files from R2 and D1 records atomically in one request (`POST /api/photos/batch-delete`).
   - **Floating Action Bar:** Floats at the bottom showing selected item count, "Select All", "Download", and "Delete".

---

## 9. Deployment & Operations

For a complete step-by-step tutorial from account creation to production, read **[DEPLOYMENT.md](DEPLOYMENT.md)**.

### 9.1. Prerequisites
- Node.js version 18+.
- Cloudflare Wrangler CLI (`wrangler` v4.x).
- Authenticated Cloudflare CLI: `npx wrangler whoami`.

### 9.2. Project Structure
```
photo-gallery/
├── cors.json          # CORS rules for R2 bucket
├── schema.sql         # Cloudflare D1 database table schema
├── wrangler.toml      # Worker configuration, routing, and D1/R2 bindings
├── src/
│   └── index.js       # Worker API source code (router, SigV4 signer, D1 CRUD)
├── public/
│   ├── index.html     # Gallery frontend (lock screen, upload modal, grid, lightbox)
│   ├── styles.css     # Responsive styles, dark/light themes, modal UI
│   └── app.js         # Client JavaScript (auth, direct uploads, EXIF reader, filter)
└── README.md          # Technical documentation
```

### 9.3. Deployment Commands

#### 1. Deploy Backend Worker:
```bash
npx wrangler deploy
```

#### 2. Deploy Frontend Pages:
```bash
npx wrangler pages deploy public --project-name gallery-frontend
```

#### 3. Access Key Rotation:
- **Change Admin Key (`UPLOAD_SECRET`):**
  ```bash
  npx wrangler secret put UPLOAD_SECRET
  ```
- **Change Guest Key (`VIEW_SECRET`):**
  Edit `VIEW_SECRET` in `wrangler.toml`, then deploy:
  ```bash
  npx wrangler deploy
  ```

#### 4. Update R2 CORS Rules:
```bash
npx wrangler r2 bucket cors set gallery-photos --file cors.json -y
```

#### 5. Execute D1 Queries:
```bash
npx wrangler d1 execute gallery-db --remote --command "SELECT count(*), sum(size_bytes) FROM photos;"
```

---

## 10. Troubleshooting

1. **Video Upload Fails / Times Out:**
   - Ensure R2 API Token has *Object Read & Write* permissions.
   - Check bucket CORS status via `npx wrangler r2 bucket cors list gallery-photos`.
2. **Photo Date Timezone Offset:**
   - Frontend parses dates strictly as literal `YYYY-MM-DD` without appending `Z` to prevent unintended timezone shifts.
3. **Web Blocked / Temporarily Unreachable:**
   - Check Cloudflare WAF Rate Limiting rules on the zone.
   - Avoid rapid page reloads during active large file transfers.
4. **Downloaded Files Show Today's Date in Explorer:**
   - Browser file downloads set the local filesystem file creation date to the moment of download, but the embedded EXIF metadata and MP4 `mvhd` atom remains 100% intact. Inspect *Properties* &rarr; *Details* &rarr; *Date Taken*.
5. **Download Original Triggers Broken Player:**
   - Cross-origin `<a download>` links trigger direct navigation which strips the `Referer` header and encounters WAF blocks.
   - Solution: Handled by generating presigned GET URLs with `response-content-disposition=attachment`, forcing direct-to-disk native downloads.
