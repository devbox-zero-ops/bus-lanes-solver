import "./fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { BusLanesSolver } from "../lib/bus-lanes-solver"
import { expectCompletedRouting } from "./fixtures/expect-completed-routing"
import { nativePairCircuit } from "./fixtures/native-pair-circuit"
import { rotatedSurroundedTuningBus } from "./fixtures/surrounded-tuning-bus"

test("a quarter-turned bus still negotiates physical matching space", async () => {
  const input = rotatedSurroundedTuningBus(90)
  const before = structuredClone(input)
  const solver = new BusLanesSolver(input, {
    denseSearch: true,
    smoothTuning: false,
    maxSearchIterations: 20000,
  })
  solver.solve()
  expectCompletedRouting(solver, before)
  const circuit = nativePairCircuit({ input, traces: solver.traces })
  circuit.push({
    type: "pcb_note_text",
    pcb_note_text_id: "tuning_note",
    pcb_group_id: "board",
    text: "Center matching: 0.02 mm",
    anchor_position: { x: 13, y: input.bounds.maxY - 0.35 },
    anchor_alignment: "center",
    font: "tscircuit2024",
    font_size: 0.14,
    layer: "top",
  })
  await expect(circuit).toMatchPcbSnapshot({
    testPath: import.meta.path,
    svgOptions: { width: 600, height: 1200, showSolderMask: false },
  })
}, 15000)
