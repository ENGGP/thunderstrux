import { createHash } from "node:crypto";
import sharp from "sharp";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export class AssetError extends Error {
  constructor(readonly status: 400 | 404 | 409 | 413 | 429 | 503, message: string) { super(message); }
}

function imageType(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    let offset = 8;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset);
      const type = bytes.toString("ascii", offset + 4, offset + 8);
      if (type === "acTL") throw new AssetError(400, "Animated images are not supported");
      offset += length + 12;
      if (type === "IEND") {
        if (length !== 0 || offset !== bytes.length) break;
        return "image/png";
      }
    }
  } else if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    if (bytes.readUInt32LE(4) + 8 === bytes.length) return "image/webp";
  } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217) {
    // Walk JPEG marker/scan boundaries so an EOI followed by a second payload is rejected.
    let offset = 2;
    let inScan = false;
    while (offset < bytes.length) {
      if (inScan) {
        if (bytes[offset++] !== 255) continue;
        while (bytes[offset] === 255) offset++;
        if (bytes[offset] === 0 || (bytes[offset] >= 208 && bytes[offset] <= 215)) { offset++; continue; }
        offset--;
        inScan = false;
      }
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217) { if (offset === bytes.length) return "image/jpeg"; break; }
      if (marker === 216 || marker === 0 || offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2) break;
      offset += length;
      inScan = marker === 218;
    }
  }
  throw new AssetError(400, "Upload a valid JPEG, PNG or WebP image without trailing content");
}

export async function sanitiseImage(bytes: Buffer, declaredType: string) {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new AssetError(413, "Images must be no larger than 5 MiB");
  const type = imageType(bytes);
  if (type !== declaredType) throw new AssetError(400, "Image content does not match its file type");
  try {
    const image = sharp(bytes, { failOn: "warning", limitInputPixels: 4096 * 4096 });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || metadata.width > 4096 || metadata.height > 4096 || (metadata.pages ?? 1) !== 1)
      throw new AssetError(400, "Images must be static and no larger than 4096 by 4096 pixels");
    const { data, info } = await image.rotate().webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
    if (data.length > MAX_IMAGE_BYTES) throw new AssetError(413, "Processed image is too large");
    return { bytes: data, width: info.width, height: info.height, byteSize: data.length, sha256: createHash("sha256").update(data).digest("hex") };
  } catch (error) {
    if (error instanceof AssetError) throw error;
    throw new AssetError(400, "Image could not be safely decoded");
  }
}

export async function readImageForm(request: Request) {
  const maximum = MAX_IMAGE_BYTES + 64 * 1024;
  if (Number(request.headers.get("content-length")) > maximum) throw new AssetError(413, "Upload is too large");
  const reader = request.body?.getReader();
  if (!reader) throw new AssetError(400, "Choose one image");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum) { await reader.cancel(); throw new AssetError(413, "Upload is too large"); }
      chunks.push(value);
    }
    const form = await new Response(Buffer.concat(chunks), { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
    const entries = [...form.entries()];
    const file = form.get("file");
    if (entries.length !== 1 || !(file instanceof File)) throw new AssetError(400, "Choose exactly one image");
    return { bytes: Buffer.from(await file.arrayBuffer()), type: file.type };
  } catch (error) {
    if (error instanceof AssetError) throw error;
    throw new AssetError(400, "Invalid image upload");
  } finally { reader.releaseLock(); }
}
