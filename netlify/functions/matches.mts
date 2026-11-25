import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";

export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  const matchesStore = getStore("hawkview-matches");
  const defaultQuota = {
    available: true,
    accelerator_tier: "Blackwell G4 Cloud GPU (Mac-Free)",
    balance_cu: 2965.2,
    total_cu: 2965.2,
    used_cu: 0.0,
    remaining_pct: 100.0,
    active_assignments: 0,
  };
  let liveQuota = defaultQuota;
  try {
    const savedQuota = await matchesStore.get("system:colab_quota", { type: "json" });
    if (savedQuota && typeof savedQuota === "object") {
      liveQuota = { ...defaultQuota, ...(savedQuota as Record<string, any>) };
    }
  } catch {
    // Use default until first Blackwell run reports live balance
  }

  if (url.pathname === "/api/colab-quota") {
    return Response.json(
      {
        colab_quota: liveQuota,
        active_eta: null,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
  const reqId = (url.searchParams.get("match_id") || "").trim();
  const origin = url.origin;

  // Single match telemetry request
  if (reqId) {
    try {
      const blobTel = await matchesStore.get(`telemetry:${reqId}`, { type: "json" });
      if (blobTel) {
        return Response.json(
          { match_id: reqId, telemetry: blobTel, source: "netlify_blobs" },
          { headers: { "Cache-Control": "no-store" } }
        );
      }
    } catch {
      // Fall through to static asset
    }

    try {
      const stRes = await fetch(`${origin}/data/matches/${encodeURIComponent(reqId)}/telemetry.json`);
      if (stRes.ok) {
        const tel = await stRes.json();
        return Response.json({ match_id: reqId, telemetry: tel, source: "static_cdn" });
      }
    } catch {
      // Not found
    }

    return Response.json({ error: `Match telemetry not found: ${reqId}` }, { status: 404 });
  }

  // List all matches: merge Netlify Blobs dynamic YouTube matches + bundled static index
  const byId = new Map<string, any>();

  try {
    const idxRes = await fetch(`${origin}/data/matches/index.json`);
    if (idxRes.ok) {
      const idxData = (await idxRes.json()) as any;
      for (const m of idxData?.matches || []) {
        if (m && m.match_id) byId.set(m.match_id, m);
      }
    }
  } catch {
    // No static index
  }

  try {
    const { blobs } = await matchesStore.list({ prefix: "meta:" });
    const metas = await Promise.all(
      blobs.map(async (b) => {
        try {
          return await matchesStore.get(b.key, { type: "json" });
        } catch {
          return null;
        }
      })
    );
    for (const m of metas) {
      if (m && (m as any).match_id && Number((m as any).rallies_count || 0) > 0) {
        byId.set((m as any).match_id, m);
      }
    }
  } catch {
    // Blobs store empty
  }

  const matches = Array.from(byId.values()).sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0));

  return Response.json(
    {
      matches,
      cloud_mode: true,
      colab_quota: liveQuota,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
};

export const config: Config = {
  path: ["/api/matches", "/api/colab-quota"],
};
