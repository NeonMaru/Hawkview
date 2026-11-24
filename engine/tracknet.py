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
    Extracts probability-weighted sub-pixel centroid (Center-of-Heatmap) from the best
    compact high-probability peak so wide blurry false-positive blobs (shoes, floor glare)
    cannot beat a sharp compact shuttlecock peak.
    Returns (x_net, y_net, visibility).
    """
    if np.max(heatmap) <= threshold:
        return 0.0, 0.0, 0

    mask = (heatmap > threshold).astype(np.uint8) * 255
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return 0.0, 0.0, 0

    def score_contour(c) -> float:
        bx, by, bw, bh = cv2.boundingRect(c)
        patch = heatmap[by : by + bh, bx : bx + bw]
        peak = float(np.max(patch)) if patch.size > 0 else 0.5
        area = float(cv2.contourArea(c))
        # Reward high peak confidence and compact shuttle size (~2-12 px^2 in 512x288);
        # penalize wide diffuse false-positive blobs (shoes, net banners, glare).
        compact_penalty = 1.0 + max(0.0, area - 12.0) / 14.0
        return (peak * peak) / compact_penalty

    best_c = max(cnts, key=score_contour)
    bx, by, bw, bh = cv2.boundingRect(best_c)
    x0 = max(0, bx - 1)
    y0 = max(0, by - 1)
    x1 = min(heatmap.shape[1], bx + bw + 1)
    y1 = min(heatmap.shape[0], by + bh + 1)
    patch = np.maximum(0.0, heatmap[y0:y1, x0:x1] - threshold * 0.5)
    w_sum = float(np.sum(patch))
    if w_sum > 1e-6:
        ys_g, xs_g = np.mgrid[y0:y1, x0:x1]
        cx = float(np.sum(xs_g * patch) / w_sum)
        cy = float(np.sum(ys_g * patch) / w_sum)
    else:
        M = cv2.moments(best_c)
        if M["m00"] > 1e-4:
            cx = M["m10"] / M["m00"]
            cy = M["m01"] / M["m00"]
        else:
            cx = bx + bw / 2.0
            cy = by + bh / 2.0

    return float(cx), float(cy), 1


def extract_top_k_peaks(
    heatmap: np.ndarray,
    motion_map: Optional[np.ndarray] = None,
    static_freq: Optional[np.ndarray] = None,
    k: int = 4,
    threshold: float = 0.22,
    nms_radius: int = 4,
) -> List[Tuple[float, float, float, float, float]]:
    """
    Extracts up to `k` local-maxima peaks above `threshold` from a 288x512 TrackNet heatmap
    using morphological NMS + 5x5 probability-weighted Center-of-Heatmap sub-pixel centroids.
    Returns list of (cx_net, cy_net, peak_conf, motion_energy, static_freq_val).
    """
    if float(np.max(heatmap)) < threshold:
        return []

    ksize = 2 * nms_radius + 1
    kernel = np.ones((ksize, ksize), dtype=np.uint8)
    dilated = cv2.dilate(heatmap, kernel)
    is_peak = (heatmap >= dilated) & (heatmap >= threshold)
    py_arr, px_arr = np.where(is_peak)
    if len(px_arr) == 0:
        return []

    confs = heatmap[py_arr, px_arr]
    order = np.argsort(-confs)[: max(k * 2, 8)]
    h, w = heatmap.shape[:2]

    peaks: List[Tuple[float, float, float, float, float]] = []
    for idx in order:
        px = int(px_arr[idx])
        py = int(py_arr[idx])
        # Suppress duplicate peaks within nms_radius (flat plateaus)
        if any((px - p[0]) ** 2 + (py - p[1]) ** 2 <= (nms_radius + 1) ** 2 for p in peaks):
            continue
        conf = float(heatmap[py, px])
        x0, x1 = max(0, px - 2), min(w, px + 3)
        y0, y1 = max(0, py - 2), min(h, py + 3)
        patch = np.maximum(0.0, heatmap[y0:y1, x0:x1] - 0.5 * threshold)
        w_sum = float(np.sum(patch))
        if w_sum > 1e-6:
            ys_g, xs_g = np.mgrid[y0:y1, x0:x1]
            cx = float(np.sum(xs_g * patch) / w_sum)
            cy = float(np.sum(ys_g * patch) / w_sum)
        else:
            cx, cy = float(px), float(py)

        m_val = float(np.max(motion_map[y0:y1, x0:x1])) if motion_map is not None else 12.0
        s_val = float(np.max(static_freq[y0:y1, x0:x1])) if static_freq is not None else 0.0
        peaks.append((cx, cy, conf, m_val, s_val))
        if len(peaks) >= k:
            break

    return peaks


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

        # 1. Load TrackNet (automatically fall back to 43MB slim weights on cloud runners)
        resolved_tn = tracknet_weights
        if not os.path.exists(resolved_tn):
            slim_cand = os.path.join(os.path.dirname(tracknet_weights) or "engine/weights", "TrackNet_infer_slim.pt")
            if os.path.exists(slim_cand):
                resolved_tn = slim_cand
        self.tracknet = TrackNet(in_dim=27, out_dim=8).to(self.device)
        try:
            t_ckpt = torch.load(resolved_tn, map_location=self.device, weights_only=False)
        except TypeError:
            t_ckpt = torch.load(resolved_tn, map_location=self.device)
        self.tracknet.load_state_dict(t_ckpt["model"] if "model" in t_ckpt else t_ckpt)
        self.tracknet.eval()

        # 2. Load InpaintNet
        self.inpaintnet = None
        if os.path.exists(inpaintnet_weights):
            self.inpaintnet = InpaintNet().to(self.device)
            try:
                i_ckpt = torch.load(inpaintnet_weights, map_location=self.device, weights_only=False)
            except TypeError:
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

        sliding_step = (1 if self.device.type == "cuda" else 2) if use_ensemble else SEQ_LEN
        windows = []
        for i in range(0, num_frames - SEQ_LEN + 1, sliding_step):
            windows.append(i)
        if (num_frames - SEQ_LEN) not in windows and num_frames >= SEQ_LEN:
            windows.append(num_frames - SEQ_LEN)

        # Batched inference (with FP16 autocast on CUDA for ~2x speedup)
        use_cuda_amp = (self.device.type == "cuda")
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
                if use_cuda_amp:
                    with torch.amp.autocast("cuda"):
                        out_heatmaps = self.tracknet(inp_tensor).float().cpu().numpy()
                else:
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

        # Step 2.5: Compute frame-difference motion maps & soft static-peak frequency map
        gray_net = [cv2.cvtColor(f, cv2.COLOR_RGB2GRAY).astype(np.float32) for f in rgb_frames]
        motion_maps: List[np.ndarray] = []
        for i in range(num_frames):
            if i == 0:
                m_map = np.abs(gray_net[min(1, num_frames - 1)] - gray_net[0])
            elif i == num_frames - 1:
                m_map = np.abs(gray_net[i] - gray_net[i - 1])
            else:
                m_map = 0.5 * (np.abs(gray_net[i] - gray_net[i - 1]) + np.abs(gray_net[i + 1] - gray_net[i]))
            motion_maps.append(m_map)

        hot_freq = np.mean(accum_heatmaps > 0.30, axis=0) if num_frames >= 20 else np.zeros((NET_HEIGHT, NET_WIDTH), dtype=np.float32)
        if num_frames >= 20:
            # Softly damp persistently firing static spots (logos, scorebug corners, court line junctions)
            static_mask = (hot_freq > max(0.10, 7.0 / float(num_frames))).astype(np.uint8)
            if np.any(static_mask):
                kernel = np.ones((3, 3), dtype=np.uint8)
                static_mask_dil = cv2.dilate(static_mask, kernel, iterations=1) > 0
                accum_heatmaps[:, static_mask_dil] *= 0.20

        # Step 3: Multi-Peak (Top-K) Extraction + Viterbi/DP Multi-Hypothesis Graph Linking
        sy = max(0.35, float(orig_h) / 1080.0)
        peaks_per_frame: List[List[Tuple[float, float, float, float, float]]] = []
        for i in range(num_frames):
            if accum_weights[i] <= 1e-4:
                peaks_per_frame.append([])
                continue
            pks_net = extract_top_k_peaks(
                accum_heatmaps[i],
                motion_map=motion_maps[i],
                static_freq=hot_freq,
                k=4,
                threshold=0.22,
                nms_radius=4,
            )
            peaks_per_frame.append([
                (cx * scale_x, cy * scale_y, conf, m_val, s_val)
                for (cx, cy, conf, m_val, s_val) in pks_net
            ])

        raw_detections = self._link_peaks_viterbi(
            peaks_per_frame=peaks_per_frame,
            start_frame_idx=start_frame_idx,
            orig_w=orig_w,
            orig_h=orig_h,
        )

        # Step 3.5: Resolution-scaled raw-detection speed & stationary-lock gate
        raw_detections, dropped_frames = self._apply_raw_speed_gate(
            raw_detections,
            max_jump_px=210.0 * sy,
            neighbor_window=2,
            orig_h=orig_h,
        )
        self.last_dropped_frames = dropped_frames
        self.last_dropped_count = len(dropped_frames)

        # Step 4: InpaintNet Trajectory Rectification (with 0.05 * H ceiling gate & masked-zero fix)
        if self.inpaintnet is not None and num_frames >= 16:
            raw_detections = self._apply_inpaintnet(raw_detections, orig_w, orig_h)

        return raw_detections

    def _link_peaks_viterbi(
        self,
        peaks_per_frame: List[List[Tuple[float, float, float, float, float]]],
        start_frame_idx: int,
        orig_w: int,
        orig_h: int,
    ) -> List[Dict]:
        """
        Global Viterbi / Dynamic Programming multi-peak trajectory linker (zero-LLM, <30ms CPU).
        Evaluates top-K candidate heatmap peaks per frame plus a Null/Occluded state with skip-edges
        (dt in 1..4 frames) and velocity-consistency + bounded hit-reversal transition costs.
        Eliminates single-frame teleports onto white shoes, net tape, and stationary logos while
        rescuing low-confidence (0.22-0.49) true shuttle peaks that lie on the ballistic trajectory.
        """
        T = len(peaks_per_frame)
        if T == 0:
            return []

        sy = max(0.35, float(orig_h) / 1080.0)
        max_step_px = 185.0 * sy  # ~450+ km/h near camera at 25fps
        null_score_base = -1.65
        ceiling_y = 0.08 * float(orig_h)

        # Build padded candidate arrays: states 0..K-1 are peaks, state K is Null (invisible)
        K = 4
        S = K + 1
        dp = np.full((T, S), -1e9, dtype=np.float64)
        back_t = np.full((T, S), -1, dtype=np.int32)
        back_s = np.full((T, S), K, dtype=np.int32)
        # Store incoming velocity (vx, vy) for each best path reaching (t, s)
        vel_x = np.zeros((T, S), dtype=np.float64)
        vel_y = np.zeros((T, S), dtype=np.float64)
        has_vel = np.zeros((T, S), dtype=bool)

        def unary_peak(pk: Tuple[float, float, float, float, float]) -> float:
            x, y, conf, m_val, s_val = pk
            # Reward strong probability and real pixel motion; penalize static hot spots
            conf_term = 2.8 * math.log(max(conf, 0.05) / 0.35)
            motion_term = 0.45 * math.log(1.0 + max(0.0, m_val) / 4.0) - (1.1 if m_val < 2.2 else 0.0)
            static_term = -5.5 * max(0.0, s_val - 0.08)
            return conf_term + motion_term + static_term

        # Initialize t = 0
        for k, pk in enumerate(peaks_per_frame[0][:K]):
            dp[0, k] = unary_peak(pk)
        dp[0, K] = null_score_base

        # Forward DP pass with skip-edges dt in {1, 2, 3, 4}
        for t in range(1, T):
            pks_t = peaks_per_frame[t][:K]
            # 1. Null state transition from t - 1
            best_null_val = -1e9
            best_null_prev = K
            for prev_s in range(S):
                val = dp[t - 1, prev_s]
                if val <= -1e8:
                    continue
                # Lower miss penalty when previous detection was leaving the top ceiling
                miss_cost = -0.35 if (prev_s < K and prev_s < len(peaks_per_frame[t - 1]) and peaks_per_frame[t - 1][prev_s][1] < ceiling_y) else null_score_base
                cand_v = val + miss_cost
                if cand_v > best_null_val:
                    best_null_val = cand_v
                    best_null_prev = prev_s
            dp[t, K] = best_null_val
            back_t[t, K] = t - 1
            back_s[t, K] = best_null_prev

            # 2. Candidate peak states k in 0..len(pks_t)-1
            for k, pk in enumerate(pks_t):
                x, y, conf, m_val, s_val = pk
                u_val = unary_peak(pk)
                best_val = -1e9
                best_pt = t - 1
                best_ps = K
                best_vx, best_vy, best_hv = 0.0, 0.0, False

                # Option A: Re-acquire track from Null state at t - 1 (requires higher confidence >= 0.46)
                if dp[t - 1, K] > -1e8 and conf >= 0.46:
                    reacq_pen = -1.25
                    cand_v = dp[t - 1, K] + u_val + reacq_pen
                    if cand_v > best_val:
                        best_val = cand_v
                        best_pt = t - 1
                        best_ps = K
                        best_hv = False

                # Option B: Link from a visible peak at t - dt (dt in 1..4)
                max_dt = min(4, t)
                for dt in range(1, max_dt + 1):
                    pt = t - dt
                    pks_prev = peaks_per_frame[pt][:K]
                    skip_pen = -0.65 * (dt - 1)
                    for ps, ppk in enumerate(pks_prev):
                        if dp[pt, ps] <= -1e8:
                            continue
                        dx = x - ppk[0]
                        dy = y - ppk[1]
                        dist = math.hypot(dx, dy)
                        step_speed = dist / float(dt)
                        if step_speed > max_step_px:
                            continue
                        vx = dx / float(dt)
                        vy = dy / float(dt)

                        # Smooth ballistic transition vs capped hit-reversal impulse
                        if has_vel[pt, ps]:
                            # Projected gravity in image space is ~+1.6*sy px/frame^2 downward
                            acc = math.hypot(vx - vel_x[pt, ps], (vy - vel_y[pt, ps]) - 1.6 * sy)
                            smooth_pen = -0.028 * (acc / sy)
                            # Cap penalty at hit-reversal cost so genuine racket impacts stay connected
                            trans_pen = max(-3.2, smooth_pen)
                        else:
                            trans_pen = -0.008 * (step_speed / sy)

                        # Penalize staying completely stationary (< 1.5*sy px/frame) on low-motion peaks
                        if step_speed < 1.5 * sy and m_val < 3.0:
                            trans_pen -= 1.4

                        cand_v = dp[pt, ps] + u_val + skip_pen + trans_pen
                        if cand_v > best_val:
                            best_val = cand_v
                            best_pt = pt
                            best_ps = ps
                            best_vx, best_vy, best_hv = vx, vy, True

                dp[t, k] = best_val
                back_t[t, k] = best_pt
                back_s[t, k] = best_ps
                vel_x[t, k] = best_vx
                vel_y[t, k] = best_vy
                has_vel[t, k] = best_hv

        # Backtrack optimal state sequence
        chosen_state = [K] * T
        cur_t = T - 1
        cur_s = int(np.argmax(dp[T - 1]))
        while cur_t >= 0:
            chosen_state[cur_t] = cur_s
            pt = int(back_t[cur_t, cur_s])
            ps = int(back_s[cur_t, cur_s])
            if pt < 0 or pt >= cur_t:
                break
            # Any skipped intermediate frames between pt and cur_t remain Null (vis=0) for InpaintNet
            cur_t = pt
            cur_s = ps

        detections: List[Dict] = []
        for i in range(T):
            frame_no = start_frame_idx + i
            st = chosen_state[i]
            if st < K and st < len(peaks_per_frame[i]):
                pk = peaks_per_frame[i][st]
                detections.append({
                    "frame": frame_no,
                    "x": float(pk[0]),
                    "y": float(pk[1]),
                    "visibility": 1,
                    "confidence": round(float(pk[2]), 3),
                    "inpainted": False,
                })
            else:
                detections.append({
                    "frame": frame_no,
                    "x": 0.0,
                    "y": 0.0,
                    "visibility": 0,
                    "confidence": 0.0,
                    "inpainted": False,
                })
        return detections

    def _apply_raw_speed_gate(
        self,
        detections: List[Dict],
        max_jump_px: float = 250.0,
        neighbor_window: int = 2,
        orig_h: int = 1080,
    ) -> Tuple[List[Dict], List[int]]:
        """
        Before inpainting, drops:
          1. Any single-frame spike > max_jump_px from surrounding visible neighbours
          2. Short 2-6 frame stationary/teleport islands jumping far from surrounding track
          3. Long stationary false-positive locks (>= 5 consecutive visible frames within <= 4.5*sy px)
             such as white shoes, court-line junctions, or LED logo flashes.
        Returns (filtered_detections, dropped_frame_numbers).
        """
        num_frames = len(detections)
        sy = max(0.35, float(orig_h or 1080) / 1080.0)
        to_drop = set()

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
                to_drop.add(i)

        # Second pass: reject 2-to-6 frame stationary false-positive islands (e.g. shoe/line locks)
        vis_indices = [idx for idx in range(num_frames) if detections[idx]["visibility"] == 1 and idx not in to_drop]
        island_spread_thr = 18.0 * sy
        island_jump_thr = 165.0 * sy
        k = 0
        while k < len(vis_indices):
            dropped_island = False
            for L in (6, 5, 4, 3, 2):
                if k + L - 1 >= len(vis_indices):
                    continue
                island = vis_indices[k : k + L]
                if island[-1] - island[0] > L + 3:
                    continue
                xs_i = [detections[idx]["x"] for idx in island]
                ys_i = [detections[idx]["y"] for idx in island]
                spread = math.hypot(max(xs_i) - min(xs_i), max(ys_i) - min(ys_i))
                if spread > island_spread_thr:
                    continue
                prev_idx = vis_indices[k - 1] if k > 0 else None
                next_idx = vis_indices[k + L] if (k + L) < len(vis_indices) else None
                jump_in = (
                    math.hypot(detections[island[0]]["x"] - detections[prev_idx]["x"], detections[island[0]]["y"] - detections[prev_idx]["y"])
                    if prev_idx is not None else 999.0 * sy
                )
                jump_out = (
                    math.hypot(detections[island[-1]]["x"] - detections[next_idx]["x"], detections[island[-1]]["y"] - detections[next_idx]["y"])
                    if next_idx is not None else 999.0 * sy
                )
                if jump_in > island_jump_thr and jump_out > island_jump_thr:
                    for idx in island:
                        to_drop.add(idx)
                    k += L
                    dropped_island = True
                    break
            if not dropped_island:
                k += 1

        # Third pass: suppress persistent stationary locks (>= 5 frames within <= 4.5*sy px) mid-rally
        vis_indices = [idx for idx in range(num_frames) if detections[idx]["visibility"] == 1 and idx not in to_drop]
        run_start = 0
        while run_start < len(vis_indices):
            run_end = run_start
            bx0 = bx1 = detections[vis_indices[run_start]]["x"]
            by0 = by1 = detections[vis_indices[run_start]]["y"]
            while run_end + 1 < len(vis_indices):
                nxt = vis_indices[run_end + 1]
                if nxt - vis_indices[run_end] > 2:
                    break
                nx, ny = detections[nxt]["x"], detections[nxt]["y"]
                nbx0, nbx1 = min(bx0, nx), max(bx1, nx)
                nby0, nby1 = min(by0, ny), max(by1, ny)
                if math.hypot(nbx1 - nbx0, nby1 - nby0) <= 4.5 * sy:
                    bx0, bx1, by0, by1 = nbx0, nbx1, nby0, nby1
                    run_end += 1
                else:
                    break
            run_len = run_end - run_start + 1
            # Keep pre-serve stationary hold (at start of rally) or post-point floor rest (at very end),
            # drop mid-rally stationary locks that cannot be a flying shuttlecock.
            if run_len >= 5 and vis_indices[run_start] > 15 and vis_indices[run_end] < num_frames - 12:
                for r_k in range(run_start, run_end + 1):
                    to_drop.add(vis_indices[r_k])
            run_start = run_end + 1

        dropped_frame_nums = []
        for i in sorted(to_drop):
            detections[i]["x"] = 0.0
            detections[i]["y"] = 0.0
            detections[i]["visibility"] = 0
            detections[i]["dropped_outlier"] = True
            dropped_frame_nums.append(int(detections[i]["frame"]))

        return detections, dropped_frame_nums

    def _apply_inpaintnet(self, detections: List[Dict], width: int, height: int) -> List[Dict]:
        """
        Uses InpaintNet to temporally bridge occlusion gaps.
        - Only fills a gap when BOTH the last detection before it and the first detection
          after it are below 0.05 * frame_height from the top edge (y > th_h).
        - Resolution-scaled reachable speed check (220 * sy px/frame).
        - Properly marks ALL vis==0 frames in each 16-frame window with m_net=1.0 so
          unfillable gaps never feed fake (0.0, 0.0) coordinates as 'visible' anchors.
        """
        num_frames = len(detections)
        sy = max(0.35, float(height or 1080) / 1080.0)
        xs = np.array([d["x"] for d in detections], dtype=np.float32)
        ys = np.array([d["y"] for d in detections], dtype=np.float32)
        vis = np.array([d["visibility"] for d in detections], dtype=np.int32)

        # Top-of-frame ceiling threshold (5% of frame height = 54 px on 1080p)
        th_h = float(height) * 0.05

        # Generate inpaint mask (only interior bounded gaps <= 12 frames)
        inpaint_mask = np.zeros(num_frames, dtype=np.float32)
        i = 0
        while i < num_frames:
            if vis[i] == 0:
                gap_start = i
                while i < num_frames and vis[i] == 0:
                    i += 1
                gap_end = i
                gap_len = gap_end - gap_start
                if gap_start > 0 and gap_end < num_frames and gap_len <= 12:
                    if ys[gap_start - 1] > th_h and ys[gap_end] > th_h:
                        gap_dist = math.hypot(
                            float(xs[gap_end] - xs[gap_start - 1]),
                            float(ys[gap_end] - ys[gap_start - 1])
                        )
                        if gap_dist <= (220.0 * sy) * (gap_len + 1):
                            inpaint_mask[gap_start:gap_end] = 1.0
            else:
                i += 1

        if np.sum(inpaint_mask) == 0:
            return detections

        # Full missing mask for network input (prevents vis==0 outside inpaint_mask from acting as (0,0) anchors)
        net_missing_mask = (vis == 0).astype(np.float32)

        # Slide 16-frame windows with step=1 and positional ensemble weights
        inpaint_len = 16
        weights = get_ensemble_weights(inpaint_len)
        accum_coords = np.zeros((num_frames, 2), dtype=np.float32)
        accum_weights = np.zeros(num_frames, dtype=np.float32)
        norm_coords = np.stack([xs / float(width), ys / float(height)], axis=-1)

        for w_start in range(0, num_frames - inpaint_len + 1, 1):
            w_write_mask = inpaint_mask[w_start : w_start + inpaint_len]
            w_net_mask = net_missing_mask[w_start : w_start + inpaint_len]
            w_norm = norm_coords[w_start : w_start + inpaint_len]
            if np.sum(w_write_mask) == 0:
                for s in range(inpaint_len):
                    accum_coords[w_start + s] += w_norm[s] * weights[s]
                    accum_weights[w_start + s] += weights[s]
                continue

            # Ensure coordinates are zeroed wherever w_net_mask == 1.0
            w_x_in = w_norm * (1.0 - w_net_mask[:, None])
            t_x = torch.from_numpy(w_x_in).unsqueeze(0).to(self.device)
            t_m = torch.from_numpy(w_net_mask).reshape(1, inpaint_len, 1).to(self.device)

            with torch.no_grad():
                pred_c = self.inpaintnet(t_x, t_m)[0].cpu().numpy()

            blended = pred_c * w_write_mask[:, None] + w_norm * (1.0 - w_write_mask[:, None])
            for s in range(inpaint_len):
                accum_coords[w_start + s] += blended[s] * weights[s]
                accum_weights[w_start + s] += weights[s]

        coor_th = 10.0 * sy
        for idx in range(num_frames):
            if inpaint_mask[idx] == 1.0 and accum_weights[idx] > 1e-6:
                cx = float((accum_coords[idx, 0] / accum_weights[idx]) * width)
                cy = float((accum_coords[idx, 1] / accum_weights[idx]) * height)
                if cx >= coor_th and cy >= coor_th and cx <= width - coor_th and cy <= height - coor_th:
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

