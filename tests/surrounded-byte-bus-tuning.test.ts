import "./fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { BusLanesSolver } from "../lib/bus-lanes-solver"
import { expectCompletedRouting } from "./fixtures/expect-completed-routing"
import { nativePairCircuit } from "./fixtures/native-pair-circuit"
import {
  shortestSurroundingRoutes,
  surroundedTuningBus,
} from "./fixtures/surrounded-tuning-bus"

test("five eight-signal buses preserve tuning space as their members are routed", async () => {
  const input = surroundedTuningBus(8)
  const original = structuredClone(input)
  const fixedNeighbors = BusLanesSolver.forRefinement(
    input,
    shortestSurroundingRoutes(input),
    { smoothTuning: false },
  )
  fixedNeighbors.solve()
  expect(fixedNeighbors.failureCode).toBe("length_matching_failed")

  const solver = new BusLanesSolver(input, {
    denseSearch: true,
    smoothTuning: false,
    maxSearchIterations: 20000,
  })
  solver.solve()
  expectCompletedRouting(solver, original)
  expect(solver.traces).toHaveLength(40)
  const circuit = nativePairCircuit({ input, traces: solver.traces })
  circuit.push({
    type: "pcb_note_text",
    pcb_note_text_id: "byte_tuning_note",
    pcb_group_id: "board",
    text: "Five byte buses: 40/40 connected, each matched within 0.02 mm",
    anchor_position: { x: 5, y: 8.4 },
    anchor_alignment: "center",
    font: "tscircuit2024",
    font_size: 0.18,
    layer: "top",
  })
  await expect(circuit).toMatchPcbSnapshot({
    testPath: import.meta.path,
    svgOptions: { width: 1000, height: 1200, showSolderMask: false },
  })
}, 15000)
