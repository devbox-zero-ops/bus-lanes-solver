import { pointSegmentDistanceToPoints } from "./geometry"
import type { Point, SimpleRouteJson } from "./types"

type BoardGridKey = string

// Retain board rasters across search bounds, independently of copper.
// Oversized rasters are used by their caller without retaining another copy.
const boardGrids = new WeakMap<SimpleRouteJson, Map<BoardGridKey, Uint8Array>>()
const maxBoardGridBytes = 16 * 1024 * 1024

/** Read-only board occupancy in board-world mm; callers copy it before marking copper. */
export function getBoardGrid({
  input,
  copperRadiusMm,
  xs,
  ys,
  step,
}: {
  input: SimpleRouteJson
  copperRadiusMm: number
  xs: Float64Array
  ys: Float64Array
  step: number
}): Uint8Array {
  const key: BoardGridKey = JSON.stringify([
    xs[0],
    ys[0],
    xs.length,
    ys.length,
    step,
    copperRadiusMm,
    input.bounds,
    input.outline,
    input.minBoardEdgeClearance,
  ])
  const grids = boardGrids.get(input) ?? new Map<BoardGridKey, Uint8Array>()
  const previous = grids.get(key)
  if (previous) {
    grids.delete(key)
    grids.set(key, previous)
    return previous
  }
  const blocked = new Uint8Array(xs.length * ys.length)
  const margin = copperRadiusMm + (input.minBoardEdgeClearance ?? 0)
  const ring = input.outline ?? []
  for (let y = 0; y < ys.length; y++) {
    const py = ys[y]
    const crossings: number[] = []
    const nearbyEdges: [Point, Point][] = []
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i],
        b = ring[(i + 1) % ring.length]
      if (a.y > py !== b.y > py)
        crossings.push(((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x)
      if (
        Math.max(a.y, b.y) >= py - margin &&
        Math.min(a.y, b.y) <= py + margin
      )
        nearbyEdges.push([a, b])
    }
    for (let x = 0; x < xs.length; x++) {
      const point = { x: xs[x], y: py }
      let inside = !ring.length
      for (const crossing of crossings) if (point.x < crossing) inside = !inside
      if (
        !inside ||
        point.x < input.bounds.minX + margin - 1e-9 ||
        point.x > input.bounds.maxX - margin + 1e-9 ||
        point.y < input.bounds.minY + margin - 1e-9 ||
        point.y > input.bounds.maxY - margin + 1e-9 ||
        nearbyEdges.some(
          ([a, b]) =>
            Math.max(a.x, b.x) >= point.x - margin &&
            Math.min(a.x, b.x) <= point.x + margin &&
            !(pointSegmentDistanceToPoints(point, a, b) >= margin - 1e-9),
        )
      )
        blocked[x + y * xs.length] = 1
    }
  }
  if (blocked.byteLength <= maxBoardGridBytes) {
    let retained = [...grids.values()].reduce(
      (sum, grid) => sum + grid.byteLength,
      0,
    )
    while (retained + blocked.byteLength > maxBoardGridBytes && grids.size) {
      const oldest = grids.keys().next().value!
      retained -= grids.get(oldest)!.byteLength
      grids.delete(oldest)
    }
    grids.set(key, blocked)
    boardGrids.set(input, grids)
  }
  return blocked
}
