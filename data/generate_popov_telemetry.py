"""
Deprecated: generate_popov_telemetry.py
Synthetic and simulated telemetry generation has been retired per docs/plans/shot-explorer-plan.md.
Real telemetry is extracted via the computer vision pipeline (engine/pipeline.py).
"""

import json
import os

def create_popov_dataset():
    """Returns baseline match metadata without simulated rallies or stats."""
    match_file = "data/matches/lzj_popov/match.json"
    if os.path.exists(match_file):
        with open(match_file, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"match_id": "lzj_popov", "rallies": [], "players": {}}

if __name__ == "__main__":
    print("generate_popov_telemetry.py is deprecated. Use engine/pipeline.py for real CV telemetry.")
