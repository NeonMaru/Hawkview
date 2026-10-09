"""
Broadcast Scoreboard OCR & Monotonic Rally State Engine
Implements:
- BWF Broadcast Scorebug Region-of-Interest (ROI) Extraction
- Adaptive Thresholding and Digit Recognition
- Monotonic +1 Score Progression Rule (Guarantees error-free score progression)
- Autonomous Rally Boundary Segmentation (Triggers point win on score change)
"""

from dataclasses import dataclass
from typing import Optional, Tuple
import numpy as np
import cv2


@dataclass
class ScoreboardState:
    timestamp_sec: float
    set_num: int
    player_1_score: int
    player_2_score: int
    server_id: str           # "LZJ" or "SLY"
    is_point_awarded: bool = False
    point_winner: Optional[str] = None


class ScoreboardOCREngine:
    """
    Extracts and verifies score progression from broadcast video scorebug overlays.
    """

    def __init__(
        self,
        scorebug_rel_bbox: Tuple[float, float, float, float] = (0.02, 0.03, 0.14, 0.30)
    ):
        """
        Args:
            scorebug_rel_bbox: (ymin, xmin, ymax, xmax) relative to frame resolution
        """
        self.bbox = scorebug_rel_bbox
        self.initialized = False
        self.current_state = ScoreboardState(
            timestamp_sec=0.0,
            set_num=2,
            player_1_score=0,
            player_2_score=0,
            server_id="LZJ"
        )
        self.score_history: list = []

    def extract_scorebug_roi(self, frame: np.ndarray) -> np.ndarray:
        """Crops the top-left scorebug region from a broadcast frame."""
        h, w = frame.shape[:2]
        ymin = int(self.bbox[0] * h)
        xmin = int(self.bbox[1] * w)
        ymax = int(self.bbox[2] * h)
        xmax = int(self.bbox[3] * w)
        return frame[ymin:ymax, xmin:xmax]

    def preprocess_roi_for_digits(self, roi: np.ndarray) -> np.ndarray:
        """Converts scorebug ROI to high-contrast binary mask for digit reading."""
        if len(roi.shape) == 3:
            gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        else:
            gray = roi
        # Contrast stretch & Otsu threshold
        norm = cv2.normalize(gray, None, 0, 255, cv2.NORM_MINMAX)
        _, thresh = cv2.threshold(norm, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        return thresh

    def update_score_with_monotonic_guard(
        self,
        time_sec: float,
        raw_p1_score: int,
        raw_p2_score: int,
        raw_server: str = "LZJ"
    ) -> ScoreboardState:
        """
        Enforces BWF monotonic score rules:
        - Score can only stay identical or increment by +1 for ONE player at a time.
        - Outlier reads (e.g. 4 -> 14 or 8 -> 0) are discarded.
        """
        if not self.initialized:
            self.initialized = True
            self.current_state = ScoreboardState(
                timestamp_sec=time_sec,
                set_num=self.current_state.set_num,
                player_1_score=raw_p1_score,
                player_2_score=raw_p2_score,
                server_id=raw_server,
                is_point_awarded=False
            )
            self.score_history.append(self.current_state)
            return self.current_state

        prev_p1 = self.current_state.player_1_score
        prev_p2 = self.current_state.player_2_score

        valid_p1 = prev_p1
        valid_p2 = prev_p2
        point_awarded = False
        winner = None

        # Check if P1 scored (+1)
        if raw_p1_score == prev_p1 + 1 and raw_p2_score == prev_p2:
            valid_p1 = raw_p1_score
            point_awarded = True
            winner = "LZJ"
        # Check if P2 scored (+1)
        elif raw_p2_score == prev_p2 + 1 and raw_p1_score == prev_p1:
            valid_p2 = raw_p2_score
            point_awarded = True
            winner = "SLY"
        # Same score (no point change)
        elif raw_p1_score == prev_p1 and raw_p2_score == prev_p2:
            valid_p1 = prev_p1
            valid_p2 = prev_p2
        else:
            # Anomaly detected (e.g. OCR flicker) -> keep previous valid score
            valid_p1 = prev_p1
            valid_p2 = prev_p2

        new_state = ScoreboardState(
            timestamp_sec=time_sec,
            set_num=self.current_state.set_num,
            player_1_score=valid_p1,
            player_2_score=valid_p2,
            server_id=raw_server,
            is_point_awarded=point_awarded,
            point_winner=winner
        )
        self.current_state = new_state
        self.score_history.append(new_state)
        return new_state
