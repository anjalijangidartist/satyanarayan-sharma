"use strict";

function jpegOrientation(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return 1;
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break;
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) break;
    if (marker === 0xe1 && buffer.toString("latin1", offset + 4, offset + 10) === "Exif\0\0") {
      const tiff = offset + 10;
      if (tiff + 8 > buffer.length) return 1;
      const little = buffer.toString("latin1", tiff, tiff + 2) === "II";
      const read16 = (at) => (little ? buffer.readUInt16LE(at) : buffer.readUInt16BE(at));
      const read32 = (at) => (little ? buffer.readUInt32LE(at) : buffer.readUInt32BE(at));
      const ifd = tiff + read32(tiff + 4);
      if (ifd + 2 <= buffer.length) {
        const count = read16(ifd);
        for (let i = 0; i < count; i += 1) {
          const entry = ifd + 2 + i * 12;
          if (entry + 12 > buffer.length) break;
          if (read16(entry) === 0x0112) {
            const value = read16(entry + 8);
            return value >= 1 && value <= 8 ? value : 1;
          }
        }
      }
    }
    offset += 2 + length;
  }
  return 1;
}

function jpegSize(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) break;
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) break;
    const isSof = marker >= 0xc0 && marker <= 0xcf
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

function pngSize(buffer) {
  if (buffer.length < 24) return null;
  if (buffer.readUInt32BE(0) !== 0x89504e47 || buffer.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  if (buffer.toString("latin1", 12, 16) !== "IHDR") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function webpSize(buffer) {
  if (buffer.length < 30) return null;
  if (buffer.toString("latin1", 0, 4) !== "RIFF") return null;
  if (buffer.toString("latin1", 8, 12) !== "WEBP") return null;
  const chunk = buffer.toString("latin1", 12, 16);
  if (chunk === "VP8X") {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (chunk === "VP8 ") {
    let offset = 20;
    while (offset + 10 < buffer.length) {
      if (buffer[offset] === 0x9d && buffer[offset + 1] === 0x01 && buffer[offset + 2] === 0x2a) {
        return {
          width: buffer.readUInt16LE(offset + 3) & 0x3fff,
          height: buffer.readUInt16LE(offset + 5) & 0x3fff,
        };
      }
      offset += 1;
    }
    return null;
  }
  if (chunk === "VP8L") {
    if (buffer[20] !== 0x2f) return null;
    const b = buffer;
    return {
      width: 1 + (((b[22] & 0x3f) << 8) | b[21]),
      height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)),
    };
  }
  return null;
}

function inspectImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    const size = jpegSize(buffer);
    if (!size) return null;
    const orientation = jpegOrientation(buffer);
    const width = orientation >= 5 ? size.height : size.width;
    const height = orientation >= 5 ? size.width : size.height;
    return { extension: ".jpg", mime: "image/jpeg", width, height };
  }

  if (buffer[0] === 0x89 && buffer.toString("latin1", 1, 4) === "PNG") {
    const size = pngSize(buffer);
    if (!size) return null;
    return { extension: ".png", mime: "image/png", width: size.width, height: size.height };
  }

  if (buffer.toString("latin1", 0, 4) === "RIFF" && buffer.toString("latin1", 8, 12) === "WEBP") {
    const size = webpSize(buffer);
    if (!size) return null;
    return { extension: ".webp", mime: "image/webp", width: size.width, height: size.height };
  }

  return null;
}

function normalizeMime(value) {
  const mime = String(value || "").split(";")[0].trim().toLowerCase();
  if (mime === "image/jpg" || mime === "image/pjpeg") return "image/jpeg";
  return mime;
}

module.exports = { inspectImage, normalizeMime };
