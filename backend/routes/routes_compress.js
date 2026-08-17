const express = require("express");
const multer = require("multer");
const { execFile } = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files are allowed"), false);
  }
});

/**
 * Compression ladder, LEAST aggressive (index 0) -> MOST aggressive (last).
 * `dpi` controls image downsampling resolution, `q` is JPEG re-encode
 * quality. Ghostscript decodes every source image format itself (JPEG,
 * CCITT G3/G4 fax, JBIG2, JPEG2000, Indexed/palette, raw bitmaps) so this
 * ladder applies no matter what the original images were encoded as —
 * unlike a hand-rolled JS re-encoder that only understands a few formats.
 */
const COMBOS = [
  { dpi: 300, q: 90 }, // 0
  { dpi: 200, q: 80 }, // 1  -> "low"
  { dpi: 175, q: 70 }, // 2
  { dpi: 150, q: 60 }, // 3
  { dpi: 120, q: 50 }, // 4  -> "medium"
  { dpi: 110, q: 40 }, // 5
  { dpi: 96, q: 35 },  // 6
  { dpi: 85, q: 25 },  // 7  -> "high"
  { dpi: 72, q: 20 }   // 8
];

const LEVEL_INDEX = { low: 1, medium: 4, high: 7 };

const GS_BIN = process.env.GS_BIN || "gs";
const GS_TIMEOUT_MS = 60_000;

/** Run one Ghostscript pass with the given dpi/quality combo. */
function runGhostscript(inputPath, outputPath, combo) {
  const args = [
    "-sDEVICE=pdfwrite",
    "-dCompatibilityLevel=1.4",
    "-dNOPAUSE",
    "-dBATCH",
    "-dQUIET",
    "-dSAFER",

    // Downsample + re-encode every raster image regardless of its
    // original filter (DCT, CCITTFax, JBIG2, JPX, Flate/raw, Indexed...).
    "-dDownsampleColorImages=true",
    "-dColorImageDownsampleType=/Bicubic",
    `-dColorImageResolution=${combo.dpi}`,
    "-dAutoFilterColorImages=false",
    "-dColorImageFilter=/DCTEncode",

    "-dDownsampleGrayImages=true",
    "-dGrayImageDownsampleType=/Bicubic",
    `-dGrayImageResolution=${combo.dpi}`,
    "-dAutoFilterGrayImages=false",
    "-dGrayImageFilter=/DCTEncode",

    // Mono (1-bit scanned fax / CCITT / JBIG2 pages) — re-encode as CCITT
    // G4 at the target resolution instead of leaving them untouched.
    "-dDownsampleMonoImages=true",
    "-dMonoImageDownsampleType=/Bicubic",
    `-dMonoImageResolution=${Math.max(150, combo.dpi)}`,
    "-dMonoImageFilter=/CCITTFaxEncode",

    `-dJPEGQ=${combo.q}`,

    // Shrink text-heavy / vector-only PDFs too, not just image PDFs.
    "-dCompressFonts=true",
    "-dSubsetFonts=true",
    "-dDetectDuplicateImages=true",
    "-dOptimize=true",

    // Strip metadata bloat (matches the old behaviour).
    "-dPreserveMarkedContent=false",

    `-sOutputFile=${outputPath}`,
    inputPath
  ];

  return new Promise((resolve, reject) => {
    execFile(GS_BIN, args, { timeout: GS_TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.toString().slice(0, 500) || err.message));
      } else {
        resolve();
      }
    });
  });
}

async function tmpPath(ext) {
  return path.join(os.tmpdir(), `pdfdesk-${crypto.randomUUID()}${ext}`);
}

async function compressOnce(inputPath, combo) {
  const outputPath = await tmpPath(".pdf");
  await runGhostscript(inputPath, outputPath, combo);
  const buf = await fs.readFile(outputPath);
  fs.unlink(outputPath).catch(() => {});
  return buf;
}

/**
 * POST /api/compress
 * file: PDF
 * level: "low" | "medium" | "high" | "custom"  (default "medium")
 * targetSize: required bytes when level === "custom"
 */
router.post("/", upload.single("file"), async (req, res) => {
  let inputPath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: "No PDF file uploaded." });
    }

    const srcBytes = req.file.buffer;
    const originalSize = srcBytes.length;
    const level = req.body.level && LEVEL_INDEX[req.body.level] !== undefined
      ? req.body.level
      : (req.body.level === "custom" ? "custom" : "medium");

    inputPath = await tmpPath(".pdf");
    await fs.writeFile(inputPath, srcBytes);

    let outBytes;
    let achievedTarget = null;
    let targetSize = null;

    if (level === "custom") {
      targetSize = Number(req.body.targetSize);
      if (!targetSize || targetSize <= 0) {
        return res.status(400).json({ error: "Invalid target size." });
      }
      if (targetSize >= originalSize) {
        return res.status(400).json({
          error: "Target size must be smaller than the original file size."
        });
      }

      let lo = 0;
      let hi = COMBOS.length - 1;
      let bestBytes = null;

      const worstCase = await compressOnce(inputPath, COMBOS[hi]);

      if (worstCase.length > targetSize) {
        outBytes = worstCase;
        achievedTarget = false;
      } else {
        bestBytes = worstCase;

        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const attempt = await compressOnce(inputPath, COMBOS[mid]);

          if (attempt.length <= targetSize) {
            bestBytes = attempt;
            hi = mid - 1; // try to keep more quality
          } else {
            lo = mid + 1; // need more compression
          }
        }

        outBytes = bestBytes;
        achievedTarget = true;
      }
    } else {
      const combo = COMBOS[LEVEL_INDEX[level] ?? LEVEL_INDEX.medium];
      outBytes = await compressOnce(inputPath, combo);
    }

    // Ghostscript can occasionally return a result that isn't actually
    // smaller (already-optimized PDFs) — never hand back something bigger.
    if (outBytes.length >= originalSize) {
      outBytes = srcBytes;
    }

    const compressedSize = outBytes.length;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="pdfdesk-compressed.pdf"'
    );
    res.setHeader("X-Original-Size", String(originalSize));
    res.setHeader("X-Compressed-Size", String(compressedSize));
    if (targetSize !== null) {
      res.setHeader("X-Target-Size", String(targetSize));
      res.setHeader("X-Achieved-Target", String(!!achievedTarget));
    }
    res.setHeader(
      "Access-Control-Expose-Headers",
      "X-Original-Size, X-Compressed-Size, X-Target-Size, X-Achieved-Target"
    );
    res.send(outBytes);
  } catch (err) {
    console.error("Compress error:", err);
    res.status(500).json({
      error: "Failed to compress PDF. " + (err.message || "")
    });
  } finally {
    if (inputPath) fs.unlink(inputPath).catch(() => {});
  }
});

module.exports = router;