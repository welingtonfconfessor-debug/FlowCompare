import type { Bounds, DrawingTransform, Point, Segment } from "../types";

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

export function viewBoxForBounds(
  bounds: Bounds,
  aspectRatio: number,
  paddingRatio = 0.16,
  minimumSpan = 1,
): CanvasViewBox {
  const rawWidth = Math.max(0, bounds.maxX - bounds.minX);
  const rawHeight = Math.max(0, bounds.maxY - bounds.minY);
  const span = Math.max(rawWidth, rawHeight, minimumSpan);
  const padding = span * paddingRatio;
  let width = Math.max(rawWidth, minimumSpan) + padding * 2;
  let height = Math.max(rawHeight, minimumSpan) + padding * 2;
  const targetAspect = Math.max(Number.EPSILON, aspectRatio);
  const currentAspect = width / height;

  if (currentAspect < targetAspect) width = height * targetAspect;
  else height = width / targetAspect;

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = -(bounds.minY + bounds.maxY) / 2;
  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
  };
}

function clientToCanvasScale(rect: CanvasRect, viewBox: CanvasViewBox) {
  const horizontalScale = rect.width / viewBox.width;
  const verticalScale = rect.height / viewBox.height;
  return Math.max(Number.EPSILON, Math.min(horizontalScale, verticalScale));
}

export function canvasUnitsPerClientPixel(rect: CanvasRect, viewBox: CanvasViewBox) {
  return 1 / clientToCanvasScale(rect, viewBox);
}

export function canvasPointFromClient(
  clientX: number,
  clientY: number,
  rect: CanvasRect,
  viewBox: CanvasViewBox,
): Point {
  const scale = clientToCanvasScale(rect, viewBox);
  const renderedWidth = viewBox.width * scale;
  const renderedHeight = viewBox.height * scale;
  const offsetX = rect.left + (rect.width - renderedWidth) / 2;
  const offsetY = rect.top + (rect.height - renderedHeight) / 2;
  return {
    x: viewBox.x + (clientX - offsetX) / scale,
    y: viewBox.y + (clientY - offsetY) / scale,
  };
}

export function canvasDeltaFromClient(
  startClient: Point,
  currentClient: Point,
  rect: CanvasRect,
  viewBox: CanvasViewBox,
): Point {
  const scale = clientToCanvasScale(rect, viewBox);
  return {
    x: (currentClient.x - startClient.x) / scale,
    y: (currentClient.y - startClient.y) / scale,
  };
}

export function transformAfterCanvasDrag(
  start: DrawingTransform,
  startClient: Point,
  currentClient: Point,
  rect: CanvasRect,
  viewBox: CanvasViewBox,
): DrawingTransform {
  const delta = canvasDeltaFromClient(startClient, currentClient, rect, viewBox);
  return {
    ...start,
    x: start.x + delta.x,
    y: start.y - delta.y,
  };
}

export function measurementDistance(start: Point, end: Point) {
  return Math.hypot(end.x - start.x, end.y - start.y);
}

type CanvasSegment = {
  start: Point;
  end: Point;
};

function segmentIntersection(first: CanvasSegment, second: CanvasSegment): Point | null {
  const firstVector = {
    x: first.end.x - first.start.x,
    y: first.end.y - first.start.y,
  };
  const secondVector = {
    x: second.end.x - second.start.x,
    y: second.end.y - second.start.y,
  };
  const cross = firstVector.x * secondVector.y - firstVector.y * secondVector.x;
  if (Math.abs(cross) < 1e-10) return null;

  const offset = {
    x: second.start.x - first.start.x,
    y: second.start.y - first.start.y,
  };
  const firstRatio = (offset.x * secondVector.y - offset.y * secondVector.x) / cross;
  const secondRatio = (offset.x * firstVector.y - offset.y * firstVector.x) / cross;
  const epsilon = 1e-9;
  if (
    firstRatio < -epsilon ||
    firstRatio > 1 + epsilon ||
    secondRatio < -epsilon ||
    secondRatio > 1 + epsilon
  ) {
    return null;
  }

  return {
    x: first.start.x + firstRatio * firstVector.x,
    y: first.start.y + firstRatio * firstVector.y,
  };
}

function nearPoint(point: Point, segment: CanvasSegment, distance: number) {
  return (
    point.x >= Math.min(segment.start.x, segment.end.x) - distance &&
    point.x <= Math.max(segment.start.x, segment.end.x) + distance &&
    point.y >= Math.min(segment.start.y, segment.end.y) - distance &&
    point.y <= Math.max(segment.start.y, segment.end.y) + distance
  );
}

export function snapCanvasPoint(point: Point, segments: Segment[], maxDistance: number): Point | null {
  const canvasSegments = segments.map((segment) => ({
    start: { x: segment.a.x, y: -segment.a.y },
    end: { x: segment.b.x, y: -segment.b.y },
  }));
  const nearbySegments = canvasSegments.filter((segment) => nearPoint(point, segment, maxDistance));

  let closestIntersection: Point | null = null;
  let closestIntersectionDistance = maxDistance;
  for (let firstIndex = 0; firstIndex < nearbySegments.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < nearbySegments.length; secondIndex += 1) {
      const intersection = segmentIntersection(
        nearbySegments[firstIndex],
        nearbySegments[secondIndex],
      );
      if (!intersection) continue;
      const distance = measurementDistance(point, intersection);
      if (distance <= closestIntersectionDistance) {
        closestIntersection = intersection;
        closestIntersectionDistance = distance;
      }
    }
  }
  if (closestIntersection) return closestIntersection;

  let closestEndpoint: Point | null = null;
  let closestEndpointDistance = maxDistance;
  for (const segment of nearbySegments) {
    for (const endpoint of [segment.start, segment.end]) {
      const distance = measurementDistance(point, endpoint);
      if (distance <= closestEndpointDistance) {
        closestEndpoint = endpoint;
        closestEndpointDistance = distance;
      }
    }
  }
  if (closestEndpoint) return closestEndpoint;

  let closest: Point | null = null;
  let closestDistance = maxDistance;

  for (const segment of canvasSegments) {
    const dx = segment.end.x - segment.start.x;
    const dy = segment.end.y - segment.start.y;
    const lengthSquared = dx * dx + dy * dy;
    const ratio = lengthSquared
      ? Math.max(0, Math.min(1, ((point.x - segment.start.x) * dx + (point.y - segment.start.y) * dy) / lengthSquared))
      : 0;
    const candidate = {
      x: segment.start.x + ratio * dx,
      y: segment.start.y + ratio * dy,
    };
    const distance = measurementDistance(point, candidate);
    if (distance <= closestDistance) {
      closest = candidate;
      closestDistance = distance;
    }
  }

  return closest;
}
