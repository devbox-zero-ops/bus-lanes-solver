import "../fixtures/pcb-snapshot"
import { expect, spyOn, test } from "bun:test"
import {
  validateOriginalEndpointConnectivity,
  validateRoutedCopperDrc,
} from "@tscircuit/fanout-solver"
import type { Trace } from "../../lib"
import * as boardOutline from "../../lib/board-outline"
import { GridVisibilitySearch } from "../../lib/grid-visibility"
import { VectorScene } from "../../lib/vector-scene"
import { boardOutlineInput } from "../fixtures/board-outline"
import { nativeValidationSrj } from "../fixtures/expect-completed-routing"
import { nativePairCircuit } from "../fixtures/native-pair-circuit"

test("grid construction repeats full-outline checks on a routed concave board", async () => {
  const input = boardOutlineInput()
  const connection = input.connections[0]
  const scene = new VectorScene(input, connection, input.minTraceWidth, [])
  let boardPointChecks = 0
  const originalPredicate = boardOutline.boardSegmentIsClear
  const predicate = spyOn(
    boardOutline,
    "boardSegmentIsClear",
  ).mockImplementation((query): boolean => {
    if (query.start.x === query.end.x && query.start.y === query.end.y)
      boardPointChecks++
    if (boardPointChecks % 10_000 === 0) predicate.mockClear()
    return originalPredicate(query)
  })
  let search: GridVisibilitySearch
  try {
    search = new GridVisibilitySearch(
      scene,
      connection.pointsToConnect[0],
      connection.pointsToConnect[1],
      [],
      0,
      undefined,
      { step: 0.1, bounds: input.bounds },
    )
    while (!search.solved && !search.failed) search.step()
  } finally {
    predicate.mockRestore()
  }
  expect(search.solved).toBe(true)
  expect(search.failed).toBe(false)
  const traces: Trace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: "signal",
      connection_name: connection.name,
      route: search.result.map((point) => ({
        ...point,
        route_type: "wire",
        width: input.minTraceWidth,
        layer: "top",
      })),
    },
  ]
  const native = {
    inputSrj: nativeValidationSrj(input),
    routedSrj: nativeValidationSrj({ ...input, traces }),
  }
  expect(validateOriginalEndpointConnectivity(native).valid).toBe(true)
  expect(validateRoutedCopperDrc({ ...native, clearance: 0.075 }).valid).toBe(
    true,
  )
  expect(boardOutline.traceStaysInsideOutline(input, traces[0])).toBe(true)
  const circuit = nativePairCircuit({ input, traces })
  circuit.push({
    type: "pcb_note_text",
    pcb_note_text_id: "outline_point_work",
    pcb_group_id: "outline_point_work",
    text: `Full-outline point queries: ${boardPointChecks}`,
    anchor_position: { x: 0, y: -3 },
    anchor_alignment: "center",
    font: "tscircuit2024",
    font_size: 0.35,
    layer: "top",
  })
  await expect(circuit).toMatchPcbSnapshot({
    testPath: import.meta.path,
    svgOptions: {
      width: 900,
      height: 800,
      showSolderMask: true,
      backgroundColor: "white",
    },
  })
})
