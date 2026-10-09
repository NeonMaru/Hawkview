"""
Hawkview Computer Vision & Physics Engine
Autonomous Badminton Match Analytics & On-Device Sports Vision

Modules:
- court_geometry: Regulation BWF metric court, homography, camera calibration (solvePnP)
- aerodynamics: Shuttlecock ballistic ODE, aerodynamic drag, 3D Monocular trajectory (MonoTrack)
- tracknet: TrackNet 3-frame heatmap detection & peak extraction
- player_pose: Net-bounded player tracking, ankle projection, sprint telemetry, KDE heatmaps
- scoreboard_ocr: Scorebug ROI extraction and monotonic score progression verification
- pipeline: Master end-to-end video-to-telemetry ingestion pipeline
"""

__version__ = "1.0.0"
