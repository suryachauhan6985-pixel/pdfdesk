// Split PDF — multiple ranges support (iLovePDF style)

const API_BASE = "https://pdfdesk.onrender.com";

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

const dropzone = document.getElementById("dropzone");
const rangesArea = document.getElementById("rangesArea");
const rangesGrid = document.getElementById("rangesGrid");
const rangesList = document.getElementById("rangesList");
const splitControls = document.getElementById("splitControls");
const fileInput = document.getElementById("fileInput");
const selectBtn = document.getElementById("selectBtn");
const addRangeBtn = document.getElementById("addRangeBtn");
const splitBtn = document.getElementById("splitBtn");
const statusEl = document.getElementById("status");
const mergeRangesCheck = document.getElementById("mergeRangesCheck");

let selectedFile = null;
let totalPages = 0;
let pageThumbs = []; // dataURL per page
let ranges = []; // [{ from, to }]

function showStatus(msg, type = "") {
  statusEl.textContent = msg;
  statusEl.className = "side-status" + (type ? ` ${type}` : "");
}

function updateUI() {
  const hasFile = !!selectedFile;
  dropzone.hidden = hasFile;
  rangesArea.hidden = !hasFile;
  splitControls.hidden = !hasFile;
  splitBtn.disabled = !hasFile || ranges.length === 0;
  renderRangeInputs();
  renderRangeCards();
}

function renderRangeInputs() {
  rangesList.innerHTML = "";
  ranges.forEach((r, i) => {
    const row = document.createElement("div");
    row.className = "range-row";
    row.innerHTML = `
      <div class="range-row-header">
        <span class="range-label">Range ${i + 1}</span>
        ${ranges.length > 1 ? `<button class="range-remove" data-i="${i}" title="Remove">×</button>` : ""}
      </div>
      <div class="range-inputs">
        <input type="number" class="range-from" data-i="${i}" min="1" max="${totalPages}" value="${r.from}" />
        <span>to</span>
        <input type="number" class="range-to" data-i="${i}" min="1" max="${totalPages}" value="${r.to}" />
      </div>
    `;
    rangesList.appendChild(row);
  });

  // bind inputs
  rangesList.querySelectorAll(".range-from").forEach((inp) => {
    inp.addEventListener("change", () => {
      const i = Number(inp.dataset.i);
      let v = parseInt(inp.value) || 1;
      v = Math.max(1, Math.min(v, totalPages));
      ranges[i].from = v;
      if (ranges[i].to < v) ranges[i].to = v;
      updateUI();
    });
  });
  rangesList.querySelectorAll(".range-to").forEach((inp) => {
    inp.addEventListener("change", () => {
      const i = Number(inp.dataset.i);
      let v = parseInt(inp.value) || totalPages;
      v = Math.max(1, Math.min(v, totalPages));
      ranges[i].to = v;
      if (ranges[i].from > v) ranges[i].from = v;
      updateUI();
    });
  });
  rangesList.querySelectorAll(".range-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      ranges.splice(Number(btn.dataset.i), 1);
      updateUI();
    });
  });
}

function renderRangeCards() {
  rangesGrid.innerHTML = "";
  ranges.forEach((r, i) => {
    const fromThumb = pageThumbs[r.from - 1] || null;
    const toThumb = pageThumbs[r.to - 1] || null;
    const card = document.createElement("div");
    card.className = "range-card";
    card.innerHTML = `
      <div class="range-card-title">Range ${i + 1}</div>
      <div class="range-card-pages">
        <div class="range-thumb">
          ${fromThumb ? `<img src="${fromThumb}" />` : `<span class="loading">...</span>`}
          <span class="page-num">${r.from}</span>
        </div>
        ${r.from !== r.to ? `
          <span class="range-dots">···</span>
          <div class="range-thumb">
            ${toThumb ? `<img src="${toThumb}" />` : `<span class="loading">...</span>`}
            <span class="page-num">${r.to}</span>
          </div>
        ` : ""}
      </div>
    `;
    rangesGrid.appendChild(card);
  });
}

async function loadPdf(file) {
  selectedFile = file;
  pageThumbs = [];
  totalPages = 0;
  ranges = [];
  showStatus("Loading PDF...");
  updateUI();

  try {
    if (!window.pdfjsLib) throw new Error("pdf.js not loaded");
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    totalPages = pdf.numPages;
    pageThumbs = new Array(totalPages).fill(null);

    // default: one range covering all pages
    ranges = [{ from: 1, to: totalPages }];
    updateUI();
    showStatus("");

    // progressive thumbnails
    for (let i = 1; i <= totalPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 0.35 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      pageThumbs[i - 1] = canvas.toDataURL();
      renderRangeCards();
    }
  } catch (err) {
    console.error(err);
    showStatus("Failed to load PDF.", "error");
    selectedFile = null;
    updateUI();
  }
}

addRangeBtn.addEventListener("click", () => {
  // smart default: start after last range
  const lastTo = ranges.length ? ranges[ranges.length - 1].to : 0;
  const from = Math.min(lastTo + 1, totalPages);
  const to = totalPages;
  if (from > totalPages) {
    showStatus("All pages already covered.", "error");
    return;
  }
  ranges.push({ from, to });
  updateUI();
});

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

splitBtn.addEventListener("click", async () => {
  if (!selectedFile || ranges.length === 0) return;

  // validate ranges
  for (const r of ranges) {
    if (r.from < 1 || r.to > totalPages || r.from > r.to) {
      showStatus("Invalid page range.", "error");
      return;
    }
  }

  splitBtn.disabled = true;
  showStatus("");
  PDFDeskOverlay.show("Splitting PDF");

  try {
    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("ranges", JSON.stringify(ranges));
    formData.append("merge", mergeRangesCheck.checked ? "1" : "0");

    const res = await PDFDeskOverlay.upload(`${API_BASE}/api/split`, formData);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Split failed");
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;

    const ct = res.headers.get("Content-Type") || "";
    a.download = ct.includes("zip")
      ? "pdfdesk-split.zip"
      : "pdfdesk-split.pdf";

    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    showStatus("Done! Download started.", "success");
  } catch (err) {
    console.error(err);
    showStatus(err.message || "Something went wrong.", "error");
  } finally {
    splitBtn.disabled = false;
    PDFDeskOverlay.hide(500);
  }
});