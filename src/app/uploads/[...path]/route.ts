import path from "node:path";
import { auth } from "@/auth";
import { CONTENT_TYPES, readUpload } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/** Serves files from UPLOAD_DIR to signed-in users. */
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const session = await auth();
  if (!session?.user) return new Response("Unauthorized", { status: 401 });

  const rel = (await params).path.join("/");
  const ext = path.extname(rel).slice(1).toLowerCase();
  const type = CONTENT_TYPES[ext];
  if (!type) return new Response("Not found", { status: 404 });

  const data = await readUpload(rel);
  if (!data) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, max-age=31536000, immutable", // file names are random UUIDs
      "X-Content-Type-Options": "nosniff",
    },
  });
}
