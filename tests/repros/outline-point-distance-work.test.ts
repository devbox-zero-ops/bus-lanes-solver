import "../fixtures/pcb-snapshot"
import { expect, spyOn, test } from "bun:test"
import { BusLanesSolver } from "../../lib"
import * as geometry from "../../lib/geometry"
import { boardOutlineInput } from "../fixtures/board-outline"
import { expectCompletedRouting } from "../fixtures/expect-completed-routing"
import { nativePairCircuit } from "../fixtures/native-pair-circuit"

test("outline clearance checks avoid distant edge projections", async () => {
  const input = boardOutlineInput()
  const original = structuredClone(input)
  const solver = new BusLanesSolver(input)
  let projections = 0
  const originalDistance = geometry.pointSegmentDistanceToPoints
  const pointDistance = spyOn(
    geometry,
    "pointSegmentDistanceToPoints",
  ).mockImplementation((...points): number => {
    projections++
    if (projections % 10_000 === 0) pointDistance.mockClear()
    return originalDistance(...points)
  })
  try {
    solver.solve()
  } finally {
    pointDistance.mockRestore()
  }
  expectCompletedRouting(solver, original)
  const circuit = nativePairCircuit({ input, traces: solver.traces })
  circuit.push({
    type: "pcb_note_text",
    pcb_note_text_id: "outline_distance_work",
    pcb_group_id: "outline_distance_work",
    text: `Distance projections: ${projections}`,
    anchor_position: { x: 0, y: -3 },
    anchor_alignment: "center",
    font: "tscircuit2024",
    font_size: 0.35,
    layer: "top",
  })
  await expect(circuit).toMatchPcbSnapshot({
    testPath: import.meta.path,
    svgOptions: { width: 900, height: 800, showSolderMask: false },
  })
})
