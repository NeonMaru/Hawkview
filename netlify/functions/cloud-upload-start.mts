import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

const UPLOAD_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_CHUNKS = 120;

function sanitizeSlug(raw: string): string {
  const base = String(raw || "phone_match")
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 36);
  return base || "phone_match";
}

export default async (req: Request, _context: Context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  let body: Record<string, any> = {};
  try {
    body = (await req.json()) as Record<string, any>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const uploadId = String(body.upload_id || "").trim();
  const totalChunks = Number(body.total_chunks || 0);
  const filename = String(body.filename || "phone_match.mp4").trim().slice(0, 140);
  const rawMax = body.max_rallies;
  const maxRalliesNum = rawMax === undefined || rawMax === null ? 6 : Number(rawMax);
  const maxRallies =
    Number.isFinite(maxRalliesNum) && maxRalliesNum >= 0 && maxRalliesNum <= 30
      ? Math.round(maxRalliesNum)
      : 6;

  if (!UPLOAD_ID_RE.test(uploadId)) {
    return Response.json({ error: "Invalid upload_id" }, { status: 400 });
  }
  if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > MAX_CHUNKS) {
    return Response.json({ error: "Invalid total_chunks" }, { status: 400 });
  }

  const ghToken = Netlify.env.get("GITHUB_TOKEN") || "";
  const ghRepo = Netlify.env.get("GITHUB_REPO") || "NeonMaru/Hawkview";
  const ghWorkflow = Netlify.env.get("GITHUB_WORKFLOW") || "youtube_to_hawkview.yml";
  const callbackSecret = Netlify.env.get("HAWKVIEW_CALLBACK_SECRET") || "";

  if (!ghToken || !callbackSecret) {
    return Response.json(
      { error: "Cloud GPU runner is not configured (missing GITHUB_TOKEN or HAWKVIEW_CALLBACK_SECRET)." },
      { status: 503 }
    );
  }

  const origin = new URL(req.url).origin;
  const shortHash = uploadId.slice(-6).toLowerCase();
  const matchId = `up_${sanitizeSlug(filename)}_${shortHash}`;
  const jobId = `cloud_up_${uploadId}_${Date.now().toString(36)}`;
  const callbackUrl = `${origin}/api/cloud-callback`;
  const uploadEndpoint = `${origin}/api/cloud-upload-chunk`;

  const jobsStore = getStore("hawkview-jobs");
  const initialJob = {
    job_id: jobId,
    upload_id: uploadId,
    video_id: "",
    match_id: matchId,
    filename,
    mode: "cloud_async",
    status: "running",
    stage: "Dispatching Cloud GPU",
    percent: 20,
    message: `MP4 uploaded (${totalChunks} chunk${totalChunks > 1 ? "s" : ""}). Booting Cloud GPU worker...`,
    rallies_completed: 0,
    rallies_total: maxRallies,
    error: null,
    error_code: null,
    started_at: Date.now() / 1000,
    updated_at: Date.now() / 1000,
  };
  await jobsStore.setJSON(`job:${jobId}`, initialJob);

  const ghResp = await fetch(
    `https://api.github.com/repos/${ghRepo}/actions/workflows/${ghWorkflow}/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "Hawkview-Netlify-Cloud",
      },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          youtube_url: "",
          video_id: "",
          upload_id: uploadId,
          upload_chunks: String(totalChunks),
          upload_filename: filename,
          upload_endpoint: uploadEndpoint,
          job_id: jobId,
          match_id: matchId,
          max_rallies: String(maxRallies),
          callback_url: callbackUrl,
        },
      }),
    }
  );

  if (!ghResp.ok) {
    const errText = await ghResp.text().catch(() => "");
    await jobsStore.setJSON(`job:${jobId}`, {
      ...initialJob,
      status: "error",
      stage: "Cloud Dispatch Error",
      error: `GitHub Actions dispatch failed (HTTP ${ghResp.status}): ${errText.slice(0, 220)}`,
      error_code: "github_dispatch_failed",
      updated_at: Date.now() / 1000,
    });
    return Response.json(
      {
        error: `Cloud GPU dispatch failed (HTTP ${ghResp.status}).`,
        error_code: "github_dispatch_failed",
        detail: errText.slice(0, 220),
      },
      { status: 502 }
    );
  }

  return Response.json(
    {
      status: "started",
      mode: "cloud_async",
      job_id: jobId,
      match_id: matchId,
      upload_id: uploadId,
      message: `MP4 uploaded! Running Cloud GPU TrackNetV3 + 3D physics on ${filename}...`,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
};

export const config: Config = {
  path: "/api/cloud-upload-start",
};
