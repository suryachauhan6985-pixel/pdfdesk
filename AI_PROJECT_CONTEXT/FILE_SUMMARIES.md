# File Summaries

Deep analysis of every important source file.

## `frontend/js/js_compress.js`

- **Purpose:** Defines 6 function(s) implementing supporting logic.
- **Lines of code:** 201
- **Complexity:** Medium (heuristic score: 31)
- **Imports:** None
- **Exports:** None
- **Functions:** showStatus(msg, type = ""), formatBytes(bytes), resetResult(), updateUI(), selectFile(file), getTargetBytes()
- **Classes:** None
- **API endpoints:** None
- **Database usage:** Raw SQL detected (1 statement keyword: SELECT)
- **Environment variables used:** None
- **Potential improvements:**
  - Raw SQL strings detected — verify parameterized queries are used to prevent SQL injection.

---

## `frontend/js/js_rotate.js`

- **Purpose:** Defines 5 function(s) implementing supporting logic.
- **Lines of code:** 184
- **Complexity:** Medium (heuristic score: 21)
- **Imports:** None
- **Exports:** None
- **Functions:** showStatus(msg, type = ""), normalize(angle), updateUI(), renderGrid(), loadPdf(file)
- **Classes:** None
- **API endpoints:** None
- **Database usage:** None
- **Environment variables used:** None

---

## `frontend/js/main.js`

- **Purpose:** Supporting source file.
- **Lines of code:** 31
- **Complexity:** Low (heuristic score: 2)
- **Imports:** None
- **Exports:** None
- **Functions:** None
- **Classes:** None
- **API endpoints:** None
- **Database usage:** None
- **Environment variables used:** None
- **Potential improvements:**
  - No functions or classes detected — file may be mostly configuration or could benefit from clearer structure.

---

## `frontend/js/merge.js`

- **Purpose:** Defines 6 function(s) implementing supporting logic.
- **Lines of code:** 205
- **Complexity:** Medium (heuristic score: 24)
- **Imports:** None
- **Exports:** None
- **Functions:** showStatus(msg, type = ""), updateUI(), renderPdfThumb(file), renderThumbs(), addFiles(fileListRaw), generateThumbs()
- **Classes:** None
- **API endpoints:** None
- **Database usage:** Raw SQL detected (2 statement keywords: SELECT)
- **Environment variables used:** None
- **Potential improvements:**
  - Raw SQL strings detected — verify parameterized queries are used to prevent SQL injection.

---

## `frontend/js/overlay.js`

- **Purpose:** Defines 6 function(s) implementing supporting logic.
- **Lines of code:** 157
- **Complexity:** Medium (heuristic score: 21)
- **Imports:** None
- **Exports:** None
- **Functions:** ensureBuilt(), show(title), setProgress(percent, sub), hide(delayMs), upload(url, formData), startSimulated()
- **Classes:** None
- **API endpoints:** None
- **Database usage:** None
- **Environment variables used:** None

---

## `frontend/js/split.js`

- **Purpose:** Defines 5 function(s) implementing supporting logic.
- **Lines of code:** 243
- **Complexity:** Medium (heuristic score: 25)
- **Imports:** None
- **Exports:** None
- **Functions:** showStatus(msg, type = ""), updateUI(), renderRangeInputs(), renderRangeCards(), loadPdf(file)
- **Classes:** None
- **API endpoints:** None
- **Database usage:** None
- **Environment variables used:** None

---

## `backend/Dockerfile`

- **Purpose:** Supporting source file.
- **Lines of code:** 21
- **Complexity:** Low (heuristic score: 0)
- **Imports:** None
- **Exports:** None
- **Functions:** None
- **Classes:** None
- **API endpoints:** None
- **Database usage:** Raw SQL detected (1 statement keyword: UPDATE)
- **Environment variables used:** None
- **Potential improvements:**
  - Raw SQL strings detected — verify parameterized queries are used to prevent SQL injection.
  - No functions or classes detected — file may be mostly configuration or could benefit from clearer structure.

---

## `backend/package.json`

- **Purpose:** Supporting source file.
- **Lines of code:** 18
- **Complexity:** Low (heuristic score: 0)
- **Imports:** None
- **Exports:** None
- **Functions:** None
- **Classes:** None
- **API endpoints:** None
- **Database usage:** None
- **Environment variables used:** None

---

## `backend/server.js`

- **Purpose:** Defines HTTP route handlers (controller/router layer).
- **Lines of code:** 31
- **Complexity:** Low (heuristic score: 0)
- **Imports:** express, cors, ./routes/merge, ./routes/split, ./routes/routes_rotate, ./routes/routes_compress
- **Exports:** None
- **Functions:** None
- **Classes:** None
- **API endpoints:** GET /, USE /api/merge, USE /api/split, USE /api/rotate, USE /api/compress
- **Database usage:** None
- **Environment variables used:** PORT
- **Potential improvements:**
  - process.env is used directly — confirm environment variables are validated/typed at startup.
  - No functions or classes detected — file may be mostly configuration or could benefit from clearer structure.

---

## `backend/routes/merge.js`

- **Purpose:** Defines HTTP route handlers (controller/router layer).
- **Lines of code:** 72
- **Complexity:** Low (heuristic score: 5)
- **Imports:** express, multer, pdf-lib
- **Exports:** module.exports
- **Functions:** None
- **Classes:** None
- **API endpoints:** POST /
- **Database usage:** None
- **Environment variables used:** None
- **Potential improvements:**
  - No functions or classes detected — file may be mostly configuration or could benefit from clearer structure.

---

## `backend/routes/routes_compress.js`

- **Purpose:** Defines HTTP route handlers (controller/router layer).
- **Lines of code:** 218
- **Complexity:** Medium (heuristic score: 21)
- **Imports:** express, multer, child_process, fs/promises, os, path, crypto
- **Exports:** module.exports
- **Functions:** runGhostscript(inputPath, outputPath, combo), tmpPath(ext), compressOnce(inputPath, combo)
- **Classes:** None
- **API endpoints:** POST /
- **Database usage:** Raw SQL detected (1 statement keyword: JOIN)
- **Environment variables used:** GS_BIN
- **Potential improvements:**
  - Raw SQL strings detected — verify parameterized queries are used to prevent SQL injection.
  - process.env is used directly — confirm environment variables are validated/typed at startup.

---

## `backend/routes/routes_rotate.js`

- **Purpose:** Defines HTTP route handlers (controller/router layer).
- **Lines of code:** 63
- **Complexity:** Low (heuristic score: 4)
- **Imports:** express, multer, pdf-lib
- **Exports:** module.exports
- **Functions:** None
- **Classes:** None
- **API endpoints:** POST /
- **Database usage:** None
- **Environment variables used:** None
- **Potential improvements:**
  - No functions or classes detected — file may be mostly configuration or could benefit from clearer structure.

---

## `backend/routes/split.js`

- **Purpose:** Defines HTTP route handlers (controller/router layer).
- **Lines of code:** 108
- **Complexity:** Low (heuristic score: 14)
- **Imports:** express, multer, pdf-lib, jszip
- **Exports:** module.exports
- **Functions:** None
- **Classes:** None
- **API endpoints:** POST /
- **Database usage:** None
- **Environment variables used:** None
- **Potential improvements:**
  - No functions or classes detected — file may be mostly configuration or could benefit from clearer structure.

---

