import { expect, spyOn, test } from "bun:test"
import * as boardOutline from "../lib/board-outline"
import { getBoardGrid } from "../lib/board-grid"
import { GridVisibilitySearch } from "../lib/grid-visibility"
import { VectorScene, copperTooClose, type Copper } from "../lib/vector-scene"
import { boardOutlineInput } from "./fixtures/board-outline"

test("records cache reuse across alternating search bounds", () => {
  const input = boardOutlineInput()
  const step = 0.2
  const xs = Float64Array.from({ length: 51 }, (_, x) => -5 + x * step)
  const ys = Float64Array.from({ length: 41 }, (_, y) => -4 + y * step)
  const full = { input, copperRadiusMm: 0.05, xs, ys, step }
  const narrow = { ...full, xs: xs.slice(10, -10) }
  const predicate = spyOn(boardOutline, "boardSegmentIsClear")
  try {
    const fullBoard = getBoardGrid(full)
    const narrowBoard = getBoardGrid(narrow)
    predicate.mockClear()
    const repeatedFullBoard = getBoardGrid(full)
    const repeatedNarrowBoard = getBoardGrid(narrow)
    expect(repeatedFullBoard).toEqual(fullBoard)
    expect(repeatedNarrowBoard).toEqual(narrowBoard)
    expect({
      repeatedPointChecks: predicate.mock.calls.length,
      reusedFullGrid: repeatedFullBoard === fullBoard,
      reusedNarrowGrid: repeatedNarrowBoard === narrowBoard,
    }).toMatchInlineSnapshot(`
      {
        "repeatedPointChecks": 0,
        "reusedFullGrid": true,
        "reusedNarrowGrid": true,
      }
    `)
  } finally {
    predicate.mockRestore()
  }
})

test("copper changes reuse board occupancy without retaining stale copper or clearance", () => {
  const input = boardOutlineInput()
  const connection = input.connections[0]
  const copper: Copper[] = [
    {
      a: { x: -3, y: -3 },
      b: { x: -3, y: -2 },
      radius: 0.15,
      layer: "top",
      owners: ["other"],
    },
  ]
  let width = input.minTraceWidth
  let step = 0.2
  let bounds = { ...input.bounds }
  const predicate = spyOn(boardOutline, "boardSegmentIsClear")
  try {
    for (let revision = 0; revision < 8; revision++) {
      if (revision === 1) copper[0].a.x = copper[0].b.x = 3
      if (revision === 2) input.minBoardEdgeClearance = 0.4
      if (revision === 3) width = 0.3
      if (revision === 4) input.outline![4].y = input.outline![5].y = -2
      if (revision === 5) step = 0.25
      if (revision === 6) bounds.minX += 0.1
      if (revision === 7) input.bounds.maxY -= 0.5
      const scene = new VectorScene(input, connection, width, copper)
      const search = new GridVisibilitySearch(
        scene,
        connection.pointsToConnect[0],
        connection.pointsToConnect[1],
        [],
        0,
        undefined,
        { step, bounds },
      )
      const grid = search.getRoutingAccess()
      // Audit row-raster occupancy against the independent exact capsule predicate.
      for (let id = 0; id < grid.cellCount; id++) {
        const point = grid.point(id)
        expect(grid.isBlocked(id)).toBe(
          !boardOutline.boardSegmentIsClear({
            input,
            start: point,
            end: point,
            copperRadiusMm: width / 2,
          }) ||
            scene.copper.some((item) =>
              copperTooClose(point, point, item, scene.margin - 1e-8),
            ),
        )
      }
      // Marking this search's copper must not contaminate the cached board.
      const board = getBoardGrid({
        input,
        copperRadiusMm: width / 2,
        xs: Float64Array.from(
          { length: grid.nx },
          (_, x) => bounds.minX + x * step,
        ),
        ys: Float64Array.from(
          { length: grid.ny },
          (_, y) => bounds.minY + y * step,
        ),
        step,
      })
      expect(board.some((blocked, id) => !blocked && grid.isBlocked(id))).toBe(
        true,
      )
      search.cancel()
      predicate.mockClear()
    }
  } finally {
    predicate.mockRestore()
  }
})
