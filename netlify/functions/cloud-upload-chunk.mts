import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

const UPLOAD_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_CHUNKS = 120; // Up to ~360 MB at 3 MB/chunk
const MAX_CHUNK_BYTES = 4_800_000; // Safe margin below 6 MB Lambda body limit

export default async (req: Request, _context: Context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  const url = new URL(req.url);
  const uploadId = (url.searchParams.get("upload_id") || "").trim();
  const chunkIdxRaw = url.searchParams.get("chunk_index");
  const totalChunksRaw = url.searchParams.get("total_chunks");

  if (!UPLOAD_ID_RE.test(uploadId)) {
    return Response.json({ error: "Invalid upload_id", error_code: "invalid_upload_id" }, { status: 400 });
  }

  const uploadsStore = getStore("hawkview-uploads");
  const expectedSecret = Netlify.env.get("HAWKVIEW_CALLBACK_SECRET") || "";
  const providedSecret = req.headers.get("x-hawkview-secret") || "";

  // POST: Client browser uploads a single binary chunk (<= 4.8 MB) into Netlify Blobs
  if (req.method === "POST") {
    const chunkIdx = Number(chunkIdxRaw);
    const totalChunks = Number(totalChunksRaw || 1);
    if (
      !Number.isInteger(chunkIdx) ||
      chunkIdx < 0 ||
      chunkIdx >= MAX_CHUNKS ||
      !Number.isInteger(totalChunks) ||
      totalChunks < 1 ||
      totalChunks > MAX_CHUNKS ||
      chunkIdx >= totalChunks
    ) {
      return Response.json({ error: "Invalid chunk_index or total_chunks" }, { status: 400 });
    }

    const buf = await req.arrayBuffer();
    if (!buf || buf.byteLength === 0) {
      return Response.json({ error: "Empty chunk payload" }, { status: 400 });
    }
    if (buf.byteLength > MAX_CHUNK_BYTES) {
      return Response.json({ error: `Chunk exceeds ${MAX_CHUNK_BYTES} bytes` }, { status: 413 });
    }

    await uploadsStore.set(`upload:${uploadId}:chunk:${chunkIdx}`, buf);
    return Response.json(
      {
        ok: true,
        upload_id: uploadId,
        chunk_index: chunkIdx,
        total_chunks: totalChunks,
        bytes: buf.byteLength,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // GET / DELETE: Authenticated Cloud Worker ONLY (requires HAWKVIEW_CALLBACK_SECRET)
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (req.method === "GET") {
    const chunkIdx = Number(chunkIdxRaw);
    if (!Number.isInteger(chunkIdx) || chunkIdx < 0 || chunkIdx >= MAX_CHUNKS) {
      return Response.json({ error: "Invalid chunk_index" }, { status: 400 });
    }
    const data = await uploadsStore.get(`upload:${uploadId}:chunk:${chunkIdx}`, { type: "arrayBuffer" });
    if (!data) {
      return Response.json({ error: `Chunk ${chunkIdx} not found` }, { status: 404 });
    }
    return new Response(data, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
      },
    });
  }

  if (req.method === "DELETE") {
    const totalChunks = Math.min(MAX_CHUNKS, Math.max(1, Number(totalChunksRaw || 1)));
    let deleted = 0;
    for (let i = 0; i < totalChunks; i++) {
      try {
        await uploadsStore.delete(`upload:${uploadId}:chunk:${i}`);
        deleted++;
      } catch {
        // Ignore missing chunk
      }
    }
    return Response.json({ ok: true, upload_id: uploadId, deleted });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};

export const config: Config = {
  path: "/api/cloud-upload-chunk",
};
