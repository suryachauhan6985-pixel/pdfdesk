// Merge PDF — iLovePDF style with horizontal thumbnails + drag reorder

const API_BASE = "http://localhost:5050";

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

const dropzone = document.getElementById("dropzone");
const thumbsArea = document.getElementById("thumbsArea");
const thumbsRow = document.getElementById("thumbsRow");
const thumbsCount = document.getElementById("thumbsCount");
const fileInput = document.getElementById("fileInput");
const selectBtn = document.getElementById("selectBtn");
const addMoreBtn = document.getElementById("addMoreBtn");
const mergeBtn = document.getElementById("mergeBtn");
const statusEl = document.getElementById("status");

let files = []; // { id, file, thumb }
let nextId = 1;
let dragSrcIndex = null;

// ---------- Helpers ----------
function showStatus(msg, type = "") {
  statusEl.textContent = msg;
  statusEl.className = "side-status" + (type ? ` ${type}` : "");
}

function updateUI() {
  const hasFiles = files.length > 0;
  dropzone.hidden = hasFiles;
  thumbsArea.hidden = !hasFiles;

  thumbsCount.textContent = files.length + (files.length === 1 ? " file" : " files");
  mergeBtn.disabled = files.length < 2;
  mergeBtn.textContent = files.length < 2 ? "Select at least 2 PDFs" : "Merge PDF →";

  renderThumbs();
}

async function renderPdfThumb(file) {
  if (!window.pdfjsLib) return null;
  try {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 0.45 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    return canvas.toDataURL();
  } catch {
    return null;
  }
}

function renderThumbs() {
  thumbsRow.innerHTML = "";

  files.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = "thumb-card";
    card.draggable = true;
    card.dataset.index = index;

    card.innerHTML = `
      <button class="thumb-remove" data-id="${item.id}" title="Remove">×</button>
      <div class="thumb-preview">
        ${
          item.thumb
            ? `<img src="${item.thumb}" alt="${item.file.name}" />`
            : `<span class="loading">Loading...</span>`
        }
      </div>
      <div class="thumb-name">${item.file.name}</div>
    `;

    // Remove
    card.querySelector(".thumb-remove").addEventListener("click", (e) => {
      e.stopPropagation();
      files = files.filter((f) => f.id !== item.id);
      updateUI();
    });

    // Drag reorder
    card.addEventListener("dragstart", (e) => {
      dragSrcIndex = index;
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      dragSrcIndex = null;
    });
    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      if (dragSrcIndex === null || dragSrcIndex === index) return;
      const moved = files.splice(dragSrcIndex, 1)[0];
      files.splice(index, 0, moved);
      updateUI();
    });

    thumbsRow.appendChild(card);
  });
}

// ---------- File selection ----------
function addFiles(fileListRaw) {
  const newFiles = Array.from(fileListRaw).filter((f) => f.type === "application/pdf");
  if (newFiles.length === 0) {
    showStatus("Please select valid PDF files.", "error");
    return;
  }

  newFiles.forEach((file) => {
    files.push({ id: nextId++, file, thumb: null });
  });

  showStatus("");
  updateUI();
  generateThumbs();
}

async function generateThumbs() {
  for (const item of files) {
    if (item.thumb) continue;
    item.thumb = await renderPdfThumb(item.file);
    renderThumbs();
  }
}

selectBtn.addEventListener("click", () => fileInput.click());
addMoreBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", (e) => {
  addFiles(e.target.files);
  fileInput.value = "";
});

// Drag & drop on dropzone
["dragenter", "dragover"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
});
["dragleave", "drop"].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  });
});
dropzone.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));

// Also allow drop on the whole left area when files are already there
thumbsArea.addEventListener("dragover", (e) => e.preventDefault());
thumbsArea.addEventListener("drop", (e) => {
  e.preventDefault();
  if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
});

// ---------- Merge ----------
mergeBtn.addEventListener("click", async () => {
  if (files.length < 2) return;

  mergeBtn.disabled = true;
  showStatus("Merging PDFs... please wait");

  try {
    const formData = new FormData();
    files.forEach((item) => formData.append("files", item.file));

    const res = await fetch(`${API_BASE}/api/merge`, {
      method: "POST",
      body: formData
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Merge failed");
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pdfdesk-merged.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    showStatus("Done! Merged PDF downloaded.", "success");
  } catch (err) {
    console.error(err);
    showStatus(err.message || "Something went wrong.", "error");
  } finally {
    mergeBtn.disabled = files.length < 2;
  }
});
