const express = require("express");
const multer = require("multer");
const { PDFDocument, degrees } = require("pdf-lib");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files are allowed"), false);
  }
});

/**
 * POST /api/rotate
 * file: PDF
 * rotations: JSON string, array of absolute angles per page e.g. [90,90,180]
 *            (must be a multiple of 90; length should match page count —
 *             missing entries default to 0, extra entries are ignored)
 */
router.post("/", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No PDF file uploaded." });
    }

    let rotations = [];
    try {
      rotations = JSON.parse(req.body.rotations || "[]");
    } catch {
      return res.status(400).json({ error: "Invalid rotations data." });
    }

    const pdfDoc = await PDFDocument.load(req.file.buffer, {
      ignoreEncryption: true
    });
    const pages = pdfDoc.getPages();

    pages.forEach((page, i) => {
      const raw = Number(rotations[i]) || 0;
      const normalized = ((Math.round(raw / 90) * 90) % 360 + 360) % 360;
      page.setRotation(degrees(normalized));
    });

    const bytes = await pdfDoc.save();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="pdfdesk-rotated.pdf"'
    );
    res.send(Buffer.from(bytes));
  } catch (err) {
    console.error("Rotate error:", err);
    res.status(500).json({
      error: "Failed to rotate PDF. " + (err.message || "")
    });
  }
});

module.exports = router;