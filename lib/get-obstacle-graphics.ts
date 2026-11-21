import type { Circle, Rect } from "graphics-debug"
import { layerColor } from "./layer-colors"
import type { Obstacle } from "./types"

export function getObstacleGraphics(obstacles: Obstacle[]) {
  const rects: Rect[] = []
  const circles: Circle[] = []

  for (const obstacle of obstacles) {
    for (const layer of obstacle.layers) {
      const stroke = layerColor(layer)
      if (obstacle.shape === "circle") {
        circles.push({
          center: obstacle.center,
          radius: obstacle.width / 2,
          layer,
          stroke,
          fill: "transparent",
        })
      } else {
        rects.push({
          center: obstacle.center,
          width: obstacle.width,
          height: obstacle.height,
          ccwRotationDegrees: obstacle.ccwRotationDegrees,
          layer,
          stroke,
          fill: `${stroke}30`,
        })
      }
    }
  }

  return { rects, circles }
}
