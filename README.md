# LANTERN

A Lightweight Trajectory-Set Planner for Quadrotor Navigation

Anonymous authors. The homepage contains the method figures, measured paper
results, selected flight recordings and an interactive browser demonstration.
The complete submission film remains a supplementary download.

Run `python serve.py --port 8788` and open the printed address.
The browser performs fresh ONNX inference; no recorded path drives the flight.
All model and runtime assets are local.

## Interactive Demo

The network checkpoint and ONNX weights are unchanged. The web execution
profile is level-terminal-20261113 and differs from the paper's execution:

- Fixed altitude from 0.5 to 2.5 m, with equal start and goal heights.
- Planar projection of the 24 network endpoints.
- Footprint checks against generated scene geometry; short obstacles cannot
  be overflown. Predicted cost ranks the remaining feasible level candidates.
- A separate scene-aware controller searches continuous quintic stops inside
  6.5 m. A feasible stop is followed to its exact goal endpoint with zero
  velocity and acceleration. Start position, velocity and acceleration match.
- Arrival still requires 3D error <=0.1 m and speed <=0.2m/s for 0.5 s.

Randomize uses 70 selected seeds covering 24 and 60 obstacles: 20 mixed seeds
and 5 each for pillars, boxes and walls at each count. All selected seeds
passed fixed altitude, precise stopping, final 2 m path ratio <=1.2 and total
path ratio <=1.35. They were selected from 378 retained attempts, including
failures. These are selected qualitative demonstrations, not unbiased success
rates or evidence for paper performance. Other counts use the same live
screening criteria. Manually edited scenes remain unscreened and can fail.

The catalog is bound to model, generator, execution and controller hashes.
Run exports include the execution settings and selection provenance.
Model and environment contains the complete assumptions. Tracking is ideal
analytic reference following, without rigid-body dynamics or sensor noise.

The research source is available at the [anonymous repository](https://anonymous.4open.science/r/LANTERN-4944/).
The demo source is also included. Licenses remain in assets/vendor/ and
assets/lucide-LICENSE.
The supplementary film includes permanent English subtitles and music credit.
