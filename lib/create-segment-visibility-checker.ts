import type { Point } from "./types"
import type { VectorScene } from "./vector-scene"

function createAxisVisibilityBounds(originCoordinate: number) {
  return {
    originCoordinate,
    minClearCoordinate: Infinity,
    maxClearCoordinate: -Infinity,
    blockedAtOrBelow: -Infinity,
    blockedAtOrAbove: Infinity,
  }
}

/** All clear segments along one axis share the origin and form a single interval. */
export function createSegmentVisibilityChecker(
  scene: VectorScene,
  origin: Point,
) {
  const horizontalBounds = createAxisVisibilityBounds(origin.x)
  const verticalBounds = createAxisVisibilityBounds(origin.y)

  return (end: Point): boolean => {
    const isHorizontal = end.y === origin.y
    if (!isHorizontal && end.x !== origin.x) return scene.visible(origin, end)

    const bounds = isHorizontal ? horizontalBounds : verticalBounds
    const endCoordinate = isHorizontal ? end.x : end.y
    if (
      endCoordinate <= bounds.blockedAtOrBelow ||
      endCoordinate >= bounds.blockedAtOrAbove
    )
      return false
    // A custom board outline checks the requested segment before reusing copper clearance.
    if (scene.input.outline?.length && !scene.boardEdgeIsClear(origin, end))
      return false
    if (
      endCoordinate >= bounds.minClearCoordinate &&
      endCoordinate <= bounds.maxClearCoordinate
    )
      return true

    const isVisible = scene.visible(origin, end)
    if (isVisible) {
      bounds.minClearCoordinate = Math.min(
        bounds.minClearCoordinate,
        bounds.originCoordinate,
        endCoordinate,
      )
      bounds.maxClearCoordinate = Math.max(
        bounds.maxClearCoordinate,
        bounds.originCoordinate,
        endCoordinate,
      )
    } else if (endCoordinate < bounds.originCoordinate) {
      bounds.blockedAtOrBelow = endCoordinate
    } else {
      bounds.blockedAtOrAbove = endCoordinate
    }
    return isVisible
  }
}
