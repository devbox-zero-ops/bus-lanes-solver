import "./fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { BusLanesSolver } from "../lib/bus-lanes-solver"
import { fixedCopper, routeCopper, VectorScene } from "../lib/vector-scene"
import { expectCompletedRouting } from "./fixtures/expect-completed-routing"
import { nativePairCircuit } from "./fixtures/native-pair-circuit"
import {
  shortestSurroundingRoutes,
  surroundedTuningBus,
} from "./fixtures/surrounded-tuning-bus"

test("five timed buses negotiate room for the surrounded center bus", async () => {
  const input = surroundedTuningBus()
  const before = structuredClone(input)
  const shortest = shortestSurroundingRoutes(input)
  const copper = [...fixedCopper(input), ...shortest.flatMap(routeCopper)]
  for (const [position, trace] of shortest.entries()) {
    expect(
      new VectorScene(
        input,
        input.connections[position],
        input.minTraceWidth,
        copper,
      ).pathVisible(trace.route),
    ).toBe(true)
  }
  // Reproduce the old route-then-match handoff: connectivity and DRC are
  // satisfied, but treating every neighbor as fixed prevents tuning.
  const fixedNeighbors = BusLanesSolver.forRefinement(input, shortest, {
    smoothTuning: false,
  })
  fixedNeighbors.solve()
  expect(fixedNeighbors.failureCode).toBe("length_matching_failed")

  const solver = new BusLanesSolver(input, {
    denseSearch: true,
    smoothTuning: false,
    maxSearchIterations: 20000,
  })
  solver.solve()
  expectCompletedRouting(solver, before)
  expect(
    solver.traces.some(
      (trace) =>
        trace.connection_name?.startsWith("SOUTH") &&
        trace.route.some(
          (point) =>
            Math.abs(
              point.y -
                input.connections.find(
                  (connection) => connection.name === trace.connection_name,
                )!.pointsToConnect[0].y,
            ) > 1e-6,
        ),
    ),
  ).toBe(true)

  const circuit = nativePairCircuit({ input, traces: solver.traces })
  circuit.push({
    type: "pcb_note_text",
    pcb_note_text_id: "tuning_note",
    pcb_group_id: "board",
    text: "Five buses: 10/10 connected, each matched within 0.02 mm",
    anchor_position: { x: 5, y: 2.1 },
    anchor_alignment: "center",
    font: "tscircuit2024",
    font_size: 0.18,
    layer: "top",
  })
  await expect(circuit).toMatchPcbSnapshot({
    testPath: import.meta.path,
    svgOptions: { width: 1200, height: 600, showSolderMask: false },
  })
}, 15000)
