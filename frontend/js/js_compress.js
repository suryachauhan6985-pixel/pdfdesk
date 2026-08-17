// Compress PDF — choose level (or custom target size), upload, show size comparison

const API_BASE = "https://pdfdesk.onrender.com";

const dropzone = document.getElementById("dropzone");
const compressPreview = document.getElementById("compressPreview");
const fileCard = document.getElementById("fileCard");
const fileName = document.getElementById("fileName");
const fileSize = document.getElementById("fileSize");
const resultCard = document.getElementById("resultCard");
const savingsText = document.getElementById("savingsText");
const barFill = document.getElementById("barFill");
const origSizeText = document.getElementById("origSizeText");
const newSizeText = document.getElementById("newSizeText");
const targetRow = document.getElementById("targetRow");
const targetSizeText = document.getElementById("targetSizeText");
const compressControls = document.getElementById("compressControls");
const fileInput = document.getElementById("fileInput");
const selectBtn = document.getElementById("selectBtn");
const compressBtn = document.getElementById("compressBtn");
const statusEl = document.getElementById("status");
const customSizeGroup = document.getElementById("customSizeGroup");
const customSizeInput = document.getElementById("customSizeInput");
const customSizeUnit = document.getElementById("customSizeUnit");

let selectedFile = null;
let resultBlob = null;

function showStatus(msg, type = "") {
  statusEl.textContent = msg;
  statusEl.className = "side-status" + (type ? ` ${type}` : "");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function resetResult() {
  resultCard.hidden = true;
  targetRow.hidden = true;
  resultBlob = null;
  compressBtn.textContent = "Compress PDF →";
}

function updateUI() {
  const hasFile = !!selectedFile;
  dropzone.hidden = hasFile;
  compressPreview.hidden = !hasFile;
  compressControls.hidden = !hasFile;
  compressBtn.disabled = !hasFile;

  if (hasFile) {
    fileName.textContent = selectedFile.name;
    fileSize.textContent = formatBytes(selectedFile.size);
  }
}

function selectFile(file) {
  if (!file || file.type !== "application/pdf") {
    showStatus("Please select a valid PDF file.", "error");
    return;
  }
  selectedFile = file;
  resetResult();
  showStatus("");
  updateUI();
}

selectBtn.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => {
  if (e.target.files[0]) selectFile(e.target.files[0]);
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
  if (f) selectFile(f);
});

// Show/hide the custom size input based on which radio is selected
document.querySelectorAll('input[name="level"]').forEach((radio) => {
  radio.addEventListener("change", () => {
    customSizeGroup.hidden = radio.value !== "custom" || !radio.checked;
  });
});

function getTargetBytes() {
  const value = parseFloat(customSizeInput.value);
  if (!value || value <= 0) return null;
  const unit = customSizeUnit.value;
  return unit === "MB" ? Math.round(value * 1024 * 1024) : Math.round(value * 1024);
}

compressBtn.addEventListener("click", async () => {
  if (!selectedFile) return;

  // If we already have a compressed result ready, this click downloads it
  if (resultBlob) {
    const url = URL.createObjectURL(resultBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pdfdesk-compressed.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return;
  }

  const level = document.querySelector('input[name="level"]:checked')?.value || "medium";
  let targetBytes = null;

  if (level === "custom") {
    targetBytes = getTargetBytes();
    if (!targetBytes) {
      showStatus("Enter a valid target size.", "error");
      return;
    }
    if (targetBytes >= selectedFile.size) {
      showStatus("Target size must be smaller than the original file.", "error");
      return;
    }
  }

  compressBtn.disabled = true;
  showStatus("");
  PDFDeskOverlay.show("Compressing PDF");

  try {
    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("level", level);
    if (level === "custom") {
      formData.append("targetSize", String(targetBytes));
    }

    const res = await PDFDeskOverlay.upload(`${API_BASE}/api/compress`, formData);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Compression failed");
    }

    const originalSize = Number(res.headers.get("X-Original-Size")) || selectedFile.size;
    const compressedSize = Number(res.headers.get("X-Compressed-Size")) || 0;
    const achievedTarget = res.headers.get("X-Achieved-Target");

    resultBlob = await res.blob();

    const savedPct = originalSize > 0
      ? Math.max(0, Math.round(100 - (compressedSize / originalSize) * 100))
      : 0;

    origSizeText.textContent = formatBytes(originalSize);
    newSizeText.textContent = formatBytes(compressedSize || resultBlob.size);
    savingsText.innerHTML = `${savedPct}% <span>smaller</span>`;
    barFill.style.width = `${100 - savedPct}%`;

    if (level === "custom" && targetBytes) {
      targetRow.hidden = false;
      targetSizeText.textContent = formatBytes(targetBytes);
    }

    resultCard.hidden = false;
    compressBtn.textContent = "Download Compressed PDF →";

    if (level === "custom" && achievedTarget === "false") {
      showStatus(
        "Couldn't shrink all the way to your target — this is the smallest we could get without ruining quality.",
        "error"
      );
    } else if (savedPct <= 0) {
      showStatus(
        "This PDF was already well-optimized — only minimal savings were possible.",
        "error"
      );
    } else {
      showStatus("Done!", "success");
    }
  } catch (err) {
    console.error(err);
    showStatus(err.message || "Something went wrong.", "error");
  } finally {
    compressBtn.disabled = false;
    PDFDeskOverlay.hide();
  }
});