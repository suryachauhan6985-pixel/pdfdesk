const express = require("express");
const multer = require("multer");
const { PDFDocument } = require("pdf-lib");
const JSZip = require("jszip");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files allowed"), false);
  }
});

/**
 * POST /api/split
 * file: PDF
 * ranges: JSON string  e.g. [{"from":1,"to":3},{"from":4,"to":10}]
 * merge: "1" | "0"   — if 1, all ranges merged into one PDF
 */
router.post("/", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No PDF file uploaded." });
    }

    let ranges = [];
    try {
      ranges = JSON.parse(req.body.ranges || "[]");
    } catch {
      return res.status(400).json({ error: "Invalid ranges data." });
    }

    if (!Array.isArray(ranges) || ranges.length === 0) {
      return res.status(400).json({ error: "At least one range is required." });
    }

    const mergeAll = req.body.merge === "1";
    const srcPdf = await PDFDocument.load(req.file.buffer, { ignoreEncryption: true });
    const total = srcPdf.getPageCount();

    // validate & clamp
    for (const r of ranges) {
      r.from = Math.max(1, Math.min(parseInt(r.from) || 1, total));
      r.to = Math.max(r.from, Math.min(parseInt(r.to) || total, total));
    }

    if (mergeAll) {
      // one PDF containing all selected ranges in order
      const outPdf = await PDFDocument.create();
      for (const r of ranges) {
        const indices = [];
        for (let i = r.from - 1; i < r.to; i++) indices.push(i);
        const pages = await outPdf.copyPages(srcPdf, indices);
        pages.forEach((p) => outPdf.addPage(p));
      }
      const bytes = await outPdf.save();
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", 'attachment; filename="pdfdesk-split-merged.pdf"');
      return res.send(Buffer.from(bytes));
    }

    // each range → separate PDF → zip
    if (ranges.length === 1) {
      const r = ranges[0];
      const outPdf = await PDFDocument.create();
      const indices = [];
      for (let i = r.from - 1; i < r.to; i++) indices.push(i);
      const pages = await outPdf.copyPages(srcPdf, indices);
      pages.forEach((p) => outPdf.addPage(p));
      const bytes = await outPdf.save();
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="pdfdesk-pages-${r.from}-${r.to}.pdf"`
      );
      return res.send(Buffer.from(bytes));
    }

    const zip = new JSZip();
    for (let idx = 0; idx < ranges.length; idx++) {
      const r = ranges[idx];
      const outPdf = await PDFDocument.create();
      const indices = [];
      for (let i = r.from - 1; i < r.to; i++) indices.push(i);
      const pages = await outPdf.copyPages(srcPdf, indices);
      pages.forEach((p) => outPdf.addPage(p));
      const bytes = await outPdf.save();
      zip.file(
        `range-${idx + 1}_pages-${r.from}-${r.to}.pdf`,
        bytes
      );
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="pdfdesk-split.zip"');
    res.send(zipBuffer);
  } catch (err) {
    console.error("Split error:", err);
    res.status(500).json({ error: "Failed to split PDF. " + (err.message || "") });
  }
});

module.exports = router;
