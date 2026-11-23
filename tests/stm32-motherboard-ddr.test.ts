import "./fixtures/pcb-snapshot"
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import {
  getCopperLayerNames,
  getRouteViaSpanLayers,
} from "@tscircuit/fanout-solver"
import { type AnyCircuitElement, pcb_trace, pcb_via } from "circuit-json"
import { BusLanesPipelineSolver, type SimpleRouteJson } from "../lib"
import { length } from "../lib/geometry"
import { GridVisibilitySearch } from "../lib/grid-visibility"
import { maximumCarrierLength } from "../lib/route-lengths"
import { fixedCopper, VectorScene } from "../lib/vector-scene"
import { expectCompletedRouting } from "./fixtures/expect-completed-routing"

function loadInput(): SimpleRouteJson {
  return JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./fixtures/stm32-motherboard-ddr/input.srj.json.gz",
          import.meta.url,
        ),
      ),
    ).toString("utf8"),
  )
}

test("routes the motherboard DDR bus after native STM32 and RAM fanout", async () => {
  const input = loadInput()
  const circuit: AnyCircuitElement[] = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./fixtures/stm32-motherboard-ddr/unrouted.circuit.json.gz",
          import.meta.url,
        ),
      ),
    ).toString("utf8"),
  )
  const original = structuredClone(input)
  expect(input.obstacles).toHaveLength(3330)
  expect(input.traces).toHaveLength(351)
  expect(input.connections).toHaveLength(40)
  expect(input.buses).toHaveLength(1)
  expect(input.buses![0].connectionNames).toHaveLength(22)
  expect(input.differentialPairs).toHaveLength(2)

  // The exact Core handoff, with default options and the native search budget.
  const solver = new BusLanesPipelineSolver(input)
  const started = performance.now()
  solver.solve()
  console.log(
    JSON.stringify({
      elapsedSeconds: (performance.now() - started) / 1000,
      iterations: solver.iterations,
      maxIterations: solver.MAX_ITERATIONS,
      solved: solver.solved,
      error: solver.error,
      failureCode: solver.failureCode,
      acceptedTraces: solver.traces.length,
    }),
  )
  expect(input).toEqual(original)

  let traces = input.traces!
  let caption = "FAILED: 0/22 DDR bus routes accepted; supplied fanout only"
  if (solver.solved) {
    expectCompletedRouting(solver, original)
    expect(solver.traces).toHaveLength(22)
    traces = solver.getOutput().traces!
    caption =
      "COMPLETED: 22/22 DDR bus routes; connectivity, DRC and matching passed"
  }
  const layerNames = getCopperLayerNames(input.layerCount)
  for (const trace of traces) {
    circuit.push(pcb_trace.parse(trace))
    for (const [index, point] of trace.route.entries()) {
      if (point.route_type !== "via") continue
      circuit.push(
        pcb_via.parse({
          type: "pcb_via",
          pcb_via_id: `${trace.pcb_trace_id}_via_${index}`,
          pcb_trace_id: trace.pcb_trace_id,
          x: point.x,
          y: point.y,
          outer_diameter: point.via_diameter ?? input.minViaPadDiameter,
          hole_diameter: point.via_hole_diameter ?? input.minViaHoleDiameter,
          layers: getRouteViaSpanLayers({
            fromLayer: point.from_layer,
            toLayer: point.to_layer,
            layers: point.layers,
            layerNames,
            allowBlindAndBuriedVias: input.allowBlindAndBuriedVias ?? false,
          }),
        }),
      )
    }
  }
  if (!solver.solved) {
    const busNames = new Set(input.buses![0].connectionNames)
    for (const connection of input.connections) {
      if (!busNames.has(connection.name)) continue
      const [a, b] = connection.pointsToConnect
      circuit.push({
        type: "pcb_note_line",
        pcb_note_line_id: `requested_${connection.name}`,
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        layer: "top",
        stroke_width: 0.04,
        color: "#db2777",
        is_dashed: true,
      })
    }
  }
  const note = (
    text: string,
    position: { x: number; y: number; fontSize: number },
  ): AnyCircuitElement => ({
    type: "pcb_note_text",
    pcb_note_text_id: `status_${position.x}_${position.y}`,
    text,
    anchor_position: { x: position.x, y: position.y },
    font: "tscircuit2024",
    layer: "top",
    font_size: position.fontSize,
    anchor_alignment: "center",
  })
  const legend = solver.solved
    ? "Full board context; only fanout and the DDR data/mask/strobe bus are requested"
    : "Pink dashed lines are requests, not copper. Search exhausted before length matching."
  const svgOptions = {
    backgroundColor: "white",
    shouldDrawErrors: false,
    shouldDrawWarnings: false,
    shouldDrawRatsNest: false,
    showErrorsInTextOverlay: false,
    showSolderMask: false,
    showSolderPaste: false,
    showCourtyards: false,
    includeVersion: false,
  }
  await expect([
    ...circuit,
    note(caption, { x: 0, y: 54, fontSize: 1.25 }),
    note(legend, { x: 0, y: 51.5, fontSize: 0.8 }),
  ]).toMatchPcbSnapshot({
    testPath: import.meta.path,
    svgOptions: {
      ...svgOptions,
      width: 1600,
      height: 1100,
      viewport: { minX: -79, maxX: 79, minY: -50, maxY: 57 },
    },
  })
  await expect([
    ...circuit,
    note(caption, { x: 9.5, y: 48.5, fontSize: 0.38 }),
    note(legend, { x: 9.5, y: 47.3, fontSize: 0.26 }),
  ]).toMatchPcbSnapshot({
    testPath: import.meta.path,
    snapshotName: "ddr",
    svgOptions: {
      ...svgOptions,
      width: 1100,
      height: 1500,
      viewport: { minX: -4, maxX: 23, minY: 10, maxY: 50 },
    },
  })
  expect(solver.error).toBeNull()
  expect(solver.solved).toBe(true)
}, 3_600_000)

test("each motherboard DDR connection is reachable before other bus lanes are added", () => {
  const input = loadInput()
  const names = new Set(input.buses![0].connectionNames)
  const connections = input.connections.filter((c) => names.has(c.name))
  const copper = fixedCopper(input)
  const width = input.buses![0].traceWidth ?? input.minTraceWidth
  expect(connections).toHaveLength(22)

  // Reachability control only: these paths may cross each other and are never
  // combined, accepted as a completed bus, or included in the PCB snapshots.
  for (const connection of connections) {
    const scene = new VectorScene(input, connection, width, copper)
    const search = new GridVisibilitySearch(
      scene,
      connection.pointsToConnect[0],
      connection.pointsToConnect[1],
      [],
      0,
      undefined,
      { maxLength: maximumCarrierLength(input, connection.name) },
    )
    while (!search.solved && !search.failed) search.step()
    expect(search.solved).toBe(true)
    expect(scene.pathVisible(search.result)).toBe(true)
    expect(length(search.result)).toBeLessThanOrEqual(
      maximumCarrierLength(input, connection.name),
    )
  }
})
