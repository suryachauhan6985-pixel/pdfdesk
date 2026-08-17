const express = require("express");
const multer = require("multer");
const {
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFNumber
} = require("pdf-lib");
const jpeg = require("jpeg-js");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files are allowed"), false);
  }
});

// quality passed to the JPEG re-encoder — lower quality = smaller file
const LEVELS = { low: 80, medium: 55, high: 30 };

/**
 * POST /api/compress
 * file: PDF
 * level: "low" | "medium" | "high"  (default "medium")
 *
 * Basic compression: strips metadata and re-encodes embedded JPEG images
 * at a lower quality. Pure JS (jpeg-js), no native binaries — safe for
 * free-tier hosting. PDFs with no JPEG images (e.g. pure text/vector)
 * will shrink only a little (metadata + object stream cleanup).
 */
router.post("/", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No PDF file uploaded." });
    }

    const level = LEVELS[req.body.level] ? req.body.level : "medium";
    const quality = LEVELS[level];
    const srcBytes = req.file.buffer;

    const pdfDoc = await PDFDocument.load(srcBytes, {
      ignoreEncryption: true,
      updateMetadata: false
    });

    pdfDoc.setTitle("");
    pdfDoc.setAuthor("");
    pdfDoc.setSubject("");
    pdfDoc.setKeywords([]);
    pdfDoc.setProducer("PDFDesk");
    pdfDoc.setCreator("PDFDesk");

    const context = pdfDoc.context;
    const indirectObjects = context.enumerateIndirectObjects();

    let imagesProcessed = 0;

    for (const [ref, obj] of indirectObjects) {
      if (!(obj instanceof PDFRawStream)) continue;

      const dict = obj.dict;
      const subtype = dict.get(PDFName.of("Subtype"));
      if (!subtype || subtype.toString() !== "/Image") continue;

      const filter = dict.get(PDFName.of("Filter"));
      if (!filter) continue;

      const filterNames = Array.isArray(filter.asArray?.())
        ? filter.asArray().map((f) => f.toString())
        : [filter.toString()];

      // Only re-encoding JPEG (DCTDecode) images — safest, most common case
      if (!filterNames.includes("/DCTDecode")) continue;

      try {
        const rawBytes = obj.getContents();
        const decoded = jpeg.decode(rawBytes, { useTArray: true });
        const recompressed = jpeg.encode(
          { data: decoded.data, width: decoded.width, height: decoded.height },
          quality
        );

        if (recompressed.data.length < rawBytes.length) {
          const newDict = dict.clone(context);
          newDict.set(PDFName.of("Length"), PDFNumber.of(recompressed.data.length));
          const newStream = PDFRawStream.of(newDict, recompressed.data);
          context.assign(ref, newStream);
          imagesProcessed++;
        }
      } catch (e) {
        // If a particular image can't be decoded (e.g. CMYK/odd encoding),
        // just leave it untouched rather than failing the whole request.
        console.warn("Compress: skipped one image —", e.message);
      }
    }

    const outBytes = await pdfDoc.save({ useObjectStreams: true });

    const originalSize = srcBytes.length;
    const compressedSize = outBytes.length;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="pdfdesk-compressed.pdf"'
    );
    res.setHeader("X-Original-Size", String(originalSize));
    res.setHeader("X-Compressed-Size", String(compressedSize));
    res.setHeader(
      "Access-Control-Expose-Headers",
      "X-Original-Size, X-Compressed-Size"
    );
    res.send(Buffer.from(outBytes));
  } catch (err) {
    console.error("Compress error:", err);
    res.status(500).json({
      error: "Failed to compress PDF. " + (err.message || "")
    });
  }
});

module.exports = router;