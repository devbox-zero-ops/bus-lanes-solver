import { expect, test } from "bun:test"
import { BusLanesSolver } from "../lib"
import { boardOutlineInput } from "./fixtures/board-outline"

test("draws a rotated rectangular pad at its physical size on each layer", () => {
  const pad = {
    center: { x: 2, y: -1 },
    width: 1.475,
    height: 0.2,
    ccwRotationDegrees: 315,
  }
  const solver = new BusLanesSolver({
    ...boardOutlineInput(),
    obstacles: [{ ...pad, layers: ["top", "bottom"], connectedTo: [] }],
  })
  expect(solver.visualize().rects).toMatchObject([
    { ...pad, layer: "top" },
    { ...pad, layer: "bottom" },
  ])
})

test("AM62L fixed copper is visible at iteration zero and unchanged after a routing attempt", async () => {
  const input = await Bun.file(
    new URL("./fixtures/two-fanouts/ddr_right_io_left.json", import.meta.url),
  ).json()
  const solver = new BusLanesSolver(input)
  const initial = solver.visualize()
  const fixedLines = (graphics: ReturnType<typeof solver.visualize>) =>
    graphics.lines?.filter((line) => line.label?.startsWith("Fixed fanout"))
  expect(fixedLines(initial)!.length).toBeGreaterThan(100)
  expect(
    new Set(fixedLines(initial)!.map((line) => line.layer)).size,
  ).toBeGreaterThan(1)
  expect(
    new Set(fixedLines(initial)!.map((line) => line.strokeColor)).size,
  ).toBeGreaterThan(1)
  expect(initial.circles!.length).toBeGreaterThan(0)
  expect(solver.iterations).toBe(0)
  expect(solver.phase).toBe("validate")
  expect(solver.traces).toEqual([])
  expect(solver.visualize()).toEqual(initial)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(fixedLines(solver.visualize())).toEqual(fixedLines(initial))
  expect(solver.visualize().rects).toEqual(initial.rects)
})
