import "./fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import {
  validateOriginalEndpointConnectivity,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import { BusLanesSolver } from "../lib/bus-lanes-solver"
import { busLengthReports } from "../lib/route-lengths"
import { nativePairCircuit } from "./fixtures/native-pair-circuit"
import { surroundedTuningBus } from "./fixtures/surrounded-tuning-bus"

test("five eight-signal buses connect but leave the center bus unmatched", async () => {
  const input = surroundedTuningBus(8)
  const original = structuredClone(input)
  const solver = new BusLanesSolver(input, {
    denseSearch: true,
    smoothTuning: false,
    maxSearchIterations: 20000,
  })
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.failureCode).toBe("length_matching_failed")
  expect(solver.traces).toHaveLength(40)
  expect(input).toEqual(original)
  expect(input.traces).toBeUndefined()
  expect(new Set(solver.traces.map((trace) => trace.connection_name))).toEqual(
    new Set(input.connections.map((connection) => connection.name)),
  )
  const nativeInput = {
    ...input,
    obstacles: input.obstacles.map((obstacle) => ({
      ...obstacle,
      type: "rect" as const,
    })),
    traces: [],
  }
  const validation = {
    inputSrj: nativeInput,
    routedSrj: {
      ...nativeInput,
      traces: solver.traces.map((trace) => ({
        ...trace,
        connection_name: trace.connection_name!,
      })),
    },
  }
  const connectivity = validateOriginalEndpointConnectivity(validation)
  expect(connectivity.valid).toBe(true)
  expect(connectivity.connectedConnectionCount).toBe(40)
  expect(validateRoutedCopperDrc({ ...validation, clearance: 0.1 }).valid).toBe(
    true,
  )
  const buses = busLengthReports(input, solver.traces)
  expect(buses.filter((bus) => bus.matched)).toHaveLength(4)
  expect(
    buses.every((bus) => bus.aboveMinimumLength && bus.withinLengthLimit),
  ).toBe(true)
  expect(buses.find((bus) => bus.busId === "CENTER")?.skewMm).toBe(2)
  expect(buses.find((bus) => bus.busId === "CENTER")?.toleranceMm).toBe(0.02)

  // This user-requested baseline intentionally shows the genuine failed
  // matching result. Connectivity and DRC pass; the full solver does not.
  const circuit = nativePairCircuit({ input, traces: solver.traces })
  circuit.push({
    type: "pcb_note_text",
    pcb_note_text_id: "byte_tuning_note",
    pcb_group_id: "board",
    text: "MATCHING FAILED: 4/5 buses; CENTER skew 2 mm (limit 0.02 mm)",
    anchor_position: { x: 5, y: 8.4 },
    anchor_alignment: "center",
    font: "tscircuit2024",
    font_size: 0.18,
    layer: "top",
  })
  circuit.push({
    type: "pcb_note_text",
    pcb_note_text_id: "byte_tuning_baseline_note",
    pcb_group_id: "board",
    text: "Fresh main 202b034: 40/40 connected; DRC clear; solver failed matching",
    anchor_position: { x: 5, y: 7.95 },
    anchor_alignment: "center",
    font: "tscircuit2024",
    font_size: 0.15,
    layer: "top",
  })
  await expect(circuit).toMatchPcbSnapshot({
    testPath: import.meta.path,
    svgOptions: { width: 1000, height: 1200, showSolderMask: false },
  })
}, 15000)
