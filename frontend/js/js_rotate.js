// Rotate PDF — per-page rotation with live preview

const API_BASE = "https://pdfdesk.onrender.com";

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

const dropzone = document.getElementById("dropzone");
const rotateGrid = document.getElementById("rotateGrid");
const rotateControls = document.getElementById("rotateControls");
const fileInput = document.getElementById("fileInput");
const selectBtn = document.getElementById("selectBtn");
const rotateAllLeftBtn = document.getElementById("rotateAllLeftBtn");
const rotateAllRightBtn = document.getElementById("rotateAllRightBtn");
const rotateBtn = document.getElementById("rotateBtn");
const statusEl = document.getElementById("status");

let selectedFile = null;
let totalPages = 0;
let pageThumbs = []; // dataURL per page
let rotations = [];  // current absolute angle per page (0/90/180/270)

function showStatus(msg, type = "") {
  statusEl.textContent = msg;
  statusEl.className = "side-status" + (type ? ` ${type}` : "");
}

function normalize(angle) {
  return ((angle % 360) + 360) % 360;
}

function updateUI() {
  const hasFile = !!selectedFile;
  dropzone.hidden = hasFile;
  rotateGrid.hidden = !hasFile;
  rotateControls.hidden = !hasFile;
  rotateBtn.disabled = !hasFile;
  renderGrid();
}

function renderGrid() {
  rotateGrid.innerHTML = "";
  for (let i = 0; i < totalPages; i++) {
    const thumb = pageThumbs[i];
    const angle = rotations[i] || 0;

    const card = document.createElement("div");
    card.className = "rotate-card";
    card.innerHTML = `
      <div class="rotate-preview">
        ${
          thumb
            ? `<img src="${thumb}" style="transform: rotate(${angle}deg);" />`
            : `<span class="loading">...</span>`
        }
      </div>
      <div class="rotate-controls">
        <button class="rotate-btn" data-i="${i}" data-dir="-90" title="Rotate left">↺</button>
        <span class="rotate-page-num">${i + 1}</span>
        <button class="rotate-btn" data-i="${i}" data-dir="90" title="Rotate right">↻</button>
      </div>
    `;
    rotateGrid.appendChild(card);
  }

  rotateGrid.querySelectorAll(".rotate-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.i);
      const dir = Number(btn.dataset.dir);
      rotations[i] = normalize((rotations[i] || 0) + dir);
      renderGrid();
    });
  });
}

async function loadPdf(file) {
  selectedFile = file;
  pageThumbs = [];
  totalPages = 0;
  rotations = [];
  showStatus("Loading PDF...");
  updateUI();

  try {
    if (!window.pdfjsLib) throw new Error("pdf.js not loaded");
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    totalPages = pdf.numPages;
    pageThumbs = new Array(totalPages).fill(null);
    rotations = new Array(totalPages).fill(0);

    updateUI();
    showStatus("");

    for (let i = 1; i <= totalPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 0.4 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      pageThumbs[i - 1] = canvas.toDataURL();
      renderGrid();
    }
  } catch (err) {
    console.error(err);
    showStatus("Failed to load PDF.", "error");
    selectedFile = null;
    updateUI();
  }
}

selectBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => {
  if (e.target.files[0]) loadPdf(e.target.files[0]);
  fileInput.value = "";
});

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
dropzone.addEventListener("drop", (e) => {
  const f = e.dataTransfer.files[0];
  if (f && f.type === "application/pdf") loadPdf(f);
});

rotateAllLeftBtn.addEventListener("click", () => {
  rotations = rotations.map((a) => normalize(a - 90));
  renderGrid();
});
rotateAllRightBtn.addEventListener("click", () => {
  rotations = rotations.map((a) => normalize(a + 90));
  renderGrid();
});

rotateBtn.addEventListener("click", async () => {
  if (!selectedFile) return;

  rotateBtn.disabled = true;
  showStatus("");
  PDFDeskOverlay.show("Rotating PDF");

  try {
    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("rotations", JSON.stringify(rotations));

    const res = await PDFDeskOverlay.upload(`${API_BASE}/api/rotate`, formData);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Rotate failed");
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pdfdesk-rotated.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    showStatus("Done! Rotated PDF downloaded.", "success");
  } catch (err) {
    console.error(err);
    showStatus(err.message || "Something went wrong.", "error");
  } finally {
    rotateBtn.disabled = false;
    PDFDeskOverlay.hide(500);
  }
});