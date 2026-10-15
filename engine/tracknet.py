"""
Hawkview TrackNetV3 Shuttlecock Tracking & Trajectory Rectification Module
Implements:
- Deep convolutional encoder-decoder TrackNet (27 input channels: 8 consecutive frames + median background)
- Trajectory inpainting network InpaintNet (1D convolutional temporal inpainting)
- Sliding-window temporal ensembling
- Sub-pixel centroid extraction and coordinate rescaling to broadcast resolution (1920x1080)
- Diagnostic visual probe video generation
"""

import os
import math
from dataclasses import dataclass
from typing import List, Dict, Tuple, Optional
import cv2
import numpy as np
import torch
import torch.nn as nn


# Model input resolution specified by TrackNetV3
NET_WIDTH = 512
NET_HEIGHT = 288
SEQ_LEN = 8


class Conv2DBlock(nn.Module):
    """Conv2D + BatchNorm2D + ReLU"""
    def __init__(self, in_dim: int, out_dim: int):
        super().__init__()
        self.conv = nn.Conv2d(in_dim, out_dim, kernel_size=3, padding='same', bias=False)
        self.bn = nn.BatchNorm2d(out_dim)
        self.relu = nn.ReLU()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.relu(self.bn(self.conv(x)))


class Double2DConv(nn.Module):
    """Two Conv2DBlocks in sequence"""
    def __init__(self, in_dim: int, out_dim: int):
        super().__init__()
        self.conv_1 = Conv2DBlock(in_dim, out_dim)
        self.conv_2 = Conv2DBlock(out_dim, out_dim)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.conv_2(self.conv_1(x))


class Triple2DConv(nn.Module):
    """Three Conv2DBlocks in sequence"""
    def __init__(self, in_dim: int, out_dim: int):
        super().__init__()
        self.conv_1 = Conv2DBlock(in_dim, out_dim)
        self.conv_2 = Conv2DBlock(out_dim, out_dim)
        self.conv_3 = Conv2DBlock(out_dim, out_dim)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.conv_3(self.conv_2(self.conv_1(x)))


class TrackNet(nn.Module):
    """U-Net architecture for shuttlecock heatmap detection"""
    def __init__(self, in_dim: int = 27, out_dim: int = 8):
        super().__init__()
        self.down_block_1 = Double2DConv(in_dim, 64)
        self.down_block_2 = Double2DConv(64, 128)
        self.down_block_3 = Triple2DConv(128, 256)
        self.bottleneck = Triple2DConv(256, 512)
        self.up_block_1 = Triple2DConv(768, 256)
        self.up_block_2 = Double2DConv(384, 128)
        self.up_block_3 = Double2DConv(192, 64)
        self.predictor = nn.Conv2d(64, out_dim, (1, 1))
        self.sigmoid = nn.Sigmoid()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x1 = self.down_block_1(x)                                   # (N,  64, 288, 512)
        x = nn.MaxPool2d((2, 2))(x1)                                # (N,  64, 144, 256)
        x2 = self.down_block_2(x)                                   # (N, 128, 144, 256)
        x = nn.MaxPool2d((2, 2))(x2)                                # (N, 128,  72, 128)
        x3 = self.down_block_3(x)                                   # (N, 256,  72, 128)
        x = nn.MaxPool2d((2, 2))(x3)                                # (N, 256,  36,  64)
        x = self.bottleneck(x)                                      # (N, 512,  36,  64)
        x = torch.cat([nn.Upsample(scale_factor=2)(x), x3], dim=1)  # (N, 768,  72, 128)
        x = self.up_block_1(x)                                      # (N, 256,  72, 128)
        x = torch.cat([nn.Upsample(scale_factor=2)(x), x2], dim=1)  # (N, 384, 144, 256)
        x = self.up_block_2(x)                                      # (N, 128, 144, 256)
        x = torch.cat([nn.Upsample(scale_factor=2)(x), x1], dim=1)  # (N, 192, 288, 512)
        x = self.up_block_3(x)                                      # (N,  64, 288, 512)
        return self.sigmoid(self.predictor(x))                      # (N,   8, 288, 512)


class Conv1DBlock(nn.Module):
    """Conv1D + LeakyReLU"""
    def __init__(self, in_dim: int, out_dim: int):
        super().__init__()
        self.conv = nn.Conv1d(in_dim, out_dim, kernel_size=3, padding='same', bias=True)
        self.relu = nn.LeakyReLU()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.relu(self.conv(x))


class Double1DConv(nn.Module):
    """Two Conv1DBlocks in sequence"""
    def __init__(self, in_dim: int, out_dim: int):
        super().__init__()
        self.conv_1 = Conv1DBlock(in_dim, out_dim)
        self.conv_2 = Conv1DBlock(out_dim, out_dim)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.conv_2(self.conv_1(x))


class InpaintNet(nn.Module):
    """1D ConvNet for temporal trajectory inpainting of occluded shuttlecocks"""
    def __init__(self):
        super().__init__()
        self.down_1 = Conv1DBlock(3, 32)
        self.down_2 = Conv1DBlock(32, 64)
        self.down_3 = Conv1DBlock(64, 128)
        self.buttleneck = Double1DConv(128, 256)
        self.up_1 = Conv1DBlock(384, 128)
        self.up_2 = Conv1DBlock(192, 64)
        self.up_3 = Conv1DBlock(96, 32)
        self.predictor = nn.Conv1d(32, 2, 3, padding='same')
        self.sigmoid = nn.Sigmoid()

    def forward(self, x: torch.Tensor, m: torch.Tensor) -> torch.Tensor:
        # x: (N, L, 2), m: (N, L, 1)
        x = torch.cat([x, m], dim=2)                                # (N, L, 3)
        x = x.permute(0, 2, 1)                                      # (N, 3, L)
        x1 = self.down_1(x)                                         # (N, 32, L)
        x2 = self.down_2(x1)                                        # (N, 64, L)
        x3 = self.down_3(x2)                                        # (N, 128, L)
        x = self.buttleneck(x3)                                     # (N, 256, L)
        x = torch.cat([x, x3], dim=1)                               # (N, 384, L)
        x = self.up_1(x)                                            # (N, 128, L)
        x = torch.cat([x, x2], dim=1)                               # (N, 192, L)
        x = self.up_2(x)                                            # (N, 64, L)
        x = torch.cat([x, x1], dim=1)                               # (N, 96, L)
        x = self.up_3(x)                                            # (N, 32, L)
        x = self.predictor(x)                                       # (N, 2, L)
        x = self.sigmoid(x)
        return x.permute(0, 2, 1)                                   # (N, L, 2)


def get_ensemble_weights(seq_len: int = 8) -> np.ndarray:
    """Positional weights for temporal ensembling (higher in middle, lower at ends)"""
    weight = np.ones(seq_len, dtype=np.float32)
    for i in range(math.ceil(seq_len / 2)):
        weight[i] = i + 1
        weight[seq_len - i - 1] = i + 1
    return weight / weight.sum()


def extract_location_from_heatmap(heatmap: np.ndarray, threshold: float = 0.5) -> Tuple[float, float, int]:
    """
    Extracts centroid coordinates from heatmap.
    Returns (x_net, y_net, visibility).
    """
    if np.max(heatmap) <= threshold:
        return 0.0, 0.0, 0

    mask = (heatmap > threshold).astype(np.uint8) * 255
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return 0.0, 0.0, 0

    # Pick largest contour by area
    largest = max(cnts, key=cv2.contourArea)
    M = cv2.moments(largest)
    if M["m00"] > 1e-4:
        cx = M["m10"] / M["m00"]
        cy = M["m01"] / M["m00"]
    else:
        x, y, w, h = cv2.boundingRect(largest)
        cx = x + w / 2.0
        cy = y + h / 2.0

    return float(cx), float(cy), 1


class TrackNetV3Pipeline:
    """High-performance TrackNetV3 & InpaintNet inference runner."""

    def __init__(
        self,
        tracknet_weights: str = "engine/weights/TrackNet_best.pt",
        inpaintnet_weights: str = "engine/weights/InpaintNet_best.pt",
        device: Optional[str] = None
    ):
        if device is None:
            if torch.backends.mps.is_available():
                self.device = torch.device("mps")
            elif torch.cuda.is_available():
                self.device = torch.device("cuda")
            else:
                self.device = torch.device("cpu")
        else:
            self.device = torch.device(device)

        # 1. Load TrackNet
        self.tracknet = TrackNet(in_dim=27, out_dim=8).to(self.device)
        t_ckpt = torch.load(tracknet_weights, map_location=self.device)
        self.tracknet.load_state_dict(t_ckpt["model"] if "model" in t_ckpt else t_ckpt)
        self.tracknet.eval()

        # 2. Load InpaintNet
        self.inpaintnet = None
        if os.path.exists(inpaintnet_weights):
            self.inpaintnet = InpaintNet().to(self.device)
            i_ckpt = torch.load(inpaintnet_weights, map_location=self.device)
            self.inpaintnet.load_state_dict(i_ckpt["model"] if "model" in i_ckpt else i_ckpt)
            self.inpaintnet.eval()

    def track_rally(
        self,
        frames_bgr: List[np.ndarray],
        start_frame_idx: int = 0,
        batch_size: int = 8,
        use_ensemble: bool = True
    ) -> List[Dict]:
        """
        Runs TrackNetV3 and InpaintNet on a list of frames from an active rally.
        Returns per-frame detection dicts:
        [{'frame': idx, 'x': x_px, 'y': y_px, 'visibility': 0 or 1, 'inpainted': bool}, ...]
        """
        num_frames = len(frames_bgr)
        if num_frames == 0:
            return []

        orig_h, orig_w = frames_bgr[0].shape[:2]
        scale_x = orig_w / float(NET_WIDTH)
        scale_y = orig_h / float(NET_HEIGHT)

        # Step 1: Preprocess frames (resize to 512x288, convert to RGB, normalize)
        rgb_frames = [
            cv2.resize(cv2.cvtColor(f, cv2.COLOR_BGR2RGB), (NET_WIDTH, NET_HEIGHT))
            for f in frames_bgr
        ]

        # Median background estimation across rally
        sample_step = max(1, num_frames // 40)
        sampled_frames = rgb_frames[::sample_step]
        median_bg = np.median(sampled_frames, axis=0).astype(np.float32) / 255.0
        median_ch = np.transpose(median_bg, (2, 0, 1))  # (3, 288, 512)

        # Prepare normalized tensor channels for all frames
        frame_tensors = [
            np.transpose(f.astype(np.float32) / 255.0, (2, 0, 1))
            for f in rgb_frames
        ]

        # Step 2: Temporal Ensembling or Sliding Window Inference
        # Accumulate weighted heatmap sum and weight totals per frame
        accum_heatmaps = np.zeros((num_frames, NET_HEIGHT, NET_WIDTH), dtype=np.float32)
        accum_weights = np.zeros(num_frames, dtype=np.float32)
        weights = get_ensemble_weights(SEQ_LEN) if use_ensemble else np.ones(SEQ_LEN, dtype=np.float32) / SEQ_LEN

        sliding_step = 2 if use_ensemble else SEQ_LEN
        windows = []
        for i in range(0, num_frames - SEQ_LEN + 1, sliding_step):
            windows.append(i)
        if (num_frames - SEQ_LEN) not in windows and num_frames >= SEQ_LEN:
            windows.append(num_frames - SEQ_LEN)

        # Batched inference
        for b_start in range(0, len(windows), batch_size):
            b_indices = windows[b_start : b_start + batch_size]
            b_inputs = []
            for w_idx in b_indices:
                w_channels = [median_ch]
                for s in range(SEQ_LEN):
                    w_channels.append(frame_tensors[w_idx + s])
                b_inputs.append(np.concatenate(w_channels, axis=0))

            inp_tensor = torch.from_numpy(np.stack(b_inputs, axis=0)).to(self.device)
            with torch.no_grad():
                out_heatmaps = self.tracknet(inp_tensor).cpu().numpy()  # (B, 8, 288, 512)

            for b_i, w_idx in enumerate(b_indices):
                for s in range(SEQ_LEN):
                    f_idx = w_idx + s
                    w = weights[s]
                    accum_heatmaps[f_idx] += out_heatmaps[b_i, s] * w
                    accum_weights[f_idx] += w

        # Handle any boundary frames
        valid_mask = accum_weights > 1e-4
        accum_heatmaps[valid_mask] /= accum_weights[valid_mask, None, None]

        # Step 3: Extract coordinates from final heatmaps
        raw_detections = []
        for i in range(num_frames):
            frame_no = start_frame_idx + i
            if accum_weights[i] <= 1e-4:
                raw_detections.append({
                    "frame": frame_no,
                    "x": 0.0,
                    "y": 0.0,
                    "visibility": 0,
                    "inpainted": False
                })
                continue

            cx, cy, vis = extract_location_from_heatmap(accum_heatmaps[i], threshold=0.5)
            raw_detections.append({
                "frame": frame_no,
                "x": cx * scale_x if vis else 0.0,
                "y": cy * scale_y if vis else 0.0,
                "visibility": vis,
                "inpainted": False
            })

        # Step 3.5: Raw-detection speed gate (drop raw detections > 250 px from neighbours within 2 frames)
        raw_detections, dropped_frames = self._apply_raw_speed_gate(
            raw_detections, max_jump_px=250.0, neighbor_window=2
        )
        self.last_dropped_frames = dropped_frames
        self.last_dropped_count = len(dropped_frames)

        # Step 4: InpaintNet Trajectory Rectification (with 0.05 * H top-of-frame ceiling gate)
        if self.inpaintnet is not None and num_frames >= 16:
            raw_detections = self._apply_inpaintnet(raw_detections, orig_w, orig_h)

        return raw_detections

    def _apply_raw_speed_gate(
        self,
        detections: List[Dict],
        max_jump_px: float = 250.0,
        neighbor_window: int = 2
    ) -> Tuple[List[Dict], List[int]]:
        """
        Before inpainting, drops any raw detection that is more than max_jump_px (250 px)
        from both its visible neighbours within neighbor_window (2) frames.
        Returns (filtered_detections, dropped_frame_numbers).
        """
        num_frames = len(detections)
        to_drop = []
        dropped_frame_nums = []

        for i in range(num_frames):
            if detections[i]["visibility"] != 1:
                continue
            prev_n = [
                detections[j]
                for j in range(max(0, i - neighbor_window), i)
                if detections[j]["visibility"] == 1
            ]
            next_n = [
                detections[j]
                for j in range(i + 1, min(num_frames, i + neighbor_window + 1))
                if detections[j]["visibility"] == 1
            ]
            if not prev_n and not next_n:
                continue

            far_prev = (
                all(
                    math.hypot(detections[i]["x"] - p["x"], detections[i]["y"] - p["y"]) > max_jump_px
                    for p in prev_n
                )
                if prev_n
                else True
            )
            far_next = (
                all(
                    math.hypot(detections[i]["x"] - n["x"], detections[i]["y"] - n["y"]) > max_jump_px
                    for n in next_n
                )
                if next_n
                else True
            )

            if far_prev and far_next:
                to_drop.append(i)
                dropped_frame_nums.append(int(detections[i]["frame"]))

        for i in to_drop:
            detections[i]["x"] = 0.0
            detections[i]["y"] = 0.0
            detections[i]["visibility"] = 0
            detections[i]["dropped_outlier"] = True

        return detections, dropped_frame_nums

    def _apply_inpaintnet(self, detections: List[Dict], width: int, height: int) -> List[Dict]:
        """
        Uses InpaintNet to temporally bridge occlusion gaps.
        Matches official TrackNetV3 generate_inpaint_mask:
        - Only fills a gap when BOTH the last detection before it and the first detection
          after it are below 0.05 * frame_height from the top edge (y > th_h).
        - Requires gap endpoints to be within 250 px/frame so disconnected tracks are not bridged.
        - Uses sliding_step=1 weighted temporal ensembling across 16-frame windows.
        """
        num_frames = len(detections)
        xs = np.array([d["x"] for d in detections], dtype=np.float32)
        ys = np.array([d["y"] for d in detections], dtype=np.float32)
        vis = np.array([d["visibility"] for d in detections], dtype=np.int32)

        # Top-of-frame ceiling threshold (5% of frame height = 54 px on 1080p)
        th_h = float(height) * 0.05

        # Generate inpaint mask
        inpaint_mask = np.zeros(num_frames, dtype=np.float32)
        i = 0
        while i < num_frames:
            if vis[i] == 0:
                gap_start = i
                while i < num_frames and vis[i] == 0:
                    i += 1
                gap_end = i
                gap_len = gap_end - gap_start
                # Bounded by visible detections on both sides, gap <= 12 frames,
                # both boundary detections below top 5% ceiling border, and reachable speed
                if gap_start > 0 and gap_end < num_frames and gap_len <= 12:
                    if ys[gap_start - 1] > th_h and ys[gap_end] > th_h:
                        gap_dist = math.hypot(
                            float(xs[gap_end] - xs[gap_start - 1]),
                            float(ys[gap_end] - ys[gap_start - 1])
                        )
                        if gap_dist <= 250.0 * (gap_len + 1):
                            inpaint_mask[gap_start:gap_end] = 1.0
            else:
                i += 1

        if np.sum(inpaint_mask) == 0:
            return detections

        # Slide 16-frame windows with step=1 and positional ensemble weights
        inpaint_len = 16
        weights = get_ensemble_weights(inpaint_len)
        accum_coords = np.zeros((num_frames, 2), dtype=np.float32)
        accum_weights = np.zeros(num_frames, dtype=np.float32)
        norm_coords = np.stack([xs / float(width), ys / float(height)], axis=-1)

        for w_start in range(0, num_frames - inpaint_len + 1, 1):
            w_mask = inpaint_mask[w_start : w_start + inpaint_len]
            w_norm = norm_coords[w_start : w_start + inpaint_len]
            if np.sum(w_mask) == 0:
                for s in range(inpaint_len):
                    accum_coords[w_start + s] += w_norm[s] * weights[s]
                    accum_weights[w_start + s] += weights[s]
                continue

            t_x = torch.from_numpy(w_norm).unsqueeze(0).to(self.device)
            t_m = torch.from_numpy(w_mask).reshape(1, inpaint_len, 1).to(self.device)

            with torch.no_grad():
                pred_c = self.inpaintnet(t_x, t_m)[0].cpu().numpy()

            blended = pred_c * w_mask[:, None] + w_norm * (1.0 - w_mask[:, None])
            for s in range(inpaint_len):
                accum_coords[w_start + s] += blended[s] * weights[s]
                accum_weights[w_start + s] += weights[s]

        coor_th = 10.0
        for idx in range(num_frames):
            if inpaint_mask[idx] == 1.0 and accum_weights[idx] > 1e-6:
                cx = float((accum_coords[idx, 0] / accum_weights[idx]) * width)
                cy = float((accum_coords[idx, 1] / accum_weights[idx]) * height)
                if cx >= coor_th and cy >= coor_th:
                    detections[idx]["x"] = cx
                    detections[idx]["y"] = cy
                    detections[idx]["visibility"] = 1
                    detections[idx]["inpainted"] = True

        return detections

    def render_diagnostic_video(
        self,
        frames_bgr: List[np.ndarray],
        detections: List[Dict],
        output_path: str,
        fps: float = 25.0,
        trail_len: int = 8
    ):
        """
        Renders an overlay diagnostic video showing the detected shuttlecock with
        glowing cyan/magenta circle and trajectory tail.
        """
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
        h, w = frames_bgr[0].shape[:2]
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        writer = cv2.VideoWriter(output_path, fourcc, fps, (w, h))

        trail_points = []

        for i, frame in enumerate(frames_bgr):
            canvas = frame.copy()
            det = detections[i]
            frame_idx = det["frame"]
            vis = det["visibility"]
            is_inpainted = det.get("inpainted", False)

            if vis and det["x"] > 0 and det["y"] > 0:
                pt = (int(round(det["x"])), int(round(det["y"])))
                trail_points.append(pt)
            else:
                trail_points.append(None)

            if len(trail_points) > trail_len:
                trail_points.pop(0)

            # Draw trajectory tail
            for t_i in range(1, len(trail_points)):
                p1 = trail_points[t_i - 1]
                p2 = trail_points[t_i]
                if p1 is not None and p2 is not None:
                    alpha = t_i / float(len(trail_points))
                    thick = max(1, int(round(alpha * 4)))
                    # Cyan/magenta gradient
                    color = (255, int(150 * alpha), int(255 * (1 - alpha)))
                    cv2.line(canvas, p1, p2, color, thick)

            # Draw glowing dot on current position
            if vis and det["x"] > 0 and det["y"] > 0:
                pt = (int(round(det["x"])), int(round(det["y"])))
                # Outer glow
                glow_color = (0, 165, 255) if is_inpainted else (255, 0, 255)  # Orange if inpainted, Magenta if TrackNet
                cv2.circle(canvas, pt, 8, glow_color, 2)
                # Inner solid dot
                cv2.circle(canvas, pt, 4, (255, 255, 255), -1)

            # HUD overlay
            hud_text = f"FRAME {frame_idx:05d} | SHUTTLE: ({det['x']:.1f}, {det['y']:.1f}) | VIS: {vis}"
            if is_inpainted:
                hud_text += " [INPAINTED]"
            cv2.putText(canvas, hud_text, (40, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)

            writer.write(canvas)

        writer.release()
        return output_path


@dataclass
class ShuttleDetection:
    frame_idx: int
    timestamp_sec: float
    pixel_x: float
    pixel_y: float
    confidence: float
    is_interpolated: bool = False


class TrackNetProcessor:
    """
    Sub-pixel heatmap extraction and trajectory utility class kept for compatibility
    with pipeline.py and test_physics_engine.py.
    """

    def __init__(
        self,
        input_width: int = 640,
        input_height: int = 360,
        detection_threshold: float = 0.50,
        max_velocity_kmh: float = 550.0
    ):
        self.input_width = input_width
        self.input_height = input_height
        self.threshold = detection_threshold
        self.max_velocity_kmh = max_velocity_kmh
        self.frame_buffer: List[np.ndarray] = []

    def extract_peak_from_heatmap(
        self,
        heatmap: np.ndarray,
        orig_width: int,
        orig_height: int
    ) -> Optional[Tuple[float, float, float]]:
        min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(heatmap)
        if max_val < self.threshold:
            return None

        px, py = max_loc
        h, w = heatmap.shape
        half = 2
        y1, y2 = max(0, py - half), min(h, py + half + 1)
        x1, x2 = max(0, px - half), min(w, px + half + 1)

        patch = heatmap[y1:y2, x1:x2]
        sum_weights = np.sum(patch)
        if sum_weights > 1e-6:
            ys, xs = np.mgrid[y1:y2, x1:x2]
            sub_x = float(np.sum(xs * patch) / sum_weights)
            sub_y = float(np.sum(ys * patch) / sum_weights)
        else:
            sub_x, sub_y = float(px), float(py)

        orig_x = (sub_x / float(w)) * float(orig_width)
        orig_y = (sub_y / float(h)) * float(orig_height)
        return orig_x, orig_y, float(max_val)

