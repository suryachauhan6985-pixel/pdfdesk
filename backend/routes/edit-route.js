const express = require("express");
const multer = require("multer");
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files are allowed"), false);
  }
});

function hexToRgb(hex) {
  const clean = String(hex || "#000000").replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16) / 255;
  const g = parseInt(clean.substring(2, 4), 16) / 255;
  const b = parseInt(clean.substring(4, 6), 16) / 255;
  return rgb(
    Number.isFinite(r) ? r : 0,
    Number.isFinite(g) ? g : 0,
    Number.isFinite(b) ? b : 0
  );
}

function dataUrlToBytes(dataUrl) {
  const match = /^data:(.+);base64,(.*)$/.exec(dataUrl || "");
  if (!match) return null;
  return { mime: match[1], bytes: Buffer.from(match[2], "base64") };
}

/**
 * POST /api/edit
 * file: PDF
 * elements: JSON array — [{ id, page (0-indexed), type: 'text'|'image'|'shape',
 *   x, y, width, height, fontSize, color, text, dataUrl, lineWidth }]
 *   Coordinates are in PDF point space (top-left origin, y-down),
 *   matching a pdf.js viewport rendered at scale 1.
 * draws: JSON object — { [pageIndex]: [{ color, lineWidth, points: [[x,y], ...] }] }
 */
router.post("/", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No PDF file uploaded." });
    }

    let elements = [];
    let draws = {};
    try {
      elements = JSON.parse(req.body.elements || "[]");
      draws = JSON.parse(req.body.draws || "{}");
    } catch {
      return res.status(400).json({ error: "Invalid edit data." });
    }

    const pdfDoc = await PDFDocument.load(req.file.buffer, {
      ignoreEncryption: true
    });
    const pages = pdfDoc.getPages();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const imageCache = new Map();
    async function embedImage(dataUrl) {
      if (imageCache.has(dataUrl)) return imageCache.get(dataUrl);
      const parsed = dataUrlToBytes(dataUrl);
      if (!parsed) return null;
      let img;
      if (parsed.mime.includes("png")) {
        img = await pdfDoc.embedPng(parsed.bytes);
      } else {
        img = await pdfDoc.embedJpg(parsed.bytes);
      }
      imageCache.set(dataUrl, img);
      return img;
    }

    // ---- Draw freehand strokes ----
    for (const pageIndexStr of Object.keys(draws)) {
      const pageIndex = Number(pageIndexStr);
      const page = pages[pageIndex];
      if (!page) continue;
      const { height: pageHeight } = page.getSize();

      for (const path of draws[pageIndexStr] || []) {
        const color = hexToRgb(path.color);
        const thickness = Math.max(0.5, Number(path.lineWidth) || 2);
        const pts = path.points || [];
        for (let i = 1; i < pts.length; i++) {
          const [x1, y1] = pts[i - 1];
          const [x2, y2] = pts[i];
          page.drawLine({
            start: { x: x1, y: pageHeight - y1 },
            end: { x: x2, y: pageHeight - y2 },
            thickness,
            color,
            opacity: 1
          });
        }
      }
    }

    // ---- Draw placed elements (text / image / shape) ----
    for (const el of elements) {
      const page = pages[el.page];
      if (!page) continue;
      const { height: pageHeight } = page.getSize();

      if (el.type === "text") {
        const fontSize = Number(el.fontSize) || 18;
        const color = hexToRgb(el.color);
        const lines = String(el.text || "").split("\n");
        const lineHeight = fontSize * 1.25;
        lines.forEach((line, i) => {
          const baselineY =
            pageHeight - el.y - fontSize * 0.85 - i * lineHeight;
          page.drawText(line, {
            x: el.x,
            y: baselineY,
            size: fontSize,
            font,
            color
          });
        });
      } else if (el.type === "image") {
        const img = await embedImage(el.dataUrl);
        if (!img) continue;
        const width = Number(el.width) || img.width;
        const height = Number(el.height) || img.height;
        page.drawImage(img, {
          x: el.x,
          y: pageHeight - el.y - height,
          width,
          height
        });
      } else if (el.type === "shape") {
        const width = Number(el.width) || 10;
        const height = Number(el.height) || 10;
        const color = hexToRgb(el.color);
        const borderWidth = Math.max(0.5, Number(el.lineWidth) || 2);
        page.drawRectangle({
          x: el.x,
          y: pageHeight - el.y - height,
          width,
          height,
          borderColor: color,
          borderWidth
        });
      }
    }

    const bytes = await pdfDoc.save();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="pdfdesk-edited.pdf"'
    );
    res.send(Buffer.from(bytes));
  } catch (err) {
    console.error("Edit error:", err);
    res.status(500).json({
      error: "Failed to edit PDF. " + (err.message || "")
    });
  }
});

module.exports = router;