# LANTERN

A Lightweight Trajectory-Set Planner for Quadrotor Navigation

Anonymous review materials: paper, method figures, measured results,
a stopping comparison, one indoor flight, one outdoor flight, and the
interactive browser planner. The complete submission video is available
as a supplementary download rather than an embedded homepage film.

Run locally with `python serve.py --port 8788`, then open the printed address.
All model and runtime assets are local. The demo performs fresh ONNX inference;
no recorded trajectory drives the displayed flight.

Randomize selects success-screened demo seeds for 24 and 60 obstacles.
Other counts are screened by live inference. Manual scenes remain unscreened.
These selected demonstrations are separate from the paper's benchmarks.
The demo uses publication weights with a web terminal profile and ideal
analytic tracking. Full assumptions are shown in Model and environment.

The browser demo source is included. The research repository is withheld
during review. Third-party licenses are retained in assets/vendor/ and
assets/lucide-LICENSE.

The video includes permanent English subtitles in Arial, with at most two lines. English.srt is also available in the supplementary ZIP.
