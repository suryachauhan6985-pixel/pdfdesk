// Edit PDF — add text, images, shapes and freehand drawing, then bake into the PDF

const API_BASE = "https://pdfdesk.onrender.com";

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

const TARGET_WIDTH = 720; // display width (px) pages are scaled to fit

// ---------- DOM ----------
const dropzone = document.getElementById("dropzone");
const editEmptyWrap = document.getElementById("editEmptyWrap");
const editorWrap = document.getElementById("editorWrap");
const fileInput = document.getElementById("fileInput");
const imageInput = document.getElementById("imageInput");
const selectBtn = document.getElementById("selectBtn");
const thumbRail = document.getElementById("thumbRail");
const stageWrap = document.querySelector(".edit-stage-wrap");
const stage = document.getElementById("stage");
const pageCanvas = document.getElementById("pageCanvas");
const statusEl = document.getElementById("status");
const saveBtn = document.getElementById("saveBtn");
const deleteSelectedBtn = document.getElementById("deleteSelectedBtn");

const textOptions = document.getElementById("textOptions");
const drawOptions = document.getElementById("drawOptions");
const shapeOptions = document.getElementById("shapeOptions");
const textColorInput = document.getElementById("textColor");
const textSizeInput = document.getElementById("textSize");
const drawColorInput = document.getElementById("drawColor");
const drawWidthInput = document.getElementById("drawWidth");
const shapeColorInput = document.getElementById("shapeColor");
const shapeWidthInput = document.getElementById("shapeWidth");

const toolButtons = Array.from(document.querySelectorAll(".edit-tool-btn[data-tool]"));

// ---------- State ----------
let pdfDocJS = null;
let selectedFile = null;
let totalPages = 0;
let pageSizes = [];      // [{width, height}] in PDF points (scale 1), index 0-based
let currentPage = 0;
let displayScale = 1;

let currentTool = "select";
let elements = [];       // {id, page, type, x, y, width, height, fontSize, color, text, dataUrl, lineWidth}
let draws = {};          // pageIndex -> [{color, lineWidth, points:[[x,y],...]}]
let selectedElId = null;
let nextId = 1;

let pendingImageDataUrl = null;
let pendingImageAspect = 1;

let drawingPath = null;  // active freehand stroke in progress

// ---------- Helpers ----------
function showStatus(msg, type = "") {
  statusEl.textContent = msg;
  statusEl.className = "side-status" + (type ? ` ${type}` : "");
}

function uid() {
  return "el" + nextId++;
}

function toDisplay(pt) {
  return pt * displayScale;
}
function toPoint(px) {
  return px / displayScale;
}

function setTool(tool) {
  currentTool = tool;
  toolButtons.forEach((b) => b.classList.toggle("active", b.dataset.tool === tool));
  stage.className = "edit-stage tool-" + tool;
  textOptions.hidden = tool !== "text";
  drawOptions.hidden = tool !== "draw";
  shapeOptions.hidden = tool !== "shape";
  if (tool !== "select") deselectAll();
}

// ---------- Load PDF ----------
async function loadPdf(file) {
  selectedFile = file;
  showStatus("Loading PDF...");
  editEmptyWrap.hidden = true;
  editorWrap.hidden = false;

  try {
    if (!window.pdfjsLib) throw new Error("pdf.js not loaded");
    const buf = await file.arrayBuffer();
    pdfDocJS = await pdfjsLib.getDocument({ data: buf }).promise;
    totalPages = pdfDocJS.numPages;
    pageSizes = new Array(totalPages).fill(null);
    elements = [];
    draws = {};
    currentPage = 0;
    selectedElId = null;

    await renderThumbRail();
    await renderPage(0);
    saveBtn.disabled = false;
    showStatus("");
  } catch (err) {
    console.error(err);
    showStatus("Failed to load PDF.", "error");
    editEmptyWrap.hidden = false;
    editorWrap.hidden = true;
    selectedFile = null;
  }
}

async function renderThumbRail() {
  thumbRail.innerHTML = "";
  const thumbs = [];
  for (let i = 0; i < totalPages; i++) {
    const div = document.createElement("div");
    div.className = "edit-thumb" + (i === 0 ? " active" : "");
    div.dataset.i = i;
    div.innerHTML = `<span class="edit-thumb-num">${i + 1}</span>`;
    div.addEventListener("click", () => switchPage(i));
    thumbRail.appendChild(div);
    thumbs.push(div);
  }

  for (let i = 0; i < totalPages; i++) {
    const page = await pdfDocJS.getPage(i + 1);
    const baseViewport = page.getViewport({ scale: 1 });
    pageSizes[i] = { width: baseViewport.width, height: baseViewport.height };

    const scale = 96 / baseViewport.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;

    const img = document.createElement("img");
    img.src = canvas.toDataURL();
    thumbs[i].prepend(img);
  }
}

async function switchPage(index, opts = {}) {
  if (index < 0 || index >= totalPages) return;
  if (index === currentPage) return;
  commitActiveTextEdit();
  currentPage = index;
  thumbRail.querySelectorAll(".edit-thumb").forEach((t) => {
    const isActive = Number(t.dataset.i) === index;
    // Only one thumbnail is ever marked active/focused — the one for the
    // page currently on the stage.
    t.classList.toggle("active", isActive);
    if (isActive) t.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
  deselectAll();
  await renderPage(index);
  if (!opts.keepScroll) stageWrap.scrollTop = 0;
}

async function renderPage(index) {
  const page = await pdfDocJS.getPage(index + 1);
  const size = pageSizes[index] || page.getViewport({ scale: 1 });
  pageSizes[index] = { width: size.width, height: size.height };

  displayScale = TARGET_WIDTH / size.width;
  const viewport = page.getViewport({ scale: displayScale });

  pageCanvas.width = viewport.width;
  pageCanvas.height = viewport.height;
  stage.style.width = viewport.width + "px";
  stage.style.height = viewport.height + "px";

  const ctx = pageCanvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;

  // Redraw any freehand strokes already on this page
  const pageDraws = draws[index] || [];
  pageDraws.forEach((path) => strokePath(ctx, path));

  renderOverlayElements();
}

// ---------- Scroll to change page ----------
// When the current page is fully in view (nothing left to scroll) and the
// user keeps scrolling down, move to the next page — and the reverse at
// the top. This lets people flip pages by scrolling instead of only by
// clicking a thumbnail.
let wheelNavLock = false;
stageWrap.addEventListener(
  "wheel",
  (e) => {
    if (!pdfDocJS || wheelNavLock || Math.abs(e.deltaY) < 2) return;

    const atTop = stageWrap.scrollTop <= 1;
    const atBottom =
      stageWrap.scrollTop + stageWrap.clientHeight >= stageWrap.scrollHeight - 1;

    if (e.deltaY < 0 && atTop && currentPage > 0) {
      e.preventDefault();
      wheelNavLock = true;
      switchPage(currentPage - 1, { keepScroll: true }).then(() => {
        requestAnimationFrame(() => {
          stageWrap.scrollTop = stageWrap.scrollHeight;
        });
      });
      setTimeout(() => (wheelNavLock = false), 500);
    } else if (e.deltaY > 0 && atBottom && currentPage < totalPages - 1) {
      e.preventDefault();
      wheelNavLock = true;
      switchPage(currentPage + 1);
      setTimeout(() => (wheelNavLock = false), 500);
    }
  },
  { passive: false }
);

function strokePath(ctx, path) {
  if (!path.points.length) return;
  ctx.save();
  ctx.strokeStyle = path.color;
  ctx.lineWidth = path.lineWidth * displayScale;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  path.points.forEach(([x, y], i) => {
    const dx = toDisplay(x);
    const dy = toDisplay(y);
    if (i === 0) ctx.moveTo(dx, dy);
    else ctx.lineTo(dx, dy);
  });
  ctx.stroke();
  ctx.restore();
}

// ---------- Overlay elements (text / image / shape) ----------
function renderOverlayElements() {
  stage.querySelectorAll(".edit-el").forEach((n) => n.remove());
  elements
    .filter((el) => el.page === currentPage)
    .forEach((el) => stage.appendChild(buildElementDom(el)));
}

function buildElementDom(el) {
  const div = document.createElement("div");
  div.className = "edit-el edit-el-" + el.type + (el.id === selectedElId ? " selected" : "");
  div.dataset.id = el.id;
  div.style.left = toDisplay(el.x) + "px";
  div.style.top = toDisplay(el.y) + "px";

  if (el.type === "text") {
    div.classList.add("edit-el-text");
    div.style.width = toDisplay(el.width) + "px";
    div.style.fontSize = toDisplay(el.fontSize) + "px";
    div.style.color = el.color;
    div.textContent = el.text;
    div.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      startTextEdit(div, el);
    });
  } else if (el.type === "image") {
    div.style.width = toDisplay(el.width) + "px";
    div.style.height = toDisplay(el.height) + "px";
    const img = document.createElement("img");
    img.src = el.dataUrl;
    div.appendChild(img);
  } else if (el.type === "shape") {
    div.style.width = toDisplay(el.width) + "px";
    div.style.height = toDisplay(el.height) + "px";
    div.style.border = `${Math.max(1, toDisplay(el.lineWidth))}px solid ${el.color}`;
  }

  const removeBtn = document.createElement("button");
  removeBtn.className = "edit-el-remove";
  removeBtn.type = "button";
  removeBtn.textContent = "×";
  removeBtn.addEventListener("mousedown", (e) => e.stopPropagation());
  removeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    removeElement(el.id);
  });
  div.appendChild(removeBtn);

  const handle = document.createElement("div");
  handle.className = "edit-el-resize";
  handle.addEventListener("mousedown", (e) => startResize(e, el, div));
  div.appendChild(handle);

  div.addEventListener("mousedown", (e) => startDrag(e, el, div));

  return div;
}

function selectElement(id) {
  selectedElId = id;
  stage.querySelectorAll(".edit-el").forEach((n) => {
    n.classList.toggle("selected", n.dataset.id === id);
  });
}

function deselectAll() {
  selectedElId = null;
  stage.querySelectorAll(".edit-el").forEach((n) => n.classList.remove("selected"));
}

function removeElement(id) {
  elements = elements.filter((el) => el.id !== id);
  if (selectedElId === id) selectedElId = null;
  renderOverlayElements();
}

function startTextEdit(div, el) {
  div.contentEditable = "true";
  div.classList.add("editing");
  div.focus();
  const range = document.createRange();
  range.selectNodeContents(div);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  const commit = () => {
    div.contentEditable = "false";
    div.classList.remove("editing");
    el.text = div.textContent || "";
    div.removeEventListener("blur", commit);
  };
  div.addEventListener("blur", commit);
}

function commitActiveTextEdit() {
  const editing = stage.querySelector(".edit-el-text.editing");
  if (editing) editing.blur();
}

// ---------- Drag ----------
function startDrag(e, el, div) {
  if (currentTool !== "select") return;
  if (div.classList.contains("editing")) return;
  e.stopPropagation();
  e.preventDefault();
  selectElement(el.id);

  const startX = e.clientX;
  const startY = e.clientY;
  const origX = el.x;
  const origY = el.y;
  let moved = false;

  function onMove(ev) {
    moved = true;
    const dx = toPoint(ev.clientX - startX);
    const dy = toPoint(ev.clientY - startY);
    el.x = origX + dx;
    el.y = origY + dy;
    div.style.left = toDisplay(el.x) + "px";
    div.style.top = toDisplay(el.y) + "px";
  }
  function onUp() {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  }
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

function startResize(e, el, div) {
  e.stopPropagation();
  e.preventDefault();
  selectElement(el.id);

  const startX = e.clientX;
  const startY = e.clientY;
  const origWidth = el.width;
  const origHeight = el.height || el.fontSize * 1.3;
  const origFontSize = el.fontSize;

  function onMove(ev) {
    const dw = toPoint(ev.clientX - startX);
    el.width = Math.max(20, origWidth + dw);
    div.style.width = toDisplay(el.width) + "px";

    if (el.type === "image" || el.type === "shape") {
      const dh = toPoint(ev.clientY - startY);
      el.height = Math.max(20, origHeight + dh);
      div.style.height = toDisplay(el.height) + "px";
    }
    if (el.type === "text") {
      // width only — text wraps within the box
    }
  }
  function onUp() {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  }
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

// ---------- Stage click / draw / shape placement ----------
function stagePointFromEvent(e) {
  const rect = stage.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  return { x: toPoint(px), y: toPoint(py) };
}

stage.addEventListener("mousedown", (e) => {
  if (e.target !== stage && e.target !== pageCanvas) return; // clicked on an element, handled elsewhere

  if (currentTool === "select") {
    deselectAll();
    return;
  }

  if (currentTool === "text") {
    const { x, y } = stagePointFromEvent(e);
    const fontSize = Number(textSizeInput.value);
    const el = {
      id: uid(),
      page: currentPage,
      type: "text",
      x, y,
      width: 220,
      fontSize,
      color: textColorInput.value,
      text: "Text"
    };
    elements.push(el);
    renderOverlayElements();
    selectElement(el.id);
    const div = stage.querySelector(`.edit-el[data-id="${el.id}"]`);
    if (div) startTextEdit(div, el);
    return;
  }

  if (currentTool === "image") {
    if (!pendingImageDataUrl) {
      showStatus("Choose an image first.", "error");
      return;
    }
    const { x, y } = stagePointFromEvent(e);
    const width = 160;
    const height = width / pendingImageAspect;
    const el = {
      id: uid(),
      page: currentPage,
      type: "image",
      x, y,
      width, height,
      dataUrl: pendingImageDataUrl
    };
    elements.push(el);
    renderOverlayElements();
    selectElement(el.id);
    setTool("select");
    return;
  }

  if (currentTool === "shape") {
    const start = stagePointFromEvent(e);
    const el = {
      id: uid(),
      page: currentPage,
      type: "shape",
      x: start.x, y: start.y,
      width: 1, height: 1,
      color: shapeColorInput.value,
      lineWidth: Number(shapeWidthInput.value)
    };
    elements.push(el);
    renderOverlayElements();
    const div = stage.querySelector(`.edit-el[data-id="${el.id}"]`);

    function onMove(ev) {
      const pt = stagePointFromEvent(ev);
      el.x = Math.min(start.x, pt.x);
      el.y = Math.min(start.y, pt.y);
      el.width = Math.max(10, Math.abs(pt.x - start.x));
      el.height = Math.max(10, Math.abs(pt.y - start.y));
      if (div) {
        div.style.left = toDisplay(el.x) + "px";
        div.style.top = toDisplay(el.y) + "px";
        div.style.width = toDisplay(el.width) + "px";
        div.style.height = toDisplay(el.height) + "px";
      }
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (el.width < 12 && el.height < 12) {
        el.width = 120;
        el.height = 80;
        renderOverlayElements();
      }
      selectElement(el.id);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return;
  }

  if (currentTool === "draw") {
    const { x, y } = stagePointFromEvent(e);
    drawingPath = {
      color: drawColorInput.value,
      lineWidth: Number(drawWidthInput.value),
      points: [[x, y]]
    };
    const ctx = pageCanvas.getContext("2d");

    function onMove(ev) {
      const pt = stagePointFromEvent(ev);
      drawingPath.points.push([pt.x, pt.y]);
      strokePath(ctx, {
        color: drawingPath.color,
        lineWidth: drawingPath.lineWidth,
        points: drawingPath.points.slice(-2)
      });
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (drawingPath.points.length > 1) {
        if (!draws[currentPage]) draws[currentPage] = [];
        draws[currentPage].push(drawingPath);
      }
      drawingPath = null;
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }
});

// ---------- Toolbar ----------
toolButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const tool = btn.dataset.tool;
    if (tool === "image") {
      pendingImageDataUrl = null;
      imageInput.click();
      return; // tool switches once an image is chosen
    }
    setTool(tool);
  });
});

imageInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  imageInput.value = "";
  if (!file) return; // cancelled — stay on current tool
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      pendingImageAspect = img.width / img.height || 1;
      pendingImageDataUrl = reader.result;
      setTool("image");
      showStatus("Click on the page to place the image.");
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

deleteSelectedBtn.addEventListener("click", () => {
  if (selectedElId) removeElement(selectedElId);
});

document.addEventListener("keydown", (e) => {
  if ((e.key === "Delete" || e.key === "Backspace") && selectedElId) {
    const active = document.activeElement;
    if (active && active.classList && active.classList.contains("editing")) return;
    removeElement(selectedElId);
  }
});

// ---------- File loading (dropzone) ----------
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

// ---------- Save ----------
saveBtn.addEventListener("click", async () => {
  if (!selectedFile) return;
  commitActiveTextEdit();

  if (elements.length === 0 && Object.keys(draws).length === 0) {
    showStatus("Add something to the page first.", "error");
    return;
  }

  saveBtn.disabled = true;
  showStatus("");
  PDFDeskOverlay.show("Saving PDF");

  try {
    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("elements", JSON.stringify(elements));
    formData.append("draws", JSON.stringify(draws));

    const res = await PDFDeskOverlay.upload(`${API_BASE}/api/edit`, formData);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Save failed");
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pdfdesk-edited.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    showStatus("Done! Edited PDF downloaded.", "success");
  } catch (err) {
    console.error(err);
    showStatus(err.message || "Something went wrong.", "error");
  } finally {
    saveBtn.disabled = false;
    PDFDeskOverlay.hide(500);
  }
});