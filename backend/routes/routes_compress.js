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

/**
 * Compression "aggressiveness" ladder, ordered from LEAST aggressive (index 0,
 * best quality/smallest savings) to MOST aggressive (last index, smallest
 * file/lowest quality). Every combo has a JPEG re-encode quality AND an
 * image resolution scale — resolution is what actually moves the needle,
 * quality alone barely shrinks an already-compressed JPEG.
 */
const COMBOS = [
  { q: 90, s: 1.0 },   // 0
  { q: 75, s: 1.0 },   // 1  -> "low"
  { q: 60, s: 0.9 },   // 2
  { q: 50, s: 0.8 },   // 3
  { q: 40, s: 0.75 },  // 4  -> "medium"
  { q: 30, s: 0.65 },  // 5
  { q: 22, s: 0.55 },  // 6
  { q: 15, s: 0.45 },  // 7  -> "high"
  { q: 10, s: 0.35 }   // 8
];

const LEVEL_INDEX = { low: 1, medium: 4, high: 7 };

/**
 * Bilinear-resample an RGBA buffer down to width*scale x height*scale.
 * Pure JS, no native deps — safe for free-tier hosting.
 */
function resizeRGBA(data, width, height, scale) {
  if (scale >= 0.999) return { data, width, height };

  const newWidth = Math.max(1, Math.round(width * scale));
  const newHeight = Math.max(1, Math.round(height * scale));
  const out = Buffer.alloc(newWidth * newHeight * 4);

  for (let y = 0; y < newHeight; y++) {
    const srcY = (y + 0.5) * (height / newHeight) - 0.5;
    const y0 = Math.max(0, Math.min(height - 1, Math.floor(srcY)));
    const y1 = Math.min(height - 1, y0 + 1);
    const wy = srcY - y0;

    for (let x = 0; x < newWidth; x++) {
      const srcX = (x + 0.5) * (width / newWidth) - 0.5;
      const x0 = Math.max(0, Math.min(width - 1, Math.floor(srcX)));
      const x1 = Math.min(width - 1, x0 + 1);
      const wx = srcX - x0;

      const i00 = (y0 * width + x0) * 4;
      const i01 = (y0 * width + x1) * 4;
      const i10 = (y1 * width + x0) * 4;
      const i11 = (y1 * width + x1) * 4;
      const o = (y * newWidth + x) * 4;

      for (let c = 0; c < 4; c++) {
        const top = data[i00 + c] + (data[i01 + c] - data[i00 + c]) * wx;
        const bottom = data[i10 + c] + (data[i11 + c] - data[i10 + c]) * wx;
        out[o + c] = Math.round(top + (bottom - top) * wy);
      }
    }
  }

  return { data: out, width: newWidth, height: newHeight };
}

/**
 * Load the PDF once, strip metadata, and collect every DCTDecode (JPEG)
 * image stream with its ref + decoded pixel data, decoded exactly once.
 */
async function prepareDoc(srcBytes) {
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
  const images = [];

  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;

    const dict = obj.dict;
    const subtype = dict.get(PDFName.of("Subtype"));
    if (!subtype || subtype.toString() !== "/Image") continue;

    const filter = dict.get(PDFName.of("Filter"));
    if (!filter) continue;

    const filterNames = Array.isArray(filter.asArray?.())
      ? filter.asArray().map((f) => f.toString())
      : [filter.toString()];

    if (!filterNames.includes("/DCTDecode")) continue;

    try {
      const rawBytes = obj.getContents();
      const decoded = jpeg.decode(rawBytes, { useTArray: true });
      images.push({ ref, dict, decoded, origLength: rawBytes.length });
    } catch (e) {
      console.warn("Compress: skipped one image (decode failed) —", e.message);
    }
  }

  return { pdfDoc, context, images };
}

/**
 * Re-encode every cached image at the given quality/scale and save the PDF.
 * Cheap-ish because decode already happened once in prepareDoc(); this only
 * resamples + re-encodes + reassigns the stream, then serializes.
 */
async function buildOutput(pdfDoc, context, images, combo) {
  for (const img of images) {
    const { data, width, height } = resizeRGBA(
      img.decoded.data,
      img.decoded.width,
      img.decoded.height,
      combo.s
    );

    const recompressed = jpeg.encode({ data, width, height }, combo.q);

    // Only swap in the new version if it's actually smaller than original —
    // never make an individual image bigger than it started.
    if (recompressed.data.length < img.origLength) {
      const newDict = img.dict.clone(context);
      newDict.set(PDFName.of("Width"), PDFNumber.of(width));
      newDict.set(PDFName.of("Height"), PDFNumber.of(height));
      newDict.set(PDFName.of("Length"), PDFNumber.of(recompressed.data.length));
      const newStream = PDFRawStream.of(newDict, recompressed.data);
      context.assign(img.ref, newStream);
    }
  }

  return pdfDoc.save({ useObjectStreams: true });
}

/**
 * POST /api/compress
 * file: PDF
 * level: "low" | "medium" | "high" | "custom"  (default "medium")
 * targetSize: required bytes when level === "custom"
 *
 * Non-custom levels map to a fixed quality+resolution combo.
 * Custom mode binary-searches the combo ladder to get as close to the
 * requested size as possible while keeping the best quality it can.
 */
router.post("/", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No PDF file uploaded." });
    }

    const srcBytes = req.file.buffer;
    const originalSize = srcBytes.length;
    const level = req.body.level && LEVEL_INDEX[req.body.level] !== undefined
      ? req.body.level
      : (req.body.level === "custom" ? "custom" : "medium");

    const { pdfDoc, context, images } = await prepareDoc(srcBytes);

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

      // Binary search the COMBOS ladder for the least-aggressive combo
      // that still gets us under (or as close as possible to) targetSize.
      let lo = 0;
      let hi = COMBOS.length - 1;
      let bestBytes = null;
      let bestReached = false;

      // Always know the worst-case (most aggressive) result as a fallback.
      const worstCase = await buildOutput(pdfDoc, context, images, COMBOS[hi]);

      if (worstCase.length > targetSize) {
        // Even max compression can't hit the target — best effort.
        outBytes = worstCase;
        achievedTarget = false;
      } else {
        bestBytes = worstCase;
        bestReached = true;

        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const attempt = await buildOutput(pdfDoc, context, images, COMBOS[mid]);

          if (attempt.length <= targetSize) {
            bestBytes = attempt;
            bestReached = true;
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
      outBytes = await buildOutput(pdfDoc, context, images, combo);
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
    res.send(Buffer.from(outBytes));
  } catch (err) {
    console.error("Compress error:", err);
    res.status(500).json({
      error: "Failed to compress PDF. " + (err.message || "")
    });
  }
});

module.exports = router;