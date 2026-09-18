/**
 * GIF first-frame extractor — pure TypeScript, zero dependencies.
 *
 * Parses a GIF89a (or GIF87a) binary stream, extracts the first frame,
 * and returns a minimal single-frame GIF as a Buffer.
 */

// GIF block type markers
const IMAGE_DESCRIPTOR = 0x2C;
const EXTENSION = 0x21;
const TRAILER = 0x3B;

// Extension labels
const GRAPHIC_CONTROL = 0xF9;
const APPLICATION = 0xFF;
const COMMENT = 0xFE;
const PLAIN_TEXT = 0x01;

/**
 * Extract the first frame from a GIF buffer and return a minimal single-frame GIF.
 *
 * The output GIF contains:
 *   - Header + Logical Screen Descriptor + Global Color Table
 *   - Graphic Control Extension (if present, with disposal=0 and delay=0)
 *   - First Image Descriptor + Local Color Table + Image Data
 *   - Trailer
 *
 * Returns null if the input is not a valid GIF or cannot be parsed.
 */
export function extractGifFirstFrame(buf: Buffer): Buffer | null {
  if (buf.length < 13) return null;

  const sig = buf.toString('ascii', 0, 6);
  if (sig !== 'GIF89a' && sig !== 'GIF87a') return null;

  let pos = 6;

  // --- Logical Screen Descriptor (7 bytes) ---
  if (pos + 7 > buf.length) return null;
  const packed = buf[pos + 4];
  const gctFlag = (packed >> 7) & 1;
  const gctSize = gctFlag ? (3 * (1 << ((packed & 0x07) + 1))) : 0;

  const lsdEnd = pos + 7;
  pos = lsdEnd;

  // --- Global Color Table ---
  if (pos + gctSize > buf.length) return null;
  pos += gctSize;

  const outParts: Buffer[] = [];
  outParts.push(buf.subarray(0, pos));

  // --- Scan for first frame ---
  let foundGCE: Buffer | null = null;

  while (pos < buf.length) {
    const blockType = buf[pos];

    if (blockType === IMAGE_DESCRIPTOR) {
      if (foundGCE) {
        const gce = Buffer.from(foundGCE);
        gce[3] = 0; // delay = 0
        outParts.push(gce);
      }

      if (pos + 10 > buf.length) return null;
      const imgPacked = buf[pos + 9];
      const lctFlag = (imgPacked >> 7) & 1;
      const lctSize = lctFlag ? (3 * (1 << ((imgPacked & 0x07) + 1))) : 0;

      const imgDescEnd = pos + 10;
      outParts.push(buf.subarray(pos, imgDescEnd));
      pos = imgDescEnd;

      if (pos + lctSize > buf.length) return null;
      if (lctSize > 0) {
        outParts.push(buf.subarray(pos, pos + lctSize));
        pos += lctSize;
      }

      if (pos >= buf.length) return null;
      outParts.push(buf.subarray(pos, pos + 1));
      pos += 1;

      pos = copySubBlocks(buf, pos, outParts);
      if (pos === -1) return null;

      outParts.push(Buffer.from([TRAILER]));
      return Buffer.concat(outParts);
    }

    if (blockType === EXTENSION) {
      pos += 1;
      if (pos >= buf.length) return null;
      const label = buf[pos];
      pos += 1;

      if (label === GRAPHIC_CONTROL) {
        const gceStart = pos - 2;
        if (pos + 5 > buf.length) return null;
        const blockSize = buf[pos];
        if (blockSize !== 4) return null;
        const gceEnd = pos + 1 + blockSize + 1;
        if (gceEnd > buf.length) return null;
        foundGCE = buf.subarray(gceStart, gceEnd);
        pos = gceEnd;
      } else {
        pos = skipSubBlocks(buf, pos);
        if (pos === -1) return null;
      }
      continue;
    }

    if (blockType === TRAILER) {
      return null;
    }

    pos += 1;
  }

  return null;
}

function copySubBlocks(buf: Buffer, pos: number, outParts: Buffer[]): number {
  while (pos < buf.length) {
    const size = buf[pos];
    outParts.push(buf.subarray(pos, pos + 1 + size));
    pos += 1 + size;
    if (size === 0) break;
  }
  return pos;
}

function skipSubBlocks(buf: Buffer, pos: number): number {
  while (pos < buf.length) {
    const size = buf[pos];
    pos += 1 + size;
    if (size === 0) break;
  }
  return pos;
}

/**
 * Convert a GIF base64 string to a PNG base64 string by extracting the first frame.
 */
export function gifToStaticFrame(gifBase64: string): { data: string; mimeType: string } | null {
  try {
    const buf = Buffer.from(gifBase64, 'base64');
    const firstFrame = extractGifFirstFrame(buf);
    if (!firstFrame) return null;
    return {
      data: firstFrame.toString('base64'),
      mimeType: 'image/gif',
    };
  } catch {
    return null;
  }
}
