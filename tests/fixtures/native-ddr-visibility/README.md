# Native DDR bus visibility

These are the Core bus-lanes inputs for two completed phases of the [ten-board TSX benchmark](https://github.com/ShiboSoftwareDev/core-ddr-benchmark/tree/24dc44c166d4258c3538f8b1f66953f1b6f58690/circuits). The capture used tscircuit 0.0.3271, Core 0.0.2450 and bus-lanes-solver 0.0.63. Both fixtures preserve the native pads, earlier traces and via layer spans. The coordinates are board-world millimetres.

| Capture | Native design | Supplied traces | Requested signals | Pad obstacles |
| --- | --- | ---: | ---: | ---: |
| A13 RAM byte 1 | [A13 SBC, hardware/module.kicad_pcb](https://github.com/vd-rd/sbc_allwinner_a13/tree/8973c32c64349515da64e268cc03ea8c0789ca2a/hardware) | 24 | 8 | 378 |
| A64 byte 2 | [OLIMEX A64-OLinuXino rev H](https://github.com/OLIMEX/OLINUXINO/tree/85eee9c17ee13af65617d73bdd94de7ec49cfb42/HARDWARE/A64-OLinuXino) | 16 | 8 | 607 |

The snapshots count calls to the scene's segment visibility predicate during a fresh solve. They show the completed output after endpoint connectivity, copper clearance and preservation of supplied traces have been checked.

OLIMEX Ltd. licenses the A64 source and its routing abstractions under CC BY-SA 3.0 US. The A13 source has no declared license in the pinned revision. The benchmark preserves the source notice and records its status as NOASSERTION. [Dataset terms](https://github.com/ShiboSoftwareDev/core-ddr-benchmark/blob/24dc44c166d4258c3538f8b1f66953f1b6f58690/LICENSE) · [A64 license](https://creativecommons.org/licenses/by-sa/3.0/us/) · [A13 source notice](https://github.com/ShiboSoftwareDev/core-ddr-benchmark/blob/24dc44c166d4258c3538f8b1f66953f1b6f58690/licenses/A13-README.md)
