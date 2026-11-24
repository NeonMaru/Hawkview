import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

function summarizeMatch(matchId: string, tel: any) {
  const rallies = Array.isArray(tel?.rallies) ? tel.rallies : [];
  const players = tel?.players || {};
  const pNames: string[] = [];
  for (const [pk, pv] of Object.entries(players)) {
    const meta = (pv as any)?.metadata || {};
    const flag = meta.flag || "🏸";
    pNames.push(`${flag} ${meta.name || pk}`);
  }
  const vsStr = pNames.length > 0 ? pNames.join(" vs ") : matchId;
  const shotCnt = rallies.reduce((acc: number, r: any) => acc + (Array.isArray(r?.shots) ? r.shots.length : 0), 0);
  const src = tel?.source || {};
  const mm = tel?.match_metadata || {};
  return {
    match_id: matchId,
    label: `${vsStr} (${rallies.length} rallies · ${shotCnt} shots)`,
    players_label: vsStr,
    tournament: mm.tournament || "YouTube BWF Match",
    video_path: src.video || "",
    yt_video_id: src.yt_video_id || mm.yt_video_id || "",
    duration_sec: Number(src.duration_sec || 0),
    rallies_count: rallies.length,
    shots_count: shotCnt,
    has_side_swap: Boolean(mm?.compilation_warning?.detected),
    updated_at: Date.now() / 1000,
    cloud_blob: true,
  };
}

export default async (req: Request, _context: Context) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const expectedSecret = Netlify.env.get("HAWKVIEW_CALLBACK_SECRET") || "";
  const providedSecret = req.headers.get("x-hawkview-secret") || "";
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return Response.json({ error: "Unauthorized callback secret" }, { status: 401 });
  }

  let body: Record<string, any> = {};
  try {
    body = (await req.json()) as Record<string, any>;
  } catch {
    return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const jobId = String(body.job_id || "").trim();
  const matchId = String(body.match_id || "").trim();
  if (!jobId || !matchId) {
    return Response.json({ error: "Missing job_id or match_id" }, { status: 400 });
  }

  const jobsStore = getStore("hawkview-jobs");
  const matchesStore = getStore("hawkview-matches");

  const prev = ((await jobsStore.get(`job:${jobId}`, { type: "json" })) as Record<string, any> | null) || {
    job_id: jobId,
    match_id: matchId,
    started_at: Date.now() / 1000,
  };

  if (body.telemetry && typeof body.telemetry === "object") {
    await matchesStore.setJSON(`telemetry:${matchId}`, body.telemetry);
    const meta = summarizeMatch(matchId, body.telemetry);
    await matchesStore.setJSON(`meta:${matchId}`, meta);
  }

  const updatedJob = {
    ...prev,
    mode: "cloud_async",
    status: body.status || prev.status || "running",
    stage: body.stage || prev.stage || "Processing in Cloud...",
    percent: typeof body.percent === "number" ? body.percent : prev.percent || 10,
    message: body.message || prev.message || "",
    rallies_completed: typeof body.rallies_completed === "number" ? body.rallies_completed : prev.rallies_completed || 0,
    rallies_total: typeof body.rallies_total === "number" ? body.rallies_total : prev.rallies_total || 0,
    error: body.error ?? null,
    error_code: body.error_code ?? null,
    updated_at: Date.now() / 1000,
  };

  await jobsStore.setJSON(`job:${jobId}`, updatedJob);

  return Response.json({ ok: true, job_id: jobId, status: updatedJob.status });
};

export const config: Config = {
  path: "/api/cloud-callback",
};
