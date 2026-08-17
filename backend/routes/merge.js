const express = require("express");
const multer = require("multer");
const { PDFDocument } = require("pdf-lib");

const router = express.Router();

// Keep files in memory (never write to disk)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024, // 25 MB per file
    files: 20
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"), false);
    }
  }
});

/**
 * POST /api/merge
 * Body: multipart/form-data with field "files" (multiple PDFs)
 * Returns: merged PDF as download
 */
router.post("/", upload.array("files"), async (req, res) => {
  try {
    const files = req.files;

    if (!files || files.length < 2) {
      return res.status(400).json({
        error: "At least 2 PDF files are required to merge."
      });
    }

    const mergedPdf = await PDFDocument.create();

    for (const file of files) {
      try {
        const pdf = await PDFDocument.load(file.buffer, {
          ignoreEncryption: true
        });
        const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
        pages.forEach((page) => mergedPdf.addPage(page));
      } catch (err) {
        console.error(`Failed to process ${file.originalname}:`, err.message);
        return res.status(400).json({
          error: `"${file.originalname}" is not a valid PDF or is corrupted.`
        });
      }
    }

    const pdfBytes = await mergedPdf.save();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="pdfdesk-merged.pdf"'
    );
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("Merge error:", err);
    res.status(500).json({
      error: "Failed to merge PDFs. Please try again."
    });
  }
});

module.exports = router;
