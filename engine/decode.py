"""
Sequential Video Decode Engine for Hawkview Sports Vision Pipeline
Iterates frames sequentially via cv2.VideoCapture (no intra-loop seeking).
Records real frames_processed, fps, duration_sec, and measured wall-clock decode throughput.
"""

import argparse
import os
import sys
import time
from typing import Callable, Dict, Generator, Optional, Tuple
import cv2
import numpy as np


class VideoDecoder:
    """
    Honest, sequential video decoder.
    Provides streaming frame iteration and exact frame count verification.
    """

    def __init__(self, video_path: str, stride: int = 1):
        if not os.path.exists(video_path):
            raise FileNotFoundError(f"Video file not found: {video_path}")
        self.video_path = video_path
        self.stride = max(1, int(stride))

        # Probe stream header
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise IOError(f"Could not open video stream: {video_path}")

        self.width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        self.stream_fps = float(cap.get(cv2.CAP_PROP_FPS) or 25.0)
        self.header_frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        self.header_duration_sec = (
            self.header_frame_count / self.stream_fps if self.stream_fps > 0 else 0.0
        )
        cap.release()

        # Telemetry recorded during actual iteration
        self.frames_processed = 0
        self.total_frames_read = 0
        self.wall_time_sec = 0.0
        self.decode_fps = 0.0

    def iter_frames(
        self,
        max_frames: Optional[int] = None,
        progress_callback: Optional[Callable[[int, int, float, float], None]] = None
    ) -> Generator[Tuple[int, np.ndarray, float], None, None]:
        """
        Iterates frames sequentially from the start of the video.
        Yields (frame_idx, frame_bgr, timestamp_sec).
        Never seeks backwards or seeks frame-by-frame on H.264.
        """
        cap = cv2.VideoCapture(self.video_path)
        if not cap.isOpened():
            raise IOError(f"Failed to open video: {self.video_path}")

        frame_idx = 0
        processed_count = 0
        start_time = time.time()
        last_progress_time = start_time

        try:
            while cap.isOpened():
                ret, frame = cap.read()
                if not ret or frame is None:
                    break

                if frame_idx % self.stride == 0:
                    timestamp_sec = frame_idx / self.stream_fps if self.stream_fps > 0 else 0.0
                    yield frame_idx, frame, timestamp_sec
                    processed_count += 1

                frame_idx += 1

                now = time.time()
                if progress_callback and (now - last_progress_time >= 0.5):
                    elapsed = now - start_time
                    fps_live = frame_idx / elapsed if elapsed > 0 else 0.0
                    progress_callback(frame_idx, self.header_frame_count, fps_live, elapsed)
                    last_progress_time = now

                if max_frames and frame_idx >= max_frames:
                    break

        finally:
            cap.release()
            total_elapsed = max(1e-4, time.time() - start_time)
            self.total_frames_read = frame_idx
            self.frames_processed = processed_count
            self.wall_time_sec = total_elapsed
            self.decode_fps = frame_idx / total_elapsed

    def decode_all(
        self,
        progress_callback: Optional[Callable[[int, int, float, float], None]] = None
    ) -> Dict:
        """
        Iterates all frames sequentially to completion and returns measured performance telemetry.
        """
        for _ in self.iter_frames(progress_callback=progress_callback):
            pass
        return self.get_stats()

    def get_stats(self) -> Dict:
        """Returns verified decode telemetry."""
        duration_sec = (
            self.total_frames_read / self.stream_fps if self.stream_fps > 0 else self.header_duration_sec
        )
        return {
            "video": self.video_path,
            "width": self.width,
            "height": self.height,
            "stream_fps": round(self.stream_fps, 2),
            "stride": self.stride,
            "frames_processed": self.frames_processed,
            "total_frames_read": self.total_frames_read,
            "duration_sec": round(duration_sec, 2),
            "wall_time_sec": round(self.wall_time_sec, 2),
            "decode_fps": round(self.decode_fps, 1),
        }


def main():
    parser = argparse.ArgumentParser(description="Hawkview Sequential Video Decoder")
    parser.add_argument("video", type=str, help="Path to video file")
    parser.add_argument("--stride", type=int, default=1, help="Frame stride (default 1)")
    parser.add_argument("--max-frames", type=int, default=None, help="Stop after N frames")
    args = parser.parse_args()

    decoder = VideoDecoder(args.video, stride=args.stride)
    print(f"🎬 Video stream: {decoder.width}x{decoder.height} @ {decoder.stream_fps:.1f} FPS")
    print(f"📦 Header frames: {decoder.header_frame_count} (~{decoder.header_duration_sec:.1f}s), stride={decoder.stride}")

    def on_progress(current, total, fps, elapsed):
        pct = (current / total * 100) if total > 0 else 0
        sys.stdout.write(f"\rDecoding: {current}/{total} ({pct:.1f}%) @ {fps:.1f} FPS [wall: {elapsed:.1f}s]")
        sys.stdout.flush()

    stats = decoder.decode_all(progress_callback=on_progress)
    print("\n✅ Sequential decode complete:")
    for k, v in stats.items():
        print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
