import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

const ALLOWED_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "music.youtube.com",
]);
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function extractYouTubeVideoId(raw: string): string | null {
  const s = String(raw || "").trim();
  if (!s || s.length > 512 || /[\r\n\0;|`$ ]/.test(s)) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) return null;

  const parts = u.pathname.split("/").filter(Boolean);
  let vid: string | null = null;
  if (host === "youtu.be" || host === "www.youtu.be") {
    vid = parts[0] || null;
  } else if (u.pathname === "/watch") {
    vid = u.searchParams.get("v");
  } else if (parts.length >= 2 && ["shorts", "live", "embed", "v"].includes(parts[0])) {
    vid = parts[1];
  }
  return vid && VIDEO_ID_RE.test(vid) ? vid : null;
}

export default async (req: Request, context: Context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body", error_code: "invalid_json" }, { status: 400 });
  }

  const rawUrl = String(body.url || "").trim();
  const videoId = extractYouTubeVideoId(rawUrl);
  if (!videoId) {
    return Response.json(
      {
        error: "Invalid YouTube URL. Paste a valid youtube.com/watch?v=..., youtu.be/..., or youtube.com/live/... link.",
        error_code: "invalid_youtube_url",
      },
      { status: 400 }
    );
  }

  const forceReprocess = Boolean(body.force_reprocess || body.force_redownload);
  const rawMax = body.max_rallies;
  const maxRalliesNum = rawMax === undefined || rawMax === null ? 6 : Number(rawMax);
  // Allow 0 (Full Match on Blackwell G4 GPU) or 1..30 rallies
  const maxRallies = Number.isFinite(maxRalliesNum) && maxRalliesNum >= 0 && maxRalliesNum <= 30 ? Math.round(maxRalliesNum) : 6;
  const matchId = `yt_${videoId}`;
  const origin = new URL(req.url).origin;

  const matchesStore = getStore("hawkview-matches");
  const jobsStore = getStore("hawkview-jobs");

  // 1. Instant hit from Netlify Blobs (previously processed cloud YouTube video)
  if (!forceReprocess) {
    try {
      const existingBlob = await matchesStore.get(`telemetry:${matchId}`, { type: "json" });
      if (existingBlob && typeof existingBlob === "object" && Array.isArray((existingBlob as any).rallies) && (existingBlob as any).rallies.length > 0) {
        return Response.json({
          status: "ready",
          instant: true,
          mode: "cloud_cached",
          video_id: videoId,
          match_id: matchId,
          telemetry: existingBlob,
          message: `Loaded cached 3D match for ${videoId} instantly from Cloud Cache.`,
        });
      }
    } catch {
      // Fall through to static check
    }

    // 2. Instant hit from bundled static matches (e.g. yt_<id> or stress_<id>)
    for (const staticMid of [matchId, `stress_${videoId}`]) {
      try {
        const stRes = await fetch(`${origin}/data/matches/${encodeURIComponent(staticMid)}/telemetry.json`);
        if (stRes.ok) {
          const tel = (await stRes.json()) as any;
          if (tel && Array.isArray(tel.rallies) && tel.rallies.length > 0) {
            if (tel.source && !tel.source.yt_video_id) {
              tel.source.yt_video_id = videoId;
            }
            return Response.json({
              status: "ready",
              instant: true,
              mode: "cloud_cached",
              video_id: videoId,
              match_id: staticMid,
              telemetry: tel,
              message: `Loaded pre-analyzed 3D match for ${videoId} instantly.`,
            });
          }
        }
      } catch {
        // Ignore missing static file
      }
    }
  }

  // 3. Dispatch brand-new unseen YouTube URL to Cloud CV Runner (GitHub Actions — 100% Mac-free!)
  const ghToken = Netlify.env.get("GITHUB_TOKEN") || "";
  const ghRepo = Netlify.env.get("GITHUB_REPO") || "NeonMaru/Hawkview";
  const ghWorkflow = Netlify.env.get("GITHUB_WORKFLOW") || "youtube_to_hawkview.yml";
  const callbackSecret = Netlify.env.get("HAWKVIEW_CALLBACK_SECRET") || "";

  if (!ghToken || !callbackSecret) {
    return Response.json(
      {
        error: "Cloud CV runner is not configured yet (missing GITHUB_TOKEN or HAWKVIEW_CALLBACK_SECRET in Netlify env).",
        error_code: "cloud_runner_unconfigured",
      },
      { status: 503 }
    );
  }

  const jobId = `cloud_${videoId}_${Date.now().toString(36)}`;
  const callbackUrl = `${origin}/api/cloud-callback`;
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const initialJob = {
    job_id: jobId,
    video_id: videoId,
    match_id: matchId,
    url: canonicalUrl,
    mode: "cloud_async",
    status: "running",
    stage: "STAGE 0: Dispatching Cloud CV Runner",
    percent: 5,
    message: `Starting cloud 1080p download + TrackNetV3 + 3D physics for ${videoId} (zero Mac needed)...`,
    rallies_completed: 0,
    rallies_total: maxRallies,
    error: null,
    error_code: null,
    started_at: Date.now() / 1000,
    updated_at: Date.now() / 1000,
  };

  await jobsStore.setJSON(`job:${jobId}`, initialJob);

  const dispatchRes = await fetch(
    `https://api.github.com/repos/${ghRepo}/actions/workflows/${encodeURIComponent(ghWorkflow)}/dispatches`,
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
          youtube_url: canonicalUrl,
          video_id: videoId,
          job_id: jobId,
          match_id: matchId,
          max_rallies: String(maxRallies),
          callback_url: callbackUrl,
        },
      }),
    }
  );

  if (!dispatchRes.ok) {
    const errText = await dispatchRes.text().catch(() => "");
    const failedJob = {
      ...initialJob,
      status: "error",
      stage: "Cloud Dispatch Failed",
      percent: 100,
      error: `GitHub Actions dispatch failed (HTTP ${dispatchRes.status}): ${errText.slice(0, 220)}`,
      error_code: "cloud_dispatch_failed",
      updated_at: Date.now() / 1000,
    };
    await jobsStore.setJSON(`job:${jobId}`, failedJob);
    return Response.json(
      { error: failedJob.error, error_code: failedJob.error_code, job_id: jobId },
      { status: 502 }
    );
  }

  return Response.json({
    status: "started",
    mode: "cloud_async",
    job_id: jobId,
    video_id: videoId,
    match_id: matchId,
    message: initialJob.message,
  });
};

export const config: Config = {
  path: "/api/import-youtube",
};
