import { expect, spyOn, test } from "bun:test"
import { createSegmentVisibilityChecker } from "../lib/create-segment-visibility-checker"
import { fixedCopper, VectorScene } from "../lib/vector-scene"
import { boardOutlineInput } from "./fixtures/board-outline"

test("reuses only known ray prefixes and checks the rest of each connector", () => {
  const input = boardOutlineInput()
  input.obstacles.push({
    center: { x: -1, y: -2 },
    width: 0.4,
    height: 0.4,
    layers: ["top"],
    connectedTo: [],
  })
  const origin = { x: -3, y: -2 }
  const scene = new VectorScene(
    input,
    input.connections[0],
    0.1,
    fixedCopper(input),
  )
  const endpoints = [
    { x: -2, y: -2 },
    { x: -2.5, y: -2 },
    { x: 0, y: -2 },
    { x: 1, y: -2 },
    { x: -4.5, y: -2 },
    { x: -4, y: -2 },
    { x: -3, y: 2 },
    { x: -3, y: 1 },
    { x: -3, y: -3.5 },
    { x: -3, y: -3 },
    { x: -2.5, y: -1.5 },
  ]
  const expectedVisibility = endpoints.map((end) => scene.visible(origin, end))
  const isFirstSegmentVisible = createSegmentVisibilityChecker(scene, origin)
  const visibilityChecks = spyOn(scene, "visible")
  try {
    expect(endpoints.map(isFirstSegmentVisible)).toEqual(expectedVisibility)
    expect(visibilityChecks).toHaveBeenCalledTimes(6)
  } finally {
    visibilityChecks.mockRestore()
  }
  // The first leg is clear. The second crosses the concave board cutout.
  expect(
    scene.pathVisible(
      [origin, { x: -3, y: 1 }, { x: 3, y: 1 }],
      isFirstSegmentVisible,
    ),
  ).toBe(false)
  const otherOrigin = { x: 3, y: -2 }
  expect(
    createSegmentVisibilityChecker(scene, otherOrigin)({ x: 1, y: -2 }),
  ).toBe(true)
  const padCenter = input.obstacles[0].center
  expect(createSegmentVisibilityChecker(scene, padCenter)(padCenter)).toBe(
    false,
  )
})
