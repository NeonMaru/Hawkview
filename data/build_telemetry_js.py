"""
Generates js/telemetry-data.js containing both Popov and Su Li Yang datasets.
"""
import json

with open("data/match_telemetry_lzj_vs_popov.json", "r", encoding="utf-8") as f:
    popov_data = json.load(f)

with open("data/match_telemetry_lzj_vs_sly.json", "r", encoding="utf-8") as f:
    sly_data = json.load(f)

js_content = f"""/**
 * Hawkview Multi-Match Telemetry Data Store
 * Supports seamless switching between verified BWF match datasets:
 * - popov: Lee Zii Jia (MAS) vs Christo Popov (FRA) [Arctic Open 2024 QF, Video ID: EhN9qzVe7_g]
 * - sly:   Lee Zii Jia (MAS) vs Su Li Yang (TPE)   [Arctic Open 2024 R16, Video ID: BPv0hE0ugkk]
 *
 * Available globally as:
 * - window.HAWKVIEW_MATCHES (all datasets)
 * - window.HAWKVIEW_TELEMETRY (active dataset, defaults to popov)
 */

window.HAWKVIEW_MATCHES = {{
  "popov": {json.dumps(popov_data, indent=2)},
  "sly": {json.dumps(sly_data, indent=2)}
}};

// Active match key and active telemetry reference
window.HAWKVIEW_ACTIVE_MATCH_KEY = "popov";
window.HAWKVIEW_TELEMETRY = window.HAWKVIEW_MATCHES["popov"];

/**
 * Programmatic helper to switch active match dataset
 * @param {{string}} matchKey - "popov" or "sly"
 */
window.setHawkviewMatch = function(matchKey) {{
  if (!window.HAWKVIEW_MATCHES[matchKey]) {{
    console.warn("[Hawkview] Unknown match key:", matchKey);
    return false;
  }}
  window.HAWKVIEW_ACTIVE_MATCH_KEY = matchKey;
  window.HAWKVIEW_TELEMETRY = window.HAWKVIEW_MATCHES[matchKey];
  console.log("[Hawkview] Active match switched to:", matchKey, window.HAWKVIEW_TELEMETRY.match_metadata.round);
  
  // Dispatch custom event for UI components to re-bind
  if (typeof window.dispatchEvent === 'function') {{
    window.dispatchEvent(new CustomEvent('hawkview:matchChanged', {{ 
      detail: {{ matchKey: matchKey, telemetry: window.HAWKVIEW_TELEMETRY }} 
    }}));
  }}
  return true;
}};
"""

with open("js/telemetry-data.js", "w", encoding="utf-8") as f:
    f.write(js_content)

print(f"Successfully generated js/telemetry-data.js ({len(js_content)} bytes)")
