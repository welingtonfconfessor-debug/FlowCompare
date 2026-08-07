import type { DrawingTransform, Point, Segment } from "../types";

export type CanvasRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type CanvasViewBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function canvasPointFromClient(
  clientX: number,
  clientY: number,
  rect: CanvasRect,
  viewBox: CanvasViewBox,
): Point {
  return {
    x: viewBox.x + ((clientX - rect.left) / rect.width) * viewBox.width,
    y: viewBox.y + ((clientY - rect.top) / rect.height) * viewBox.height,
  };
}

export function transformAfterCanvasDrag(
  start: DrawingTransform,
  startClient: Point,
  currentClient: Point,
  rect: CanvasRect,
  viewBox: CanvasViewBox,
): DrawingTransform {
  const deltaX = ((currentClient.x - startClient.x) / rect.width) * viewBox.width;
  const deltaSvgY = ((currentClient.y - startClient.y) / rect.height) * viewBox.height;
  return {
    ...start,
    x: start.x + deltaX,
    y: start.y - deltaSvgY,
  };
}

export function measurementDistance(start: Point, end: Point) {
  return Math.hypot(end.x - start.x, end.y - start.y);
}

export function snapCanvasPoint(point: Point, segments: Segment[], maxDistance: number): Point | null {
  let closest: Point | null = null;
  let closestDistance = maxDistance;

  for (const segment of segments) {
    const start = { x: segment.a.x, y: -segment.a.y };
    const end = { x: segment.b.x, y: -segment.b.y };
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const ratio = lengthSquared
      ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
      : 0;
    const candidate = { x: start.x + ratio * dx, y: start.y + ratio * dy };
    const distance = measurementDistance(point, candidate);
    if (distance <= closestDistance) {
      closest = candidate;
      closestDistance = distance;
    }
  }

  return closest;
}
