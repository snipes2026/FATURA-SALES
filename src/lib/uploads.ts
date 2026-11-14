import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/** Root folder for product images and the company logo (a Docker volume in production). */
export const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR || "./data/uploads");

export const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const CONTENT_TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** Checks the file's magic bytes so a renamed file can't pose as an image. */
function sniffImage(buf: Buffer): string | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length > 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

/**
 * Saves an uploaded image under UPLOAD_ROOT/<folder>/ and returns the relative
 * path stored in the database (e.g. "company/3f2c….png").
 */
export async function saveImage(file: File, folder: "company" | "products", maxBytes: number): Promise<string> {
  if (file.size === 0) throw new Error("The file is empty");
  if (file.size > maxBytes) throw new Error(`Image must be under ${Math.round(maxBytes / 1024 / 1024)} MB`);
  const buf = Buffer.from(await file.arrayBuffer());
  const ext = sniffImage(buf);
  if (!ext) throw new Error("Only JPEG, PNG or WebP images are allowed");
  const dir = path.join(UPLOAD_ROOT, folder);
  await mkdir(dir, { recursive: true });
  const name = `${randomUUID()}.${ext}`;
  await writeFile(path.join(dir, name), buf);
  return `${folder}/${name}`;
}

/** Resolves a stored relative path safely (no "../" escapes). */
export function resolveUpload(relPath: string): string | null {
  const full = path.resolve(UPLOAD_ROOT, relPath);
  if (!full.startsWith(UPLOAD_ROOT + path.sep)) return null;
  return full;
}

export async function readUpload(relPath: string) {
  const full = resolveUpload(relPath);
  if (!full) return null;
  try {
    return await readFile(full);
  } catch {
    return null;
  }
}

export async function deleteUpload(relPath: string | null | undefined) {
  if (!relPath) return;
  const full = resolveUpload(relPath);
  if (full) await unlink(full).catch(() => undefined);
}

/** Public URL for a stored upload path. */
export const uploadUrl = (relPath: string | null | undefined) => (relPath ? `/uploads/${relPath}` : null);
