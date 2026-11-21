import { expect, test } from "bun:test"
import { boardSegmentIsClear } from "../lib/board-outline"
import { boardOutlineInput } from "./fixtures/board-outline"

test("outline bounds preserve exact diagonal-edge and capsule clearance", () => {
  const input = {
    ...boardOutlineInput(),
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    outline: [
      { x: 0, y: 4 },
      { x: 4, y: 0 },
      { x: 0, y: -4 },
      { x: -4, y: 0 },
    ],
  }
  const tangentY = 3 - 0.5 * Math.SQRT2
  for (const [point, clear] of [
    [{ x: 0, y: 0 }, true],
    [{ x: 1.5, y: 1.5 }, true],
    [{ x: 1.7, y: 1.7 }, false],
    [{ x: 1, y: tangentY }, true],
    [{ x: 1, y: tangentY + 4e-9 }, false],
    [{ x: 3, y: 2 }, false],
  ] as const) {
    expect(
      boardSegmentIsClear({
        input,
        start: point,
        end: point,
        copperRadiusMm: 0.3,
      }),
    ).toBe(clear)
  }
  for (const [y, clear] of [
    [2.2, true],
    [2.4, false],
  ] as const) {
    expect(
      boardSegmentIsClear({
        input,
        start: { x: -1, y },
        end: { x: 1, y },
        copperRadiusMm: 0.3,
      }),
    ).toBe(clear)
  }
})
