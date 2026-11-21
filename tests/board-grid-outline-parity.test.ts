import { expect, test } from "bun:test"
import { getBoardGrid } from "../lib/board-grid"
import { boardSegmentIsClear } from "../lib/board-outline"
import { boardOutlineInput } from "./fixtures/board-outline"

test("row rasterization agrees with exact point clearance at outline boundaries", () => {
  const concave = boardOutlineInput().outline!
  const triangle = [
    { x: -5, y: -4 },
    { x: 5, y: -4 },
    { x: 0, y: 4 },
  ]
  const xs = Float64Array.from([-5, -4.8, -3, -1, -0.8, 0, 0.8, 1, 3, 4.8, 5])
  const ys = Float64Array.from([-4, -3.8, -1.2, -1, -0.8, 0, 3.8, 4])
  for (const outline of [
    undefined,
    concave,
    [...concave].reverse(),
    [...concave, concave[0]],
    triangle,
  ]) {
    for (const copperRadiusMm of [0, 0.05, 0.2]) {
      const input = { ...boardOutlineInput(), outline }
      const grid = getBoardGrid({ input, copperRadiusMm, xs, ys, step: 0.2 })
      const expected = Array.from(grid, (_, index) => {
        const point = {
          x: xs[index % xs.length],
          y: ys[Math.floor(index / xs.length)],
        }
        return Number(
          !boardSegmentIsClear({
            input,
            start: point,
            end: point,
            copperRadiusMm,
          }),
        )
      })
      expect(Array.from(grid)).toEqual(expected)
    }
  }
})
