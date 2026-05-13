/**
 * PhotoVault — Client-Side Application
 *
 * Talks to the Python Flask backend via REST endpoints:
 *   POST   /api/upload   — Upload a photo (multipart/form-data)
 *   GET    /api/photos    — Fetch all photos
 *   GET    /api/search?q= — Search photos by label
 *   DELETE /api/photos/:id — Delete a photo
 */

// =============================================================
// DOM References
// =============================================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const navBtns = $$(".nav-btn");
const galleryView = $("#gallery-view");
const uploadView = $("#upload-view");
const heroSection = $("#hero-section");
const photoGrid = $("#photo-grid");
const emptyState = $("#empty-state");
const noResults = $("#no-results");
const noResultsText = $("#no-results-text");
const galleryStatus = $("#gallery-status");
const searchContainer = $("#search-container");
const searchInput = $("#search-input");
const searchClear = $("#search-clear");
const labelChips = $("#label-chips");
const dropzone = $("#dropzone");
const fileInput = $("#file-input");
const uploadQueue = $("#upload-queue");
const lightbox = $("#lightbox");
const lightboxImg = $("#lightbox-img");
const lightboxFilename = $("#lightbox-filename");
const lightboxLabels = $("#lightbox-labels");
const lightboxClose = $("#lightbox-close");
const lightboxBackdrop = $("#lightbox-backdrop");
const lightboxDelete = $("#lightbox-delete");
const emptyUploadBtn = $("#empty-upload-btn");
const toastContainer = $("#toast-container");

// =============================================================
// State
// =============================================================
let allPhotos = [];
let allLabelsMap = {}; // label -> count
let currentSearch = "";
let activeChip = null;
let currentLightboxPhoto = null;

// =============================================================
// Navigation
// =============================================================
navBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const view = btn.dataset.view;
    navBtns.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    if (view === "gallery") {
      galleryView.classList.add("active");
      uploadView.classList.remove("active");
      searchContainer.style.display = ""; // Show search bar
      labelChips.style.display = ""; 
    } else {
      uploadView.classList.add("active");
      galleryView.classList.remove("active");
      searchContainer.style.display = "none"; // Hide search bar
      labelChips.style.display = "none";
    }
  });
});

emptyUploadBtn?.addEventListener("click", () => {
  $("#nav-upload").click();
});

// =============================================================
// API: Fetch all photos
// =============================================================
async function loadPhotos() {
  // Show skeleton loading
  photoGrid.innerHTML = Array(6)
    .fill('<div class="skeleton skeleton-card"></div>')
    .join("");

  try {
    const res = await fetch("/api/photos");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allPhotos = await res.json();

    // Build label frequency map
    allLabelsMap = {};
    allPhotos.forEach((photo) => {
      (photo.labels || []).forEach((label) => {
        const key = label.toLowerCase();
        allLabelsMap[key] = (allLabelsMap[key] || 0) + 1;
      });
    });

    renderLabelChips();
    renderGallery();
  } catch (err) {
    console.error("Failed to load photos:", err);
    showToast("Failed to load photos. Is the server running?", "error");
    photoGrid.innerHTML = "";
    emptyState.classList.remove("hidden");
  }
}

// =============================================================
// API: Search photos
// =============================================================
async function searchPhotos(query) {
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error("Search failed:", err);
    showToast("Search failed", "error");
    return [];
  }
}

// =============================================================
// API: Delete photo
// =============================================================
async function deletePhoto(photoId) {
  try {
    const res = await fetch(`/api/photos/${photoId}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    showToast("Photo deleted", "success");
    closeLightbox();
    await loadPhotos();
  } catch (err) {
    console.error("Delete failed:", err);
    showToast("Failed to delete photo", "error");
  }
}

// =============================================================
// Render: Gallery
// =============================================================
function renderGallery() {
  const query = currentSearch.trim().toLowerCase();
  let filtered = allPhotos;

  if (query) {
    filtered = allPhotos.filter((photo) =>
      (photo.labelsLower || []).some((label) => label.includes(query))
    );
  }

  // Update status
  if (query) {
    galleryStatus.textContent = `Showing ${filtered.length} result${filtered.length !== 1 ? "s" : ""} for "${currentSearch.trim()}"`;
  } else {
    galleryStatus.textContent =
      allPhotos.length > 0
        ? `${allPhotos.length} photo${allPhotos.length !== 1 ? "s" : ""} in your vault`
        : "";
  }

  // Toggle states
  photoGrid.innerHTML = "";
  emptyState.classList.toggle("hidden", allPhotos.length > 0 || !!query);
  noResults.classList.toggle("hidden", !(query && filtered.length === 0));

  if (query && filtered.length === 0) {
    noResultsText.textContent = `No photos match "${currentSearch.trim()}"`;
  }

  // Render cards
  filtered.forEach((photo, i) => {
    const card = document.createElement("div");
    card.className = "photo-card";
    card.style.animationDelay = `${i * 50}ms`;

    const topLabels = (photo.labels || []).slice(0, 4);
    const tagsHTML = topLabels
      .map((l) => `<span class="photo-card-tag">${escapeHtml(l)}</span>`)
      .join("");

    card.innerHTML = `
      <img class="photo-card-img" src="${photo.imageUrl}" alt="${escapeHtml(photo.fileName || "Photo")}" loading="lazy" />
      <div class="photo-card-overlay">
        <div class="photo-card-name">${escapeHtml(photo.fileName || "Untitled")}</div>
        <div class="photo-card-tags">${tagsHTML}</div>
      </div>
    `;

    card.addEventListener("click", () => openLightbox(photo));
    photoGrid.appendChild(card);
  });
}

// =============================================================
// Render: Label Chips
// =============================================================
function renderLabelChips() {
  const sorted = Object.entries(allLabelsMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  labelChips.innerHTML = sorted
    .map(
      ([label, count]) =>
        `<button class="chip${activeChip === label ? " active" : ""}" data-label="${escapeHtml(label)}">
          ${escapeHtml(label.charAt(0).toUpperCase() + label.slice(1))}
          <span class="chip-count">${count}</span>
        </button>`
    )
    .join("");

  labelChips.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const label = chip.dataset.label;
      if (activeChip === label) {
        activeChip = null;
        searchInput.value = "";
        currentSearch = "";
      } else {
        activeChip = label;
        searchInput.value = label;
        currentSearch = label;
      }
      searchClear.classList.toggle("hidden", !currentSearch);
      renderLabelChips();
      renderGallery();
    });
  });
}

// =============================================================
// Search Input
// =============================================================
let searchDebounce = null;
searchInput.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    currentSearch = searchInput.value;
    activeChip = currentSearch.trim().toLowerCase() || null;
    searchClear.classList.toggle("hidden", !currentSearch);
    renderLabelChips();
    renderGallery();
  }, 250);
});

searchClear.addEventListener("click", () => {
  searchInput.value = "";
  currentSearch = "";
  activeChip = null;
  searchClear.classList.add("hidden");
  renderLabelChips();
  renderGallery();
  searchInput.focus();
});

// =============================================================
// Upload: Drag & Drop
// =============================================================
dropzone.addEventListener("click", () => fileInput.click());

dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("drag-over");
});

dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("drag-over");
});

dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag-over");
  const files = Array.from(e.dataTransfer.files).filter((f) =>
    f.type.startsWith("image/")
  );
  if (files.length) uploadFiles(files);
});

fileInput.addEventListener("change", () => {
  const files = Array.from(fileInput.files);
  if (files.length) uploadFiles(files);
  fileInput.value = "";
});

// =============================================================
// Upload: Process Files via Python API
// =============================================================
async function uploadFiles(files) {
  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) {
      showToast(`${file.name} is too large (max 10 MB)`, "error");
      continue;
    }

    const itemId = `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const thumb = URL.createObjectURL(file);

    // Create upload queue item
    const item = document.createElement("div");
    item.className = "upload-item";
    item.id = itemId;
    item.innerHTML = `
      <img class="upload-item-thumb" src="${thumb}" alt="" />
      <div class="upload-item-info">
        <div class="upload-item-name">${escapeHtml(file.name)}</div>
        <div class="upload-item-status">Uploading & analyzing with Vision AI…</div>
        <div class="upload-item-progress">
          <div class="upload-item-progress-bar" id="${itemId}-bar" style="width: 30%"></div>
        </div>
      </div>
      <div class="upload-item-icon">
        <div class="spinner"></div>
      </div>
    `;
    uploadQueue.prepend(item);

    // POST to Python backend
    const formData = new FormData();
    formData.append("photo", file);

    try {
      const bar = document.getElementById(`${itemId}-bar`);
      if (bar) bar.style.width = "60%";

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const result = await res.json();

      // Show success with detected labels
      const labels = result.photo?.labels || [];
      updateUploadItem(itemId, "success", `Done — ${labels.length} labels detected!`, labels);
      showToast(`${file.name} — detected: ${labels.slice(0, 3).join(", ")}`, "success");

      // Refresh the gallery
      await loadPhotos();
    } catch (err) {
      console.error("Upload error:", err);
      updateUploadItem(itemId, "error", `Failed: ${err.message}`);
      showToast(`Failed to upload ${file.name}: ${err.message}`, "error");
    }
  }
}

function updateUploadItem(itemId, status, message, labels = []) {
  const item = document.getElementById(itemId);
  if (!item) return;

  const statusEl = item.querySelector(".upload-item-status");
  const iconEl = item.querySelector(".upload-item-icon");
  const progressEl = item.querySelector(".upload-item-progress");
  const infoEl = item.querySelector(".upload-item-info");

  if (statusEl) statusEl.textContent = message;
  if (progressEl) progressEl.style.display = "none";

  // Show labels if available
  if (labels.length > 0 && infoEl) {
    const labelsHtml = labels.slice(0, 5)
      .map((l) => `<span class="upload-item-label">${escapeHtml(l)}</span>`)
      .join("");
    const labelsDiv = document.createElement("div");
    labelsDiv.className = "upload-item-labels";
    labelsDiv.innerHTML = labelsHtml;
    infoEl.appendChild(labelsDiv);
  }

  if (status === "success") {
    iconEl.className = "upload-item-icon success";
    iconEl.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
  } else if (status === "error") {
    iconEl.className = "upload-item-icon error";
    iconEl.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  }
}

// =============================================================
// Lightbox
// =============================================================
function openLightbox(photo) {
  currentLightboxPhoto = photo;
  lightboxImg.src = photo.imageUrl;
  lightboxImg.alt = photo.fileName || "Photo";
  lightboxFilename.textContent = photo.fileName || "Untitled";

  const labels = photo.labels || [];
  const scores = photo.scores || {};
  lightboxLabels.innerHTML = labels
    .map((l) => {
      const score = scores[l] ? `<span class="score">${scores[l]}%</span>` : "";
      return `<span class="lightbox-label">${escapeHtml(l)}${score}</span>`;
    })
    .join("");

  lightbox.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  lightbox.classList.add("hidden");
  document.body.style.overflow = "";
  currentLightboxPhoto = null;
}

lightboxClose.addEventListener("click", closeLightbox);
lightboxBackdrop.addEventListener("click", closeLightbox);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeLightbox();
});

lightboxDelete.addEventListener("click", () => {
  if (!currentLightboxPhoto) return;
  if (confirm("Delete this photo permanently?")) {
    deletePhoto(currentLightboxPhoto.id);
  }
});

// =============================================================
// Toast
// =============================================================
function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("toast-exit");
    toast.addEventListener("animationend", () => toast.remove());
  }, 4000);
}

// =============================================================
// Utilities
// =============================================================
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// =============================================================
// Initialize
// =============================================================
loadPhotos();
