# Pixel Dash populated AM3354 DDR3L channel

From the repository root, run:

```sh
bun install
bun repros/pixel-dash-am3354-populated/run.ts
```

The input comes from the four-layer Pixel Dash AM3354 and x16 DDR3L calibration layout before the reference divider was added. The 50 requested signal routes and their signal vias have been removed. The 1,577 obstacles retain the package pads, inner-layer no-via-in-pad exclusions for signal escape, bypass and calibration component pads, fixed copper segments with round ends, and remaining vias on their respective layers. Continuous reference pours are not modeled as signal-routing obstacles. Top-side BGA pads escape to a bottom signal carrier with 0.102 mm traces and 0.4572/0.254 mm signal vias.

Version 0.0.51 returns all 50 named routes in the package-only control. With the populated input it reports `Single-layer negotiation exhausted its pass budget` in connectivity mode. The wall-clock budget is 240 seconds. A successful reproduction of the failure exits nonzero. A successful solve should return all 50 named connections. DDR skew, differential coupling and fabrication sign-off are separate checks.
