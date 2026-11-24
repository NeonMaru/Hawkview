import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const jobId = (url.searchParams.get("job_id") || "").trim();
  if (!jobId) {
    return Response.json({ error: "Missing job_id parameter" }, { status: 400 });
  }

  const jobsStore = getStore("hawkview-jobs");
  const matchesStore = getStore("hawkview-matches");

  const job = (await jobsStore.get(`job:${jobId}`, { type: "json" })) as Record<string, any> | null;
  if (!job) {
    return Response.json({ error: `Unknown job_id: ${jobId}` }, { status: 404 });
  }

  // Attach streamed or completed telemetry whenever at least 1 rally is ready
  if ((job.status === "completed" || job.status === "ready" || Number(job.rallies_completed || 0) >= 1) && job.match_id) {
    try {
      const telemetry = await matchesStore.get(`telemetry:${job.match_id}`, { type: "json" });
      if (telemetry) {
        job.telemetry = telemetry;
      }
    } catch {
      // Telemetry may still be writing
    }
  }

  return Response.json(job, {
    headers: { "Cache-Control": "no-store" },
  });
};

export const config: Config = {
  path: ["/api/import-youtube-status", "/api/analyze-status"],
};
