const express = require("express");
const multer = require("multer");
const {
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFNumber,
  PDFRef,
  PDFArray
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

/** Resolve a possibly-indirect PDF object to its concrete value. */
function resolve(context, obj) {
  if (obj instanceof PDFRef) return context.lookup(obj);
  return obj;
}

/**
 * Work out how many colour components an image's ColorSpace uses.
 * Handles the common cases (DeviceRGB/Gray/CMYK, CalRGB/CalGray, and
 * ICCBased via its /N entry). Anything else (Indexed, Separation,
 * DeviceN, ...) returns null so that image is safely left untouched.
 */
function getComponentCount(context, csEntry) {
  try {
    const cs = resolve(context, csEntry);
    if (!cs) return null;

    // Direct colour space name, e.g. /DeviceRGB
    if (typeof cs.toString === "function" && !(cs instanceof PDFArray)) {
      const name = cs.toString();
      if (name === "/DeviceRGB" || name === "/CalRGB") return 3;
      if (name === "/DeviceGray" || name === "/CalGray") return 1;
      if (name === "/DeviceCMYK") return 4;
      return null;
    }

    // Array form, e.g. [/ICCBased 5 0 R]
    if (cs instanceof PDFArray) {
      const arr = cs.asArray();
      const kind = resolve(context, arr[0])?.toString();
      if (kind === "/ICCBased") {
        const iccStream = resolve(context, arr[1]);
        const n = iccStream?.dict?.get(PDFName.of("N"));
        const num = n instanceof PDFNumber ? n.asNumber() : null;
        if (num === 1 || num === 3 || num === 4) return num;
        return null;
      }
      if (kind === "/CalRGB") return 3;
      if (kind === "/CalGray") return 1;
      return null; // Indexed, Separation, DeviceN, Lab, etc. — skip
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Decode a FlateDecode raster image (8-bit DeviceGray/RGB/CMYK only) into
 * an RGBA buffer so it can go through the same JPEG re-encode pipeline as
 * a DCTDecode image. Scanned PDFs very often store pages this way rather
 * than as JPEGs, so without this step "compress" has nothing to shrink.
 */
function decodeFlateImage(context, dict, rawBytes) {
  const bpc = dict.get(PDFName.of("BitsPerComponent"));
  const bpcNum = bpc instanceof PDFNumber ? bpc.asNumber() : null;
  if (bpcNum !== 8) return null; // only handling the common 8-bit case

  const widthObj = dict.get(PDFName.of("Width"));
  const heightObj = dict.get(PDFName.of("Height"));
  const width = widthObj instanceof PDFNumber ? widthObj.asNumber() : null;
  const height = heightObj instanceof PDFNumber ? heightObj.asNumber() : null;
  if (!width || !height) return null;

  const components = getComponentCount(context, dict.get(PDFName.of("ColorSpace")));
  if (!components) return null;

  const expected = width * height * components;
  if (rawBytes.length < expected) return null;

  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (components === 1) {
      const g = rawBytes[i];
      data[o] = g; data[o + 1] = g; data[o + 2] = g; data[o + 3] = 255;
    } else if (components === 3) {
      const s = i * 3;
      data[o] = rawBytes[s]; data[o + 1] = rawBytes[s + 1]; data[o + 2] = rawBytes[s + 2]; data[o + 3] = 255;
    } else if (components === 4) {
      const s = i * 4;
      const c = rawBytes[s], m = rawBytes[s + 1], y = rawBytes[s + 2], k = rawBytes[s + 3];
      data[o] = 255 - Math.min(255, c + k);
      data[o + 1] = 255 - Math.min(255, m + k);
      data[o + 2] = 255 - Math.min(255, y + k);
      data[o + 3] = 255;
    }
  }

  return { data, width, height };
}

/**
 * Load the PDF once, strip metadata, and collect every image stream —
 * both DCTDecode (JPEG) and FlateDecode (raw bitmap) — with its ref and
 * decoded pixel data, decoded exactly once regardless of how many
 * quality/scale combos we later try on it.
 */
async function prepareDoc(srcBytes) {
  let pdfDoc;
  let encryptedUnreadable = false;

  try {
    // Most "protected" PDFs only restrict printing/editing and have an
    // empty user password — pdf-lib can decrypt those transparently as
    // long as we DON'T pass ignoreEncryption, so image streams come back
    // as real JPEG/raw bytes instead of ciphertext.
    pdfDoc = await PDFDocument.load(srcBytes, { updateMetadata: false });
  } catch (e) {
    const msg = (e && e.message) || "";
    const isEncryptionError =
      e?.constructor?.name === "EncryptedPDFError" || /encrypt/i.test(msg);

    if (!isEncryptionError) throw e;

    // Genuinely needs a real user password we don't have — load it anyway
    // so we can still strip metadata, but image streams will stay as
    // undecryptable ciphertext and must be skipped rather than "fixed".
    pdfDoc = await PDFDocument.load(srcBytes, {
      ignoreEncryption: true,
      updateMetadata: false
    });
    encryptedUnreadable = true;
  }

  pdfDoc.setTitle("");
  pdfDoc.setAuthor("");
  pdfDoc.setSubject("");
  pdfDoc.setKeywords([]);
  pdfDoc.setProducer("PDFDesk");
  pdfDoc.setCreator("PDFDesk");

  const context = pdfDoc.context;
  const images = [];

  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (encryptedUnreadable) break; // image bytes are ciphertext — nothing to decode

    if (!(obj instanceof PDFRawStream)) continue;

    const dict = obj.dict;
    const subtype = dict.get(PDFName.of("Subtype"));
    if (!subtype || subtype.toString() !== "/Image") continue;

    const filter = dict.get(PDFName.of("Filter"));
    if (!filter) continue;

    const filterNames = Array.isArray(filter.asArray?.())
      ? filter.asArray().map((f) => f.toString())
      : [filter.toString()];

    // Original stored (still-encoded) length — this is what we compare
    // any recompressed result against to make sure we're really shrinking.
    const lengthEntry = resolve(context, dict.get(PDFName.of("Length")));
    const origLength = lengthEntry instanceof PDFNumber ? lengthEntry.asNumber() : Infinity;

    try {
      if (filterNames.includes("/DCTDecode")) {
        const rawBytes = obj.getContents();
        const decoded = jpeg.decode(rawBytes, { useTArray: true });
        images.push({ ref, dict, decoded, origLength });
      } else if (filterNames.length === 1 && filterNames[0] === "/FlateDecode") {
        const rawBytes = obj.getContents(); // already zlib-inflated by pdf-lib
        const decoded = decodeFlateImage(context, dict, rawBytes);
        if (decoded) images.push({ ref, dict, decoded, origLength });
      }
      // Other filters (CCITTFax, JPXDecode, Indexed colour spaces, etc.)
      // are left untouched — decoding those safely needs extra libraries.
    } catch (e) {
      console.warn("Compress: skipped one image (decode failed) —", e.message);
    }
  }

  return { pdfDoc, context, images, encryptedUnreadable };
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
      // Whatever the source was (JPEG or raw Flate bitmap), the output of
      // jpeg.encode() is always an 8-bit RGB JPEG — the dict must say so.
      newDict.set(PDFName.of("Filter"), PDFName.of("DCTDecode"));
      newDict.set(PDFName.of("ColorSpace"), PDFName.of("DeviceRGB"));
      newDict.set(PDFName.of("BitsPerComponent"), PDFNumber.of(8));
      newDict.delete(PDFName.of("DecodeParms"));
      newDict.delete(PDFName.of("Decode"));
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

    const { pdfDoc, context, images, encryptedUnreadable } = await prepareDoc(srcBytes);

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
    res.setHeader("X-Images-Found", String(images.length));
    res.setHeader("X-Encrypted-Unreadable", String(!!encryptedUnreadable));
    if (targetSize !== null) {
      res.setHeader("X-Target-Size", String(targetSize));
      res.setHeader("X-Achieved-Target", String(!!achievedTarget));
    }
    res.setHeader(
      "Access-Control-Expose-Headers",
      "X-Original-Size, X-Compressed-Size, X-Images-Found, X-Encrypted-Unreadable, X-Target-Size, X-Achieved-Target"
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