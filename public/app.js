// Backend Worker API URL (configured via config.js or fallback)
const API_URL = (window.GALLERY_CONFIG && window.GALLERY_CONFIG.API_URL) 
  ? window.GALLERY_CONFIG.API_URL 
  : "https://api-gallery.yourdomain.com";

// State
let allPhotos = [];
let currentPhotoIndex = -1;
let currentOffset = 0;
const PAGE_LIMIT = 24;
let hasMorePhotos = true;
let currentAlbum = "all";
let currentSort = "newest";
let fileQueue = []; // Multi-file upload queue
let currentAuthKey = localStorage.getItem("gallery_auth_key") || "";
let currentUserRole = null; // "admin" or "viewer"

// DOM Elements
const lockScreen = document.getElementById("lockScreen");
const lockForm = document.getElementById("lockForm");
const lockKeyInput = document.getElementById("lockKeyInput");
const toggleLockKeyBtn = document.getElementById("toggleLockKeyVisibility");
const lockErrorMsg = document.getElementById("lockErrorMsg");
const lockSubmitBtn = document.getElementById("lockSubmitBtn");
const lockSubmitText = document.getElementById("lockSubmitText");
const mainApp = document.getElementById("mainApp");
const userRoleBadge = document.getElementById("userRoleBadge");
const logoutBtn = document.getElementById("logoutBtn");
const uploadFabBtn = document.getElementById("uploadFabBtn");
const uploadModal = document.getElementById("uploadModal");
const uploadModalOverlay = document.getElementById("uploadModalOverlay");
const closeUploadModalBtn = document.getElementById("closeUploadModalBtn");
const cancelUploadModalBtn = document.getElementById("cancelUploadModalBtn");

const grid = document.getElementById("galleryGrid");
const uploadForm = document.getElementById("uploadForm");
const fileInput = document.getElementById("photoFile");
const titleInput = document.getElementById("photoTitle");
const albumSelect = document.getElementById("albumSelect");
const newAlbumInput = document.getElementById("newAlbumInput");
const albumTabs = document.getElementById("albumTabs");
const sortSelect = document.getElementById("sortSelect");
const statusMsg = document.getElementById("statusMessage");
const uploadBtn = document.getElementById("uploadBtn");
const uploadBtnText = document.getElementById("uploadBtnText");
const dropZone = document.getElementById("dropZone");
const queueContainer = document.getElementById("fileQueueContainer");
const queueList = document.getElementById("queueList");
const queueSummary = document.getElementById("queueSummary");
const clearQueueBtn = document.getElementById("clearQueueBtn");
const progressWrapper = document.getElementById("uploadProgressWrapper");
const progressFill = document.getElementById("uploadProgressFill");
const progressText = document.getElementById("progressText");
const themeToggleBtn = document.getElementById("themeToggleBtn");
const themeIcon = document.getElementById("themeIcon");
const photoCountBadge = document.getElementById("photoCountBadge");
const selectModeBtn = document.getElementById("selectModeBtn");
const batchActionBar = document.getElementById("batchActionBar");
const batchCountText = document.getElementById("batchCountText");
const batchSelectAllBtn = document.getElementById("batchSelectAllBtn");
const batchDownloadBtn = document.getElementById("batchDownloadBtn");
const batchDeleteBtn = document.getElementById("batchDeleteBtn");
const batchCancelBtn = document.getElementById("batchCancelBtn");
const loadMoreBtn = document.getElementById("loadMoreBtn");
const infiniteScrollSentinel = document.getElementById("infiniteScrollSentinel");
const infiniteScrollLoader = document.getElementById("infiniteScrollLoader");

let isFetchingPhotos = false;
let infiniteObserver = null;
let isSelectMode = false;
const selectedPhotoIds = new Set();

// Lightbox Elements
const lightboxModal = document.getElementById("lightboxModal");
const lightboxImg = document.getElementById("lightboxImg");
const lightboxVideo = document.getElementById("lightboxVideo");
const lightboxTitle = document.getElementById("lightboxTitle");
const lightboxAlbum = document.getElementById("lightboxAlbum");
const lightboxDetails = document.getElementById("lightboxDetails");
const lightboxClose = document.getElementById("lightboxClose");
const lightboxPrev = document.getElementById("lightboxPrev");
const lightboxNext = document.getElementById("lightboxNext");
const lightboxFullscreenBtn = document.getElementById("lightboxFullscreenBtn");
const lightboxEditBtn = document.getElementById("lightboxEditBtn");
const lightboxDownload = document.getElementById("lightboxDownload");
const lightboxDelete = document.getElementById("lightboxDelete");

// Edit Modal Elements
const editModal = document.getElementById("editModal");
const editPhotoForm = document.getElementById("editPhotoForm");
const editPhotoTitle = document.getElementById("editPhotoTitle");
const editPhotoAlbum = document.getElementById("editPhotoAlbum");
const editAlbumDatalist = document.getElementById("editAlbumDatalist");
const editPhotoDate = document.getElementById("editPhotoDate");
const editModalClose = document.getElementById("editModalClose");
const editModalCancelBtn = document.getElementById("editModalCancelBtn");
const editModalSaveBtn = document.getElementById("editModalSaveBtn");
const editModalSaveText = document.getElementById("editModalSaveText");

// Inisialisasi saat halaman dimuat
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initEventListeners();
  initAuth();
});

// 1. Theme Management (Dark Mode)
function initTheme() {
  const savedTheme = localStorage.getItem("gallery_theme");
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const initialTheme = savedTheme || (prefersDark ? "dark" : "light");

  applyTheme(initialTheme);

  themeToggleBtn.addEventListener("click", () => {
    const currentTheme = document.documentElement.getAttribute("data-theme") || "light";
    const newTheme = currentTheme === "dark" ? "light" : "dark";
    applyTheme(newTheme);
  });
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("gallery_theme", theme);
  themeIcon.textContent = theme === "dark" ? "Light Mode" : "Dark Mode";
}

// 2. Authentication Management
async function initAuth() {
  if (currentAuthKey) {
    showMainApp();
    const ok = await verifyAndApplyAuth(currentAuthKey, false);
    if (ok) return;
  }
  showLockScreen();
}

async function verifyAndApplyAuth(key, isManualSubmit = false) {
  if (!key) {
    showLockScreen();
    return false;
  }

  if (isManualSubmit) {
    lockSubmitBtn.disabled = true;
    lockSubmitText.textContent = "Verifying...";
    lockErrorMsg.style.display = "none";
  }

  try {
    const res = await fetch(`${API_URL}/api/verify`, {
      method: "POST",
      headers: { "X-API-KEY": key }
    });
    const data = await res.json();

    if (res.ok && data.valid) {
      currentAuthKey = key;
      currentUserRole = data.role;
      localStorage.setItem("gallery_auth_key", key);
      localStorage.setItem("gallery_auth_role", data.role);

      applyRoleUI(data.role);
      showMainApp();

      fetchAlbums();
      fetchStorageStats();
      fetchPhotos(true);
      return true;
    } else {
      if (isManualSubmit) {
        lockErrorMsg.textContent = data.error || "Invalid access key!";
        lockErrorMsg.style.display = "block";
      } else {
        showLockScreen();
      }
      return false;
    }
  } catch (err) {
    console.error(err);
    if (isManualSubmit) {
      lockErrorMsg.textContent = "Failed to connect to server.";
      lockErrorMsg.style.display = "block";
    } else {
      showLockScreen();
    }
    return false;
  } finally {
    if (isManualSubmit) {
      lockSubmitBtn.disabled = false;
      lockSubmitText.textContent = "Unlock";
    }
  }
}

function showLockScreen() {
  mainApp.classList.add("hidden");
  lockScreen.classList.remove("hidden");
  lockKeyInput.value = "";
  lockKeyInput.focus();
}

function showMainApp() {
  lockScreen.classList.add("hidden");
  mainApp.classList.remove("hidden");
}

function applyRoleUI(role) {
  if (selectModeBtn) selectModeBtn.classList.remove("hidden");
  if (role === "admin") {
    userRoleBadge.textContent = "Admin";
    userRoleBadge.className = "badge badge-role admin";
    if (uploadFabBtn) uploadFabBtn.classList.remove("hidden");
    lightboxDelete.classList.remove("hidden");
    lightboxEditBtn.classList.remove("hidden");
  } else {
    userRoleBadge.textContent = "Guest Mode";
    userRoleBadge.className = "badge badge-role viewer";
    if (uploadFabBtn) uploadFabBtn.classList.add("hidden");
    closeUploadModal();
    lightboxDelete.classList.add("hidden");
    lightboxEditBtn.classList.add("hidden");
  }
}

function openUploadModal() {
  if (currentUserRole !== "admin") return;
  if (uploadModal) uploadModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  if (currentAlbum && currentAlbum !== "all") {
    if (albumSelect.querySelector(`option[value="${currentAlbum}"]`)) {
      albumSelect.value = currentAlbum;
      newAlbumInput.classList.add("hidden");
    }
  }
}

function closeUploadModal() {
  if (uploadModal) uploadModal.classList.add("hidden");
  document.body.style.overflow = "";
}

function handleLogout() {
  currentAuthKey = "";
  currentUserRole = null;
  localStorage.removeItem("gallery_auth_key");
  localStorage.removeItem("gallery_auth_role");
  showLockScreen();
}

// 3. Event Listeners
function initEventListeners() {
  // Lock form submission
  lockForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const key = lockKeyInput.value.trim();
    if (key) {
      verifyAndApplyAuth(key, true);
    }
  });

  // Toggle lock key visibility
  toggleLockKeyBtn.addEventListener("click", () => {
    const isPassword = lockKeyInput.type === "password";
    lockKeyInput.type = isPassword ? "text" : "password";
    toggleLockKeyBtn.textContent = isPassword ? "Hide" : "Show";
  });

  // Logout button
  logoutBtn.addEventListener("click", handleLogout);

  // Upload modal & FAB controls
  if (uploadFabBtn) uploadFabBtn.addEventListener("click", openUploadModal);
  if (closeUploadModalBtn) closeUploadModalBtn.addEventListener("click", closeUploadModal);
  if (cancelUploadModalBtn) cancelUploadModalBtn.addEventListener("click", closeUploadModal);
  if (uploadModalOverlay) uploadModalOverlay.addEventListener("click", closeUploadModal);

  // Drag & drop file handlers
  ["dragenter", "dragover"].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove("dragover");
    });
  });

  dropZone.addEventListener("drop", (e) => {
    const dt = e.dataTransfer;
    if (dt.files && dt.files.length > 0) {
      addFilesToQueue(Array.from(dt.files));
    }
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files && fileInput.files.length > 0) {
      addFilesToQueue(Array.from(fileInput.files));
    }
  });

  clearQueueBtn.addEventListener("click", () => {
    fileQueue = [];
    fileInput.value = "";
    renderQueue();
  });

  // Album selection change handler
  albumSelect.addEventListener("change", (e) => {
    if (e.target.value === "__new__") {
      newAlbumInput.classList.remove("hidden");
      newAlbumInput.focus();
    } else {
      newAlbumInput.classList.add("hidden");
    }
  });

  // Sort change handler
  sortSelect.addEventListener("change", (e) => {
    currentSort = e.target.value;
    fetchPhotos(true);
  });

  // Batch selection handlers
  if (selectModeBtn) selectModeBtn.addEventListener("click", toggleSelectMode);
  if (batchSelectAllBtn) batchSelectAllBtn.addEventListener("click", handleSelectAllToggle);
  if (batchDownloadBtn) batchDownloadBtn.addEventListener("click", handleBatchDownload);
  if (batchDeleteBtn) batchDeleteBtn.addEventListener("click", handleBatchDelete);
  if (batchCancelBtn) batchCancelBtn.addEventListener("click", exitSelectMode);

  // Load More button (fallback)
  loadMoreBtn.addEventListener("click", () => {
    fetchPhotos(false);
  });

  // Upload handler
  uploadForm.addEventListener("submit", handleBatchUpload);

  // Lightbox navigation
  lightboxClose.addEventListener("click", closeLightbox);
  lightboxModal.querySelector(".lightbox-overlay").addEventListener("click", closeLightbox);
  lightboxPrev.addEventListener("click", showPrevPhoto);
  lightboxNext.addEventListener("click", showNextPhoto);
  lightboxFullscreenBtn.addEventListener("click", toggleLightboxFullscreen);
  lightboxEditBtn.addEventListener("click", openEditModal);
  lightboxDownload.addEventListener("click", handleDownloadCurrentPhoto);
  lightboxDelete.addEventListener("click", handleDeleteCurrentPhoto);
  initLightboxZoomEvents();
  initLightboxSwipeEvents();
  initInfiniteScroll();

  // Edit modal navigation
  editModalClose.addEventListener("click", closeEditModal);
  editModalCancelBtn.addEventListener("click", closeEditModal);
  editModal.querySelector(".lightbox-overlay").addEventListener("click", closeEditModal);
  editPhotoForm.addEventListener("submit", handleSavePhotoEdit);

  // Keyboard navigation
  document.addEventListener("keydown", (e) => {
    if (uploadModal && !uploadModal.classList.contains("hidden")) {
      if (e.key === "Escape") closeUploadModal();
      return;
    }
    if (!editModal.classList.contains("hidden")) {
      if (e.key === "Escape") closeEditModal();
      return;
    }
    if (lightboxModal.classList.contains("hidden")) return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft") showPrevPhoto();
    if (e.key === "ArrowRight") showNextPhoto();
    if (e.key === "f" || e.key === "F") toggleLightboxFullscreen();
  });
}

// Helper untuk mengenali apakah file/item merupakan video
function isVideoFile(item) {
  if (!item) return false;
  if (item.media_type === "video" || item.isVideo) return true;
  const type = item.type || "";
  const name = item.name || item.filename || "";
  return type.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(name);
}

// 3. Multi-file Queue Management (Foto & Video)
function addFilesToQueue(files) {
  const validFiles = files.filter(f => {
    const isImg = f.type.startsWith("image/") || /\.(jpg|jpeg|png|webp|heic|avif)$/i.test(f.name);
    const isVid = isVideoFile(f);
    return isImg || isVid;
  });

  if (validFiles.length === 0) {
    showStatus("Please select supported photo or video files (JPG, PNG, WebP, MP4, MOV).", "error");
    return;
  }

  validFiles.forEach(async (file) => {
    const isVid = isVideoFile(file);

    // Free Tier limits: Photo max 15MB, Video max 85MB
    const maxBytes = isVid ? 85 * 1024 * 1024 : 15 * 1024 * 1024;
    if (file.size > maxBytes) {
      showStatus(`${file.name} exceeds ${isVid ? "85MB (Video)" : "15MB (Photo)"} limit for Free Tier.`, "error");
      return;
    }

    const defaultTitle = file.name.substring(0, file.name.lastIndexOf(".")) || file.name;
    const item = {
      id: crypto.randomUUID(),
      file,
      name: file.name,
      size: file.size,
      isVideo: isVid,
      title: defaultTitle.replace(/[-_]/g, " "),
      detectedDate: null,
      status: "pending",
      error: null,
      previewUrl: null
    };
    fileQueue.push(item);
    renderQueue();

    // Create preview thumbnail
    if (isVid) {
      const thumbFile = await createVideoThumbnail(file, 480);
      if (thumbFile) {
        item._cachedThumb = thumbFile;
        item.previewUrl = URL.createObjectURL(thumbFile);
      }
    } else {
      item.previewUrl = URL.createObjectURL(file);
    }

    // Detect capture date (EXIF / filename / lastModified)
    const captureDate = await getPhotoCaptureDate(file);
    item.detectedDate = captureDate;
    if (captureDate && (/^\d{3,8}$/.test(defaultTitle) || defaultTitle.length > 25 || defaultTitle.includes("all_"))) {
      const dtParts = captureDate.split(" ")[0];
      item.title = isVid ? `Video ${dtParts}` : `Photo ${dtParts}`;
    }
    renderQueue();
  });
}

function removeQueueItem(id) {
  const idx = fileQueue.findIndex(item => item.id === id);
  if (idx !== -1) {
    URL.revokeObjectURL(fileQueue[idx].previewUrl);
    fileQueue.splice(idx, 1);
    renderQueue();
  }
}

function renderQueue() {
  if (fileQueue.length === 0) {
    queueContainer.classList.add("hidden");
    return;
  }

  queueContainer.classList.remove("hidden");
  const totalBytes = fileQueue.reduce((acc, f) => acc + f.size, 0);
  const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
  queueSummary.textContent = `${fileQueue.length} files selected (${totalMB} MB)`;

  queueList.innerHTML = fileQueue.map(item => {
    const sizeKB = (item.size / 1024).toFixed(0);
    const dateFormatted = item.detectedDate ? ` • Date: ${formatDate(item.detectedDate)}` : "";
    const statusLabel = {
      pending: "Pending",
      processing: "Uploading...",
      success: "Completed",
      error: "Failed"
    }[item.status] || item.status;

    return `
      <div class="queue-item" data-id="${item.id}">
        ${item.previewUrl ? `<img src="${item.previewUrl}" class="queue-thumb" alt="Preview" />` : `<div class="queue-thumb queue-thumb-placeholder">${item.isVideo ? "Video" : "Photo"}</div>`}
        <div class="queue-item-info">
          <div class="queue-item-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
          <div class="queue-item-size">${sizeKB} KB${dateFormatted}${item.error ? ` • ${escapeHtml(item.error)}` : ""}</div>
        </div>
        <span class="queue-item-status ${item.status}">${statusLabel}</span>
        ${item.status === "pending" ? `<button type="button" class="btn-text-danger" onclick="removeQueueItem('${item.id}')" title="Remove">Remove</button>` : ""}
      </div>
    `;
  }).join("");
}

// Membuat thumbnail WebP dari frame video (detik ke-0.5 / tengah video) dengan batas waktu pengaman
function createVideoThumbnail(file, maxWidth = 480) {
  return new Promise((resolve) => {
    // Optimasi: Lewati ekstraksi frame Canvas jika video > 35 MB demi menghemat memori & performa ponsel
    if (file && file.size > 35 * 1024 * 1024) {
      resolve(null);
      return;
    }

    let settled = false;
    let objectUrl = "";

    const finish = (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (objectUrl) {
        try { URL.revokeObjectURL(objectUrl); } catch (_) {}
      }
      resolve(res);
    };

    // Safety timeout 3 detik agar browser TIDAK PERNAH HANG
    const timer = setTimeout(() => {
      finish(null);
    }, 3000);

    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;

    try {
      objectUrl = URL.createObjectURL(file);
      video.src = objectUrl;
    } catch (e) {
      finish(null);
      return;
    }

    video.onloadeddata = () => {
      try {
        video.currentTime = Math.min(1, (video.duration || 1) / 2);
      } catch (e) {
        finish(null);
      }
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        const vw = video.videoWidth || 480;
        const vh = video.videoHeight || 360;
        const scale = Math.min(1, maxWidth / vw);
        canvas.width = Math.round(vw * scale) || 480;
        canvas.height = Math.round(vh * scale) || 360;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        canvas.toBlob((blob) => {
          if (!blob) {
            finish(null);
            return;
          }
          finish(new File([blob], `thumb_${file.name}.webp`, { type: "image/webp" }));
        }, "image/webp", 0.8);
      } catch (e) {
        finish(null);
      }
    };

    video.onerror = () => finish(null);
  });
}

// 4. Client-side Image/Video Optimization (WebP Thumbnail & Smart Resizing)
function createThumbnail(file, maxWidth = 480) {
  if (isVideoFile(file)) {
    return createVideoThumbnail(file, maxWidth);
  }

  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.src = objectUrl;

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, maxWidth / img.width);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);

      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      canvas.toBlob((blob) => {
        if (!blob) {
          canvas.toBlob((fallbackBlob) => {
            resolve(new File([fallbackBlob], `thumb_${file.name}.jpg`, { type: "image/jpeg" }));
          }, "image/jpeg", 0.75);
          return;
        }
        resolve(new File([blob], `thumb_${file.name}.webp`, { type: "image/webp" }));
      }, "image/webp", 0.8);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };
  });
}

// Membaca tanggal perekaman asli (Creation Time) dari atom biner MP4/MOV (mvhd)
async function getVideoCaptureDate(file) {
  if (!file || !file.slice) return null;

  async function searchMvhd(blobSlice) {
    const buffer = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsArrayBuffer(blobSlice);
    });
    if (!buffer) return null;

    const u8 = new Uint8Array(buffer);
    const view = new DataView(buffer);
    for (let i = 0; i <= u8.length - 16; i++) {
      // Cari sequence bytes 'm', 'v', 'h', 'd' (0x6d, 0x76, 0x68, 0x64)
      if (u8[i] === 0x6d && u8[i + 1] === 0x76 && u8[i + 2] === 0x68 && u8[i + 3] === 0x64) {
        const version = u8[i + 4];
        let creationSeconds = 0;
        if (version === 0) {
          creationSeconds = view.getUint32(i + 8, false);
        } else if (version === 1) {
          const high = view.getUint32(i + 8, false);
          const low = view.getUint32(i + 12, false);
          creationSeconds = high * 4294967296 + low;
        }

        if (creationSeconds > 0) {
          // Mac epoch (1904) ke Unix epoch (1970) selisih 2,082,844,800 detik
          const unixMs = (creationSeconds - 2082844800) * 1000;
          const d = new Date(unixMs);
          if (!isNaN(d.getTime()) && d.getFullYear() >= 1990 && d.getFullYear() <= 2050) {
            const pad = (n) => String(n).padStart(2, "0");
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
          }
        }
      }
    }
    return null;
  }

  // 1. Cek 256 KB pertama file
  const headSlice = file.slice(0, 262144);
  const headDate = await searchMvhd(headSlice);
  if (headDate) return headDate;

  // 2. Jika tidak ada di awal, cek 3 MB terakhir file (moov atom di ujung)
  if (file.size > 262144) {
    const tailSize = Math.min(file.size, 3145728);
    const tailSlice = file.slice(file.size - tailSize, file.size);
    const tailDate = await searchMvhd(tailSlice);
    if (tailDate) return tailDate;
  }

  return null;
}

// Membaca tanggal asli foto dari EXIF metadata (Date Taken), nama file, atau lastModified
async function getPhotoCaptureDate(file) {
  // 1. Jika video, baca atom biner MP4 mvhd (Creation Time asli)
  if (isVideoFile(file)) {
    try {
      const vidDate = await getVideoCaptureDate(file);
      if (vidDate) return vidDate;
    } catch (e) {
      console.warn("Gagal membaca video mvhd date:", e);
    }
  }

  // 2. Coba baca EXIF dari header biner file (128KB pertama)
  if (file && file.slice) {
    try {
      const exifDate = await new Promise((resolve) => {
        const reader = new FileReader();
        const slice = file.slice(0, 131072); // 128 KB
        reader.onload = (e) => {
          const buffer = e.target.result;
          const text = new TextDecoder("latin1").decode(buffer);
          // Pola tanggal EXIF standar: YYYY:MM:DD HH:MM:SS
          const match = text.match(/(20\d{2}|19\d{2}):(0[1-9]|1[0-2]):(0[1-9]|[12]\d|3[01]) (\d{2}):(\d{2}):(\d{2})/);
          if (match) {
            const [_, y, m, d, h, min, s] = match;
            resolve(`${y}-${m}-${d} ${h}:${min}:${s}`);
            return;
          }
          resolve(null);
        };
        reader.onerror = () => resolve(null);
        reader.readAsArrayBuffer(slice);
      });

      if (exifDate) return exifDate;
    } catch (e) {
      console.warn("Gagal mengekstrak EXIF date:", e);
    }
  }

  // 2. Coba ekstrak tanggal dari pola nama file (contoh: IMG_20230704_103711 atau Screenshot_2022-05-10)
  if (file.name) {
    const fnMatch = file.name.match(/(20\d{2})[-_]?(0[1-9]|1[0-2])[-_]?(0[1-9]|[12]\d|3[01])(?:[-_ ]?(\d{2})[-_]?(\d{2})[-_]?(\d{2}))?/);
    if (fnMatch) {
      const y = fnMatch[1];
      const m = fnMatch[2];
      const d = fnMatch[3];
      const h = fnMatch[4] || "12";
      const min = fnMatch[5] || "00";
      const s = fnMatch[6] || "00";
      return `${y}-${m}-${d} ${h}:${min}:${s}`;
    }
  }

  // 3. Fallback: file.lastModified dari filesystem pengguna
  if (file.lastModified) {
    const d = new Date(file.lastModified);
    if (!isNaN(d.getTime())) {
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
  }

  return null;
}

// 5. Batch Upload Handler
async function handleBatchUpload(e) {
  e.preventDefault();

  if (currentUserRole !== "admin") {
    showStatus("Access Denied: Admin role required to upload media.", "error");
    return;
  }

  if (fileQueue.length === 0) {
    showStatus("Please select at least one media file.", "error");
    return;
  }

  const globalTitle = titleInput.value.trim();
  let targetAlbum = "General";
  if (albumSelect.value === "__new__") {
    targetAlbum = newAlbumInput.value.trim() || "General";
  } else {
    targetAlbum = albumSelect.value || "General";
  }

  if (!currentAuthKey) {
    showStatus("Access key not verified. Please log in again.", "error");
    return;
  }

  uploadBtn.disabled = true;
  uploadBtnText.textContent = "Uploading queue...";
  progressWrapper.classList.remove("hidden");
  showStatus("Starting batch upload...", "info");

  let successCount = 0;
  let failCount = 0;
  const total = fileQueue.length;

  for (let i = 0; i < total; i++) {
    const item = fileQueue[i];
    if (item.status === "success") continue; // skip already completed

    item.status = "processing";
    renderQueue();

    const percent = Math.round(((i) / total) * 100);
    progressFill.style.width = `${percent}%`;
    progressText.textContent = `Uploading item ${i + 1} of ${total} (${item.name})...`;

    try {
      // 1. Create or retrieve thumbnail WebP
      const thumbFile = item._cachedThumb || (!item.isVideo ? await createThumbnail(item.file) : null);
      const captureDate = item.detectedDate || await getPhotoCaptureDate(item.file);

      // 2. Direct-to-R2 Upload
      let directSuccess = false;
      try {
        const dirReq = await fetch(`${API_URL}/api/upload/direct-url`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-KEY": currentAuthKey
          },
          body: JSON.stringify({
            filename: item.file.name,
            type: item.file.type,
            size: item.file.size
          })
        });

        if (dirReq.ok) {
          const directData = await dirReq.json();
          let hasThumb = false;

          // 2a. Upload thumbnail directly to R2 if available
          if (thumbFile && directData.thumb_upload_url) {
            try {
              const tRes = await fetch(directData.thumb_upload_url, {
                method: "PUT",
                body: thumbFile,
                headers: { "Content-Type": "image/webp" }
              });
              if (tRes.ok) hasThumb = true;
            } catch (tErr) {
              console.warn("Direct R2 thumbnail upload skipped:", tErr);
            }
          }

          // 2b. Upload original file directly to R2 via XMLHttpRequest with accurate progress
          await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("PUT", directData.upload_url);
            if (item.file.type) {
              xhr.setRequestHeader("Content-Type", item.file.type);
            }
            xhr.upload.onprogress = (evt) => {
              if (evt.lengthComputable) {
                const fPercent = Math.round((evt.loaded / evt.total) * 100);
                const currentFileProgress = evt.loaded / evt.total;
                const overall = Math.round(((i + currentFileProgress) / total) * 100);
                progressFill.style.width = `${overall}%`;
                progressText.textContent = `Uploading ${i + 1}/${total} (${item.name}): ${fPercent}% (${formatBytes(evt.loaded)} / ${formatBytes(evt.total)})`;
              }
            };
            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                resolve();
              } else {
                reject(new Error(`R2 upload failed: HTTP ${xhr.status}`));
              }
            };
            xhr.onerror = () => reject(new Error("R2 transfer connection failed"));
            xhr.send(item.file);
          });

          // 2c. Save metadata to D1
          const compRes = await fetch(`${API_URL}/api/upload/complete`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-KEY": currentAuthKey
            },
            body: JSON.stringify({
              id: directData.id,
              filename: item.file.name,
              photo_key: directData.photo_key,
              thumb_key: directData.thumb_key,
              title: globalTitle || item.title,
              album: targetAlbum,
              size_bytes: item.file.size,
              media_type: directData.is_video ? "video" : "image",
              date_modified: captureDate,
              has_thumb: hasThumb
            })
          });

          const compData = await compRes.json();
          if (compRes.ok && compData.success) {
            item.status = "success";
            successCount++;
            directSuccess = true;
          }
        }
      } catch (dirErr) {
        console.warn("Direct R2 upload failed, switching to fallback:", dirErr);
      }

      // Fallback multipart upload
      if (!directSuccess) {
        const formData = new FormData();
        formData.append("file", item.file);
        if (thumbFile) {
          formData.append("thumb", thumbFile);
        }
        formData.append("title", globalTitle || item.title);
        formData.append("album", targetAlbum);
        if (captureDate) {
          formData.append("date_modified", captureDate);
        }

        const res = await fetch(`${API_URL}/api/upload`, {
          method: "POST",
          headers: {
            "X-API-KEY": currentAuthKey
          },
          body: formData
        });

        const data = await res.json();

        if (res.ok && data.success) {
          item.status = "success";
          successCount++;
        } else {
          item.status = "error";
          item.error = data.error || "Upload failed";
          failCount++;
        }
      }
    } catch (err) {
      console.error(err);
      item.status = "error";
      item.error = "Connection error";
      failCount++;
    }

    renderQueue();
  }

  progressFill.style.width = "100%";
  progressText.textContent = `Done: ${successCount} uploaded, ${failCount} failed.`;

  if (failCount === 0) {
    showStatus(`All files (${successCount}) uploaded successfully!`, "success");
    fileQueue = [];
    fileInput.value = "";
    titleInput.value = "";
    renderQueue();
    setTimeout(() => {
      progressWrapper.classList.add("hidden");
      closeUploadModal();
    }, 1500);
  } else {
    showStatus(`${successCount} uploaded, ${failCount} failed. Check queue above.`, "error");
  }

  uploadBtn.disabled = false;
  uploadBtnText.textContent = "Start Upload";

  // Refresh albums, storage & gallery
  fetchAlbums();
  fetchStorageStats();
  fetchPhotos(true);
}

// 6. Storage Utilization Status
async function fetchStorageStats() {
  try {
    const res = await fetch(`${API_URL}/api/storage`, {
      headers: { "X-API-KEY": currentAuthKey }
    });
    const data = await res.json();
    if (!data) return;

    const percent = data.percentage || 0;
    const summaryElem = document.getElementById("storageSummaryText");
    if (summaryElem) {
      summaryElem.textContent = `${percent}% Used (${data.used_formatted} of ${data.limit_formatted})`;
    }
  } catch (err) {
    console.error("Failed to load storage status:", err);
  }
}

// 7. Albums Fetching & Tabs Rendering
async function fetchAlbums() {
  try {
    const res = await fetch(`${API_URL}/api/albums`, {
      headers: { "X-API-KEY": currentAuthKey }
    });
    const albums = await res.json();

    if (!Array.isArray(albums)) return;

    // Ensure "General" is always in the album list
    const uniqueAlbums = Array.from(new Set(["General", ...albums.filter(a => a !== "Umum")]));

    // Update Album dropdown in upload form
    const prevSelected = albumSelect.value;
    albumSelect.innerHTML = uniqueAlbums.map(a => 
      `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`
    ).join("") + `<option value="__new__">+ Create New Album...</option>`;

    if (prevSelected && prevSelected !== "__new__" && uniqueAlbums.includes(prevSelected)) {
      albumSelect.value = prevSelected;
    } else if (currentAlbum && currentAlbum !== "all" && uniqueAlbums.includes(currentAlbum)) {
      albumSelect.value = currentAlbum;
    }

    // Update Tabs in gallery section
    const allTabHtml = `<button type="button" class="album-tab ${currentAlbum === 'all' ? 'active' : ''}" data-album="all">All</button>`;
    const albumTabsHtml = uniqueAlbums.map(a => {
      const isProtected = a === "General" || a === "Umum";
      if (isProtected) {
        return `
          <button type="button" class="album-tab ${currentAlbum === a ? 'active' : ''}" data-album="${escapeHtml(a)}">
            ${escapeHtml(a)}
          </button>
        `;
      }

      const adminControlsHtml = (currentUserRole === "admin")
        ? `
          <button type="button" class="album-rename-btn" data-album="${escapeHtml(a)}" title="Rename album '${escapeHtml(a)}'">Rename</button>
          <button type="button" class="album-delete-btn" data-album="${escapeHtml(a)}" title="Delete album '${escapeHtml(a)}'">&times;</button>
        `
        : "";

      return `
        <div class="album-tab-pill ${currentAlbum === a ? 'active' : ''}">
          <button type="button" class="album-tab-label" data-album="${escapeHtml(a)}" title="Click to filter, double click to rename">
            ${escapeHtml(a)}
          </button>
          ${adminControlsHtml}
        </div>
      `;
    }).join("");

    // "+ New Album" button for admin in tab list
    const addAlbumTabHtml = currentUserRole === "admin" 
      ? `<button type="button" id="addNewAlbumBtn" class="album-tab album-tab-add" title="Create New Album">+ New Album</button>` 
      : "";

    albumTabs.innerHTML = allTabHtml + albumTabsHtml + addAlbumTabHtml;

    // Bind click event for album filter
    albumTabs.querySelectorAll(".album-tab, .album-tab-label").forEach(btn => {
      btn.addEventListener("click", () => {
        const targetAlbum = btn.getAttribute("data-album");
        if (!targetAlbum) return;
        currentAlbum = targetAlbum;
        albumTabs.querySelectorAll(".album-tab, .album-tab-pill").forEach(t => t.classList.remove("active"));
        const parentPill = btn.closest(".album-tab-pill");
        if (parentPill) {
          parentPill.classList.add("active");
        } else {
          btn.classList.add("active");
        }
        fetchPhotos(true);
      });
    });

    // Bind double click event for renaming album (Admin only)
    if (currentUserRole === "admin") {
      albumTabs.querySelectorAll(".album-tab-label").forEach(btn => {
        btn.addEventListener("dblclick", (e) => {
          e.preventDefault();
          const albumName = btn.getAttribute("data-album");
          window.handleRenameAlbum(albumName);
        });
      });
    }

    // Bind click event for renaming album
    albumTabs.querySelectorAll(".album-rename-btn").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const albumName = btn.getAttribute("data-album");
        await window.handleRenameAlbum(albumName);
      });
    });

    // Bind click event for deleting album
    albumTabs.querySelectorAll(".album-delete-btn").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const albumName = btn.getAttribute("data-album");
        await window.handleDeleteAlbum(albumName);
      });
    });

    // Bind event for "+ New Album" button
    const addBtn = document.getElementById("addNewAlbumBtn");
    if (addBtn) {
      addBtn.addEventListener("click", async () => {
        const newName = prompt("Enter new album name:");
        if (newName && newName.trim()) {
          const cleanName = newName.trim();
          try {
            const res = await fetch(`${API_URL}/api/albums`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-API-KEY": currentAuthKey
              },
              body: JSON.stringify({ name: cleanName })
            });
            const data = await res.json();
            if (res.ok && data.success) {
              showStatus(`Album "${cleanName}" created successfully.`, "success");
              currentAlbum = cleanName;
              await fetchAlbums();
              fetchPhotos(true);
            } else {
              alert(data.error || "Failed to create new album.");
            }
          } catch (e) {
            console.error("Failed to create album:", e);
            alert("Network error.");
          }
        }
      });
    }
  } catch (err) {
    console.error("Failed to load album list:", err);
  }
}

// Handler Rename Album (Admin only)
window.handleRenameAlbum = async function(oldName) {
  if (currentUserRole !== "admin") return;
  if (!oldName || oldName === "General" || oldName === "Umum" || oldName === "all") return;

  const newName = prompt(`Rename album "${oldName}" to:`, oldName);
  if (!newName || !newName.trim()) return;
  const cleanNewName = newName.trim();
  if (cleanNewName === oldName) return;

  try {
    const res = await fetch(`${API_URL}/api/albums/${encodeURIComponent(oldName)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": currentAuthKey
      },
      body: JSON.stringify({ new_name: cleanNewName })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showStatus(data.message || `Album successfully renamed to "${cleanNewName}".`, "success");
      if (currentAlbum === oldName) {
        currentAlbum = cleanNewName;
      }
      await fetchAlbums();
      fetchPhotos(true);
    } else {
      alert(data.error || "Failed to rename album.");
    }
  } catch (err) {
    console.error("Failed to rename album:", err);
    alert("Connection error while renaming album.");
  }
};

// Handler Delete Album (Admin only)
window.handleDeleteAlbum = async function(albumName) {
  if (currentUserRole !== "admin") return;
  if (!albumName || albumName === "General" || albumName === "Umum" || albumName === "all") return;

  const confirmed = confirm(
    `Are you sure you want to delete album "${albumName}"?\n\nWARNING: All photos and videos in this album (if any) will be permanently deleted from server and database.`
  );
  if (!confirmed) return;

  try {
    const res = await fetch(`${API_URL}/api/albums/${encodeURIComponent(albumName)}`, {
      method: "DELETE",
      headers: {
        "X-API-KEY": currentAuthKey
      }
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showStatus(data.message || `Album "${albumName}" deleted successfully.`, "success");
      if (currentAlbum === albumName) {
        currentAlbum = "all";
      }
      await fetchAlbums();
      fetchStorageStats();
      fetchPhotos(true);
    } else {
      alert(data.error || "Failed to delete album.");
    }
  } catch (err) {
    console.error("Failed to delete album:", err);
    alert("Connection error while deleting album.");
  }
};

// 8. Mengambil daftar foto dari D1 dengan Infinite Scroll
async function fetchPhotos(reset = false) {
  if (isFetchingPhotos) return;
  isFetchingPhotos = true;

  if (reset) {
    currentOffset = 0;
    allPhotos = [];
    grid.innerHTML = "<p class='loading-text'>Loading collection...</p>";
  } else {
    if (infiniteScrollLoader) infiniteScrollLoader.classList.remove("hidden");
  }

  try {
    let url = `${API_URL}/api/photos?limit=${PAGE_LIMIT}&offset=${currentOffset}&sort=${currentSort}`;
    if (currentAlbum && currentAlbum !== "all") {
      url += `&album=${encodeURIComponent(currentAlbum)}`;
    }

    const res = await fetch(url, {
      headers: { "X-API-KEY": currentAuthKey }
    });
    const photos = await res.json();

    if (!Array.isArray(photos)) {
      grid.innerHTML = "<p>Failed to load photos data format.</p>";
      return;
    }

    if (reset) {
      allPhotos = photos;
    } else {
      allPhotos = allPhotos.concat(photos);
    }

    currentOffset += photos.length;
    hasMorePhotos = photos.length === PAGE_LIMIT;

    photoCountBadge.textContent = `${allPhotos.length} Items`;

    if (allPhotos.length === 0) {
      grid.innerHTML = `<p class='empty-text'>No media in this album yet.</p>`;
      return;
    }

    renderGrid(allPhotos);
  } catch (err) {
    if (reset) {
      grid.innerHTML = "<p>Failed to load gallery. Check your network connection.</p>";
    } else {
      if (loadMoreBtn) loadMoreBtn.classList.remove("hidden");
    }
    console.error(err);
  } finally {
    isFetchingPhotos = false;
    if (infiniteScrollLoader) infiniteScrollLoader.classList.add("hidden");
    if (hasMorePhotos && loadMoreBtn) {
      loadMoreBtn.classList.add("hidden");
    }
  }
}

// Initialize IntersectionObserver for Infinite Scroll
function initInfiniteScroll() {
  const sentinel = document.getElementById("infiniteScrollSentinel");
  if (!sentinel) return;

  if (infiniteObserver) {
    infiniteObserver.disconnect();
  }

  infiniteObserver = new IntersectionObserver((entries) => {
    const entry = entries[0];
    if (entry.isIntersecting && hasMorePhotos && !isFetchingPhotos) {
      fetchPhotos(false);
    }
  }, {
    rootMargin: "350px"
  });

  infiniteObserver.observe(sentinel);
}

// Helper: Get Month & Year for grouping
function getMonthYear(dateStr) {
  if (!dateStr) return { key: "unknown", label: "Other" };
  try {
    const parts = dateStr.split(" ")[0].split("-");
    if (parts.length >= 2) {
      const year = parts[0];
      const monthIdx = parseInt(parts[1], 10) - 1;
      const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
      ];
      const monthName = monthNames[monthIdx] || parts[1];
      return {
        key: `${year}-${parts[1]}`,
        label: `${monthName} ${year}`
      };
    }
  } catch (e) {}
  return { key: "unknown", label: "Other" };
}

// 8. Render photo grid
function renderGrid(photos) {
  if (photos.length === 0) {
    grid.innerHTML = "<p class='empty-text'>No media items match your search.</p>";
    return;
  }

  if (currentSort === "newest" || currentSort === "oldest") {
    const groups = [];
    const groupMap = new Map();

    photos.forEach(p => {
      const my = getMonthYear(p.created_at);
      if (!groupMap.has(my.key)) {
        const groupObj = { key: my.key, label: my.label, items: [] };
        groupMap.set(my.key, groupObj);
        groups.push(groupObj);
      }
      groupMap.get(my.key).items.push(p);
    });

    grid.innerHTML = groups.map(group => {
      const cardsHtml = group.items.map(p => {
        const globalIdx = allPhotos.findIndex(item => item.id === p.id);
        const albumBadge = (p.album && p.album !== "General" && p.album !== "Umum") 
          ? `<span class="card-badge">${escapeHtml(p.album)}</span>` 
          : "";
        const isVid = isVideoFile(p);
        const videoBadge = isVid ? `<span class="card-video-badge">Video</span>` : "";
        const hasCustomThumb = p.thumb_url && p.thumb_url !== p.original_url && !p.thumb_url.endsWith(".mp4");
        const mediaHtml = (isVid && !hasCustomThumb)
          ? `<div class="card-video-placeholder">Video</div>`
          : `<img src="${p.thumb_url || p.original_url}" alt="${escapeHtml(p.title || 'Photo')}" loading="lazy" />`;

        const isSelected = selectedPhotoIds.has(p.id);
        return `
          <div class="card ${isSelected ? 'is-selected' : ''}" data-id="${p.id}" onclick="handleCardClick(${globalIdx}, '${p.id}')">
            <div class="card-select-checkbox"></div>
            <div class="card-image-box">
              ${mediaHtml}
              ${albumBadge}
              ${videoBadge}
            </div>
          </div>
        `;
      }).join("");

      return `
        <div class="month-group">
          <div class="month-header">
            <h3 class="month-title">${escapeHtml(group.label)}</h3>
            <span class="month-count">${group.items.length} Items</span>
          </div>
          <div class="grid">
            ${cardsHtml}
          </div>
        </div>
      `;
    }).join("");
  } else {
    grid.innerHTML = `
      <div class="grid">
        ${photos.map(p => {
          const globalIdx = allPhotos.findIndex(item => item.id === p.id);
          const albumBadge = (p.album && p.album !== "General" && p.album !== "Umum") 
            ? `<span class="card-badge">${escapeHtml(p.album)}</span>` 
            : "";
          const isVid = isVideoFile(p);
          const videoBadge = isVid ? `<span class="card-video-badge">Video</span>` : "";
          const hasCustomThumb = p.thumb_url && p.thumb_url !== p.original_url && !p.thumb_url.endsWith(".mp4");
          const mediaHtml = (isVid && !hasCustomThumb)
            ? `<div class="card-video-placeholder">Video</div>`
            : `<img src="${p.thumb_url || p.original_url}" alt="${escapeHtml(p.title || 'Photo')}" loading="lazy" />`;
          const isSelected = selectedPhotoIds.has(p.id);

          return `
            <div class="card ${isSelected ? 'is-selected' : ''}" data-id="${p.id}" onclick="handleCardClick(${globalIdx}, '${p.id}')">
              <div class="card-select-checkbox"></div>
              <div class="card-image-box">
                ${mediaHtml}
                ${albumBadge}
                ${videoBadge}
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }
}

// 8b. Multi-Select & Batch Action Engine
window.handleCardClick = function(globalIdx, photoId) {
  if (isSelectMode) {
    toggleSelectPhoto(photoId);
  } else {
    openLightbox(globalIdx);
  }
};

function toggleSelectMode() {
  if (currentUserRole !== "admin") return;
  if (isSelectMode) {
    exitSelectMode();
  } else {
    enterSelectMode();
  }
}

function enterSelectMode() {
  isSelectMode = true;
  selectedPhotoIds.clear();
  if (selectModeBtn) {
    selectModeBtn.textContent = "Cancel";
    selectModeBtn.classList.add("active");
  }
  if (grid) grid.classList.add("select-mode-active");
  if (batchActionBar) batchActionBar.classList.remove("hidden");
  updateBatchUI();
}

function exitSelectMode() {
  isSelectMode = false;
  selectedPhotoIds.clear();
  if (selectModeBtn) {
    selectModeBtn.textContent = "Select";
    selectModeBtn.classList.remove("active");
  }
  if (grid) grid.classList.remove("select-mode-active");
  if (batchActionBar) batchActionBar.classList.add("hidden");
  document.querySelectorAll(".card.is-selected").forEach(card => card.classList.remove("is-selected"));
  updateBatchUI();
}

function toggleSelectPhoto(id) {
  if (!isSelectMode) return;
  if (selectedPhotoIds.has(id)) {
    selectedPhotoIds.delete(id);
  } else {
    selectedPhotoIds.add(id);
  }
  const card = document.querySelector(`.card[data-id="${id}"]`);
  if (card) {
    if (selectedPhotoIds.has(id)) {
      card.classList.add("is-selected");
    } else {
      card.classList.remove("is-selected");
    }
  }
  updateBatchUI();
}

function updateBatchUI() {
  const count = selectedPhotoIds.size;
  if (batchCountText) {
    batchCountText.textContent = `${count} selected`;
  }
  if (batchDownloadBtn) {
    batchDownloadBtn.disabled = count === 0;
    batchDownloadBtn.textContent = count > 0 ? `Download (${count})` : "Download";
  }
  if (batchDeleteBtn) {
    batchDeleteBtn.disabled = count === 0;
    batchDeleteBtn.textContent = count > 0 ? `Delete (${count})` : "Delete";
    if (currentUserRole !== "admin") {
      batchDeleteBtn.style.display = "none";
    } else {
      batchDeleteBtn.style.display = "inline-block";
    }
  }
  if (batchSelectAllBtn) {
    const allSelected = allPhotos.length > 0 && selectedPhotoIds.size === allPhotos.length;
    batchSelectAllBtn.textContent = allSelected ? "Deselect All" : "Select All";
  }
}

async function handleBatchDownload() {
  if (selectedPhotoIds.size === 0) return;
  const ids = Array.from(selectedPhotoIds);
  const total = ids.length;
  if (batchDownloadBtn) {
    batchDownloadBtn.disabled = true;
    batchDownloadBtn.textContent = "Preparing...";
  }

  for (let i = 0; i < total; i++) {
    const id = ids[i];
    if (batchDownloadBtn) {
      batchDownloadBtn.textContent = `Download ${i + 1}/${total}...`;
    }
    try {
      const res = await fetch(`${API_URL}/api/photos/${id}/download-url`, {
        headers: { "X-API-KEY": currentAuthKey }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.download_url) {
          const tempLink = document.createElement("a");
          tempLink.href = data.download_url;
          tempLink.setAttribute("download", data.filename || "download_media");
          document.body.appendChild(tempLink);
          tempLink.click();
          tempLink.remove();
        }
      }
    } catch (err) {
      console.error("Failed to batch download file:", id, err);
    }

    if (i < total - 1) {
      await new Promise((r) => setTimeout(r, 450));
    }
  }

  if (batchDownloadBtn) {
    batchDownloadBtn.textContent = "Completed!";
    setTimeout(() => {
      updateBatchUI();
    }, 1500);
  }
}

function handleSelectAllToggle() {
  if (selectedPhotoIds.size === allPhotos.length) {
    selectedPhotoIds.clear();
    document.querySelectorAll(".card.is-selected").forEach(card => card.classList.remove("is-selected"));
  } else {
    allPhotos.forEach(p => selectedPhotoIds.add(p.id));
    document.querySelectorAll(".card").forEach(card => card.classList.add("is-selected"));
  }
  updateBatchUI();
}

async function handleBatchDelete() {
  if (currentUserRole !== "admin" || selectedPhotoIds.size === 0) return;
  const count = selectedPhotoIds.size;
  const confirmed = confirm(`Are you sure you want to permanently delete ${count} selected media items?`);
  if (!confirmed) return;

  const idsToDelete = Array.from(selectedPhotoIds);
  batchDeleteBtn.disabled = true;
  batchDeleteBtn.textContent = "Deleting...";

  try {
    const res = await fetch(`${API_URL}/api/photos/batch-delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": currentAuthKey
      },
      body: JSON.stringify({ ids: idsToDelete })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      exitSelectMode();
      fetchAlbums();
      fetchStorageStats();
      fetchPhotos(true);
    } else {
      alert(data.error || "Failed to delete selected items.");
      updateBatchUI();
    }
  } catch (err) {
    console.error("Batch delete error:", err);
    alert("Connection error while deleting.");
    updateBatchUI();
  }
}

// 9. Lightbox Modal Functions & Zoom Engine
let zoomScale = 1;
let zoomTranslateX = 0;
let zoomTranslateY = 0;
let isPanning = false;
let startPanX = 0;
let startPanY = 0;

function resetLightboxZoom() {
  zoomScale = 1;
  zoomTranslateX = 0;
  zoomTranslateY = 0;
  isPanning = false;
  if (lightboxImg) {
    lightboxImg.style.transform = "none";
    lightboxImg.classList.remove("is-zoomed", "is-grabbing");
  }
}

function updateLightboxZoomTransform() {
  if (!lightboxImg) return;
  if (zoomScale <= 1) {
    resetLightboxZoom();
  } else {
    lightboxImg.style.transform = `scale(${zoomScale}) translate(${zoomTranslateX}px, ${zoomTranslateY}px)`;
    lightboxImg.classList.add("is-zoomed");
  }
}

function initLightboxZoomEvents() {
  if (!lightboxImg) return;

  // 1. Double Click Desktop: toggle zoom 1x <-> 2.2x
  lightboxImg.addEventListener("dblclick", (e) => {
    e.preventDefault();
    if (zoomScale > 1) {
      resetLightboxZoom();
    } else {
      zoomScale = 2.2;
      zoomTranslateX = 0;
      zoomTranslateY = 0;
      updateLightboxZoomTransform();
    }
  });

  // 2. Mouse Wheel Desktop: zoom bertahap 1x - 4x
  lightboxImg.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.3 : -0.3;
    const newScale = Math.min(4, Math.max(1, zoomScale + delta));
    if (newScale !== zoomScale) {
      zoomScale = Math.round(newScale * 10) / 10;
      updateLightboxZoomTransform();
    }
  }, { passive: false });

  // 3. Mouse Pan / Drag saat di-zoom
  lightboxImg.addEventListener("mousedown", (e) => {
    if (zoomScale <= 1) return;
    isPanning = true;
    startPanX = e.clientX - zoomTranslateX * zoomScale;
    startPanY = e.clientY - zoomTranslateY * zoomScale;
    lightboxImg.classList.add("is-grabbing");
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!isPanning || zoomScale <= 1) return;
    zoomTranslateX = (e.clientX - startPanX) / zoomScale;
    zoomTranslateY = (e.clientY - startPanY) / zoomScale;
    lightboxImg.style.transform = `scale(${zoomScale}) translate(${zoomTranslateX}px, ${zoomTranslateY}px)`;
  });

  window.addEventListener("mouseup", () => {
    if (isPanning) {
      isPanning = false;
      if (lightboxImg) lightboxImg.classList.remove("is-grabbing");
    }
  });

  // 4. Touch Mobile: Double tap to zoom & Touch Pan
  let lastTap = 0;
  lightboxImg.addEventListener("touchend", (e) => {
    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTap;
    if (tapLength < 320 && tapLength > 0) {
      e.preventDefault();
      if (zoomScale > 1) {
        resetLightboxZoom();
      } else {
        zoomScale = 2.2;
        zoomTranslateX = 0;
        zoomTranslateY = 0;
        updateLightboxZoomTransform();
      }
    }
    lastTap = currentTime;
  });

  let touchStartX = 0;
  let touchStartY = 0;
  lightboxImg.addEventListener("touchstart", (e) => {
    if (zoomScale <= 1) return;
    if (e.touches.length === 1) {
      isPanning = true;
      touchStartX = e.touches[0].clientX - zoomTranslateX * zoomScale;
      touchStartY = e.touches[0].clientY - zoomTranslateY * zoomScale;
    }
  }, { passive: true });

  lightboxImg.addEventListener("touchmove", (e) => {
    if (!isPanning || zoomScale <= 1) return;
    if (e.touches.length === 1) {
      zoomTranslateX = (e.touches[0].clientX - touchStartX) / zoomScale;
      zoomTranslateY = (e.touches[0].clientY - touchStartY) / zoomScale;
      lightboxImg.style.transform = `scale(${zoomScale}) translate(${zoomTranslateX}px, ${zoomTranslateY}px)`;
    }
  }, { passive: true });

  lightboxImg.addEventListener("touchend", () => {
    isPanning = false;
  });
}

// 5. Mobile Touch Swipe Navigation (Swipe left/right to browse media)
function initLightboxSwipeEvents() {
  if (!lightboxModal) return;

  let swipeStartX = 0;
  let swipeStartY = 0;
  let swipeStartTime = 0;

  lightboxModal.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1 && zoomScale <= 1) {
      swipeStartX = e.touches[0].clientX;
      swipeStartY = e.touches[0].clientY;
      swipeStartTime = Date.now();
    }
  }, { passive: true });

  lightboxModal.addEventListener("touchend", (e) => {
    if (zoomScale > 1 || !swipeStartX) return;

    if (e.target.closest("button, a, input, select, textarea, .lightbox-footer")) {
      swipeStartX = 0;
      swipeStartY = 0;
      return;
    }

    const touch = e.changedTouches[0];
    if (!touch) return;

    const deltaX = touch.clientX - swipeStartX;
    const deltaY = touch.clientY - swipeStartY;
    const elapsedTime = Date.now() - swipeStartTime;

    // Trigger only on distinct horizontal swipe gestures
    if (elapsedTime < 500 && Math.abs(deltaX) > 45 && Math.abs(deltaX) > Math.abs(deltaY) * 1.4) {
      if (deltaX < 0) {
        showNextPhoto();
      } else {
        showPrevPhoto();
      }
    }

    swipeStartX = 0;
    swipeStartY = 0;
  }, { passive: true });
}

window.openLightbox = function(index) {
  if (index < 0 || index >= allPhotos.length) return;
  resetLightboxZoom();
  currentPhotoIndex = index;
  const photo = allPhotos[index];

  const isVid = isVideoFile(photo);
  if (isVid) {
    lightboxImg.classList.add("hidden");
    lightboxImg.src = "";
    lightboxVideo.classList.remove("hidden");
    lightboxVideo.src = photo.original_url;
    lightboxVideo.load();
  } else {
    lightboxVideo.pause();
    lightboxVideo.src = "";
    lightboxVideo.classList.add("hidden");
    lightboxImg.classList.remove("hidden");
    lightboxImg.src = photo.original_url;
  }

  lightboxTitle.textContent = photo.title || photo.filename;
  lightboxAlbum.textContent = photo.album || "General";
  lightboxDetails.textContent = `File: ${photo.filename} • Date: ${formatDate(photo.created_at)}`;
  lightboxDownload.href = photo.original_url;
  lightboxDownload.setAttribute("download", photo.filename);

  lightboxModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
};

function toggleLightboxFullscreen() {
  const isFs = !!(document.fullscreenElement || lightboxModal.classList.contains("fullscreen-active"));
  if (!isFs) {
    if (lightboxModal.requestFullscreen) {
      lightboxModal.requestFullscreen().catch(() => {
        lightboxModal.classList.add("fullscreen-active");
      });
    } else if (lightboxModal.webkitRequestFullscreen) {
      lightboxModal.webkitRequestFullscreen();
    } else {
      lightboxModal.classList.add("fullscreen-active");
    }
    if (lightboxFullscreenBtn) lightboxFullscreenBtn.textContent = "Exit Fullscreen";
  } else {
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
    lightboxModal.classList.remove("fullscreen-active");
    if (lightboxFullscreenBtn) lightboxFullscreenBtn.textContent = "Fullscreen";
  }
}

document.addEventListener("fullscreenchange", () => {
  const inFs = !!document.fullscreenElement;
  if (!inFs) {
    lightboxModal.classList.remove("fullscreen-active");
    if (lightboxFullscreenBtn) lightboxFullscreenBtn.textContent = "Fullscreen";
  } else {
    lightboxModal.classList.add("fullscreen-active");
    if (lightboxFullscreenBtn) lightboxFullscreenBtn.textContent = "Exit Fullscreen";
  }
});

function closeLightbox() {
  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
  lightboxModal.classList.remove("fullscreen-active");
  if (lightboxFullscreenBtn) lightboxFullscreenBtn.textContent = "Fullscreen";
  resetLightboxZoom();
  lightboxModal.classList.add("hidden");
  lightboxImg.src = "";
  lightboxVideo.pause();
  lightboxVideo.src = "";
  document.body.style.overflow = "";
}

// Handler direct-to-disk download using Presigned GET URL
async function handleDownloadCurrentPhoto(e) {
  if (e) e.preventDefault();
  if (currentPhotoIndex < 0 || currentPhotoIndex >= allPhotos.length) return;
  const photo = allPhotos[currentPhotoIndex];
  if (!photo || !photo.original_url) return;

  const originalText = "Download";
  lightboxDownload.style.pointerEvents = "none";
  lightboxDownload.textContent = "Preparing...";

  try {
    const res = await fetch(`${API_URL}/api/photos/${photo.id}/download-url`, {
      headers: {
        "X-API-KEY": currentAuthKey
      }
    });

    if (res.ok) {
      const data = await res.json();
      if (data.download_url) {
        const tempLink = document.createElement("a");
        tempLink.href = data.download_url;
        tempLink.setAttribute("download", data.filename || photo.filename || "download_media");
        document.body.appendChild(tempLink);
        tempLink.click();
        document.body.removeChild(tempLink);

        lightboxDownload.textContent = "Downloading...";
        await new Promise((r) => setTimeout(r, 1500));
        return;
      }
    }
    throw new Error("Failed to get download URL");
  } catch (err) {
    console.warn("Presigned download failed, trying streaming fallback:", err);
    try {
      const downloadUrl = photo.original_url + (photo.original_url.includes("?") ? "&" : "?") + "dl=" + Date.now();
      const response = await fetch(downloadUrl, { mode: "cors" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const tempLink = document.createElement("a");
      tempLink.href = blobUrl;
      tempLink.download = photo.filename || "download_media";
      document.body.appendChild(tempLink);
      tempLink.click();
      document.body.removeChild(tempLink);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
      lightboxDownload.textContent = "Saved!";
      await new Promise((r) => setTimeout(r, 1200));
    } catch (fbErr) {
      console.error("All download methods failed:", fbErr);
      lightboxDownload.textContent = "Download failed";
      await new Promise((r) => setTimeout(r, 2000));
    }
  } finally {
    lightboxDownload.textContent = originalText;
    lightboxDownload.style.pointerEvents = "auto";
  }
}

function showPrevPhoto() {
  if (allPhotos.length === 0) return;
  let prevIndex = currentPhotoIndex - 1;
  if (prevIndex < 0) prevIndex = allPhotos.length - 1;
  openLightbox(prevIndex);
}

function showNextPhoto() {
  if (allPhotos.length === 0) return;
  let nextIndex = currentPhotoIndex + 1;
  if (nextIndex >= allPhotos.length) nextIndex = 0;
  openLightbox(nextIndex);
}

// Open edit modal (Admin only)
function openEditModal() {
  if (currentUserRole !== "admin") {
    alert("Access Denied: Admin role required to edit media.");
    return;
  }

  if (currentPhotoIndex < 0 || currentPhotoIndex >= allPhotos.length) return;
  const photo = allPhotos[currentPhotoIndex];

  editPhotoTitle.value = photo.title || photo.filename;
  editPhotoAlbum.value = photo.album || "General";

  if (photo.created_at) {
    const raw = photo.created_at.replace(" ", "T");
    editPhotoDate.value = raw.length === 19 ? raw : raw.substring(0, 19);
  } else {
    editPhotoDate.value = "";
  }

  // Populate album datalist
  const existingAlbums = Array.from(albumSelect.options)
    .map(o => o.value)
    .filter(v => v && v !== "__new__");
  editAlbumDatalist.innerHTML = existingAlbums.map(a => `<option value="${escapeHtml(a)}">`).join("");

  editModal.classList.remove("hidden");
}

function closeEditModal() {
  editModal.classList.add("hidden");
}

// Save photo changes (Title, Album, Date)
async function handleSavePhotoEdit(e) {
  e.preventDefault();

  if (currentUserRole !== "admin") return;
  if (currentPhotoIndex < 0 || currentPhotoIndex >= allPhotos.length) return;
  const photo = allPhotos[currentPhotoIndex];

  const newTitle = editPhotoTitle.value.trim() || photo.filename;
  const newAlbum = editPhotoAlbum.value.trim() || "General";
  let newDate = photo.created_at;

  if (editPhotoDate.value) {
    newDate = editPhotoDate.value.replace("T", " ");
    if (newDate.length === 16) newDate += ":00";
  }

  editModalSaveBtn.disabled = true;
  editModalSaveText.textContent = "Saving...";

  try {
    const res = await fetch(`${API_URL}/api/photos/${photo.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": currentAuthKey
      },
      body: JSON.stringify({
        title: newTitle,
        album: newAlbum,
        created_at: newDate
      })
    });

    const data = await res.json();

    if (res.ok && data.success) {
      photo.title = data.photo.title;
      photo.album = data.photo.album;
      photo.created_at = data.photo.created_at;

      lightboxTitle.textContent = photo.title;
      lightboxAlbum.textContent = photo.album;
      lightboxDetails.textContent = `File: ${photo.filename} • Date: ${formatDate(photo.created_at)}`;

      closeEditModal();
      fetchAlbums();
      fetchPhotos(true);
      alert("Media information updated successfully!");
    } else {
      alert(data.error || "Failed to update media.");
    }
  } catch (err) {
    console.error(err);
    alert("Network error.");
  } finally {
    editModalSaveBtn.disabled = false;
    editModalSaveText.textContent = "Save Changes";
  }
}

// Delete current active media
async function handleDeleteCurrentPhoto() {
  if (currentUserRole !== "admin") {
    alert("Access Denied: Admin role required to delete media.");
    return;
  }

  if (currentPhotoIndex < 0 || currentPhotoIndex >= allPhotos.length) return;
  const photo = allPhotos[currentPhotoIndex];

  const confirmDelete = confirm(`Are you sure you want to delete "${photo.title || photo.filename}"?`);
  if (!confirmDelete) return;

  lightboxDelete.disabled = true;
  lightboxDelete.textContent = "Deleting...";

  try {
    const res = await fetch(`${API_URL}/api/photos/${photo.id}`, {
      method: "DELETE",
      headers: {
        "X-API-KEY": currentAuthKey
      }
    });

    const data = await res.json();

    if (res.ok && data.success) {
      alert("Media item deleted successfully.");
      closeLightbox();
      fetchAlbums();
      fetchStorageStats();
      fetchPhotos(true);
    } else {
      alert(data.error || "Failed to delete media.");
    }
  } catch (err) {
    console.error(err);
    alert("Connection error while deleting media.");
  } finally {
    lightboxDelete.disabled = false;
    lightboxDelete.textContent = "Delete";
  }
}

// Global window function for remove queue item
window.removeQueueItem = removeQueueItem;

// Helper: Status Notification
function showStatus(text, type = "info") {
  statusMsg.textContent = text;
  statusMsg.className = `status-msg ${type}`;
}

// Helper: Format date
function formatDate(dateStr) {
  if (!dateStr) return "";
  try {
    const datePart = dateStr.split(" ")[0];
    const parts = datePart.split("-");
    if (parts.length === 3) {
      const year = parts[0];
      const monthIdx = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const monthNames = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
      ];
      const monthName = monthNames[monthIdx] || parts[1];
      return `${day} ${monthName} ${year}`;
    }

    const d = new Date(dateStr.replace(" ", "T"));
    return d.toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  } catch (e) {
    return dateStr;
  }
}

// Helper: Escape HTML
function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}