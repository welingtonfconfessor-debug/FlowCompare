import type {
  Bounds,
  DrawingTransform,
  EntityGeometry,
  GeometryStats,
  Point,
  Segment,
} from "../types";

export type RawEntity = Record<string, unknown> & {
  type?: string;
  layer?: string;
};

export type GeometryComponent = {
  id: string;
  entityIds: string[];
  segments: Segment[];
  bounds: Bounds;
  closed: boolean;
  length: number;
};

const EMPTY_BOUNDS: Bounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
const BEND_LAYER = /(bend|fold|dobra|vinco)/i;

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function pointValue(value: unknown): Point | null {
  if (!value || typeof value !== "object") return null;
  const point = value as Record<string, unknown>;
  if (typeof point.x !== "number" || typeof point.y !== "number") return null;
  return { x: point.x, y: point.y };
}

function scalePoint(point: Point, scale: number): Point {
  return { x: point.x * scale, y: point.y * scale };
}

function createSegment(
  a: Point,
  b: Point,
  entityId: string,
  entityType: string,
  layer: string,
): Segment {
  return { a, b, entityId, entityType, layer };
}

function normalizeAngle(value: number) {
  return Math.abs(value) > Math.PI * 2 + 0.001 ? (value * Math.PI) / 180 : value;
}

function sampleArc(
  center: Point,
  radius: number,
  startAngle: number,
  endAngle: number,
  entityId: string,
  entityType: string,
  layer: string,
  fullCircle = false,
) {
  const start = normalizeAngle(startAngle);
  let end = normalizeAngle(endAngle);
  if (fullCircle) end = start + Math.PI * 2;
  while (end <= start) end += Math.PI * 2;
  const sweep = end - start;
  const count = Math.max(16, Math.min(144, Math.ceil((sweep * Math.max(radius, 1)) / 3)));
  const segments: Segment[] = [];
  let previous = {
    x: center.x + Math.cos(start) * radius,
    y: center.y + Math.sin(start) * radius,
  };
  for (let index = 1; index <= count; index += 1) {
    const angle = start + (sweep * index) / count;
    const next = {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };
    segments.push(createSegment(previous, next, entityId, entityType, layer));
    previous = next;
  }
  return segments;
}

function sampleBulge(
  start: Point,
  end: Point,
  bulge: number,
  entityId: string,
  entityType: string,
  layer: string,
) {
  if (Math.abs(bulge) < 0.000001) {
    return [createSegment(start, end, entityId, entityType, layer)];
  }
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chord = Math.hypot(dx, dy);
  if (!chord) return [];
  const sweep = 4 * Math.atan(bulge);
  const radius = Math.abs(chord / (2 * Math.sin(sweep / 2)));
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const offset = Math.sqrt(Math.max(0, radius * radius - (chord * chord) / 4));
  const direction = bulge > 0 ? 1 : -1;
  const center = {
    x: midpoint.x + (-dy / chord) * offset * direction,
    y: midpoint.y + (dx / chord) * offset * direction,
  };
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const count = Math.max(6, Math.min(72, Math.ceil((Math.abs(sweep) * radius) / 3)));
  const segments: Segment[] = [];
  let previous = start;
  for (let index = 1; index <= count; index += 1) {
    const angle = startAngle + (sweep * index) / count;
    const next =
      index === count
        ? end
        : { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
    segments.push(createSegment(previous, next, entityId, entityType, layer));
    previous = next;
  }
  return segments;
}

export function boundsFromSegments(segments: Segment[]): Bounds {
  if (!segments.length) return { ...EMPTY_BOUNDS };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const segment of segments) {
    minX = Math.min(minX, segment.a.x, segment.b.x);
    minY = Math.min(minY, segment.a.y, segment.b.y);
    maxX = Math.max(maxX, segment.a.x, segment.b.x);
    maxY = Math.max(maxY, segment.a.y, segment.b.y);
  }
  return { minX, minY, maxX, maxY };
}

export function unionBounds(bounds: Bounds[]): Bounds {
  if (!bounds.length) return { ...EMPTY_BOUNDS };
  return bounds.reduce(
    (result, current) => ({
      minX: Math.min(result.minX, current.minX),
      minY: Math.min(result.minY, current.minY),
      maxX: Math.max(result.maxX, current.maxX),
      maxY: Math.max(result.maxY, current.maxY),
    }),
    { ...bounds[0] },
  );
}

export function segmentLength(segment: Segment) {
  return Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y);
}

function polygonArea(points: Point[]) {
  if (points.length < 3) return 0;
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return Math.abs(area / 2);
}

function entityArea(segments: Segment[], closed: boolean) {
  if (!closed || segments.length < 3) return 0;
  return Math.abs(
    segments.reduce(
      (area, segment) => area + segment.a.x * segment.b.y - segment.b.x * segment.a.y,
      0,
    ) / 2,
  );
}

function pointsFromEntity(entity: RawEntity) {
  const candidates = entity.vertices ?? entity.controlPoints ?? entity.fitPoints;
  if (!Array.isArray(candidates)) return [];
  return candidates.map(pointValue).filter((point): point is Point => Boolean(point));
}

export function entityToGeometry(entity: RawEntity, index: number, scale = 1): EntityGeometry | null {
  const type = String(entity.type ?? "UNKNOWN").toUpperCase();
  const layer = String(entity.layer ?? "0");
  const id = `entity-${index}`;
  let segments: Segment[] = [];
  let closed = false;
  let radius: number | undefined;

  if (type === "LINE") {
    const vertices = pointsFromEntity(entity).map((point) => scalePoint(point, scale));
    const start = vertices[0] ?? (pointValue(entity.start) && scalePoint(pointValue(entity.start)!, scale));
    const end = vertices[1] ?? (pointValue(entity.end) && scalePoint(pointValue(entity.end)!, scale));
    if (start && end) segments.push(createSegment(start, end, id, type, layer));
  } else if (type === "LWPOLYLINE" || type === "POLYLINE" || type === "SPLINE") {
    const rawPoints = (entity.vertices ?? entity.controlPoints ?? entity.fitPoints) as unknown;
    if (Array.isArray(rawPoints)) {
      const points = rawPoints
        .map((value) => {
          const point = pointValue(value);
          if (!point) return null;
          const record = value as Record<string, unknown>;
          return { ...scalePoint(point, scale), bulge: numberValue(record.bulge) };
        })
        .filter((point): point is Point & { bulge: number } => Boolean(point));
      closed = Boolean(entity.shape || entity.closed || (numberValue(entity.flags) & 1));
      for (let pointIndex = 0; pointIndex < points.length - 1; pointIndex += 1) {
        const start = points[pointIndex];
        const end = points[pointIndex + 1];
        segments.push(...sampleBulge(start, end, start.bulge, id, type, layer));
      }
      if (closed && points.length > 2) {
        const start = points[points.length - 1];
        segments.push(...sampleBulge(start, points[0], start.bulge, id, type, layer));
      }
    }
  } else if (type === "CIRCLE" || type === "ARC") {
    const centerRaw = pointValue(entity.center);
    radius = numberValue(entity.radius) * scale;
    if (centerRaw && radius > 0) {
      const center = scalePoint(centerRaw, scale);
      closed = type === "CIRCLE";
      segments = sampleArc(
        center,
        radius,
        numberValue(entity.startAngle),
        numberValue(entity.endAngle, Math.PI * 2),
        id,
        type,
        layer,
        closed,
      );
    }
  } else if (type === "ELLIPSE") {
    const centerRaw = pointValue(entity.center);
    const majorRaw = pointValue(entity.majorAxisEndPoint ?? entity.majorAxis);
    if (centerRaw && majorRaw) {
      const center = scalePoint(centerRaw, scale);
      const major = scalePoint(majorRaw, scale);
      const majorRadius = Math.hypot(major.x, major.y);
      const minorRadius = majorRadius * numberValue(entity.axisRatio, 1);
      const rotation = Math.atan2(major.y, major.x);
      const start = normalizeAngle(numberValue(entity.startAngle));
      let end = normalizeAngle(numberValue(entity.endAngle, Math.PI * 2));
      while (end <= start) end += Math.PI * 2;
      closed = Math.abs(end - start - Math.PI * 2) < 0.01;
      const count = 96;
      let previous: Point | null = null;
      for (let pointIndex = 0; pointIndex <= count; pointIndex += 1) {
        const angle = start + ((end - start) * pointIndex) / count;
        const localX = Math.cos(angle) * majorRadius;
        const localY = Math.sin(angle) * minorRadius;
        const next = {
          x: center.x + localX * Math.cos(rotation) - localY * Math.sin(rotation),
          y: center.y + localX * Math.sin(rotation) + localY * Math.cos(rotation),
        };
        if (previous) segments.push(createSegment(previous, next, id, type, layer));
        previous = next;
      }
    }
  }

  if (!segments.length) return null;
  const bounds = boundsFromSegments(segments);
  const length = segments.reduce((sum, segment) => sum + segmentLength(segment), 0);
  return {
    id,
    type,
    layer,
    segments,
    bounds,
    closed,
    length,
    area: type === "CIRCLE" && radius ? Math.PI * radius * radius : entityArea(segments, closed),
    radius,
    isBend: BEND_LAYER.test(layer),
  };
}

export function transformPoint(point: Point, transform: DrawingTransform): Point {
  const angle = (transform.rotation * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: point.x * cosine - point.y * sine + transform.x,
    y: point.x * sine + point.y * cosine + transform.y,
  };
}

export function transformSegment(segment: Segment, transform: DrawingTransform): Segment {
  return {
    ...segment,
    a: transformPoint(segment.a, transform),
    b: transformPoint(segment.b, transform),
  };
}

export function transformBounds(bounds: Bounds, transform: DrawingTransform): Bounds {
  const corners = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ].map((point) => transformPoint(point, transform));
  return {
    minX: Math.min(...corners.map((point) => point.x)),
    minY: Math.min(...corners.map((point) => point.y)),
    maxX: Math.max(...corners.map((point) => point.x)),
    maxY: Math.max(...corners.map((point) => point.y)),
  };
}

function pointBucket(point: Point, tolerance: number) {
  return {
    x: Math.floor(point.x / tolerance),
    y: Math.floor(point.y / tolerance),
  };
}

function bucketKey(x: number, y: number) {
  return `${x}:${y}`;
}

function forNearbyBuckets(point: Point, tolerance: number, callback: (key: string) => void) {
  const bucket = pointBucket(point, tolerance);
  for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      callback(bucketKey(bucket.x + offsetX, bucket.y + offsetY));
    }
  }
}

function pointsAreNear(first: Point, second: Point, tolerance: number) {
  return Math.hypot(first.x - second.x, first.y - second.y) <= tolerance;
}

type ClosedRing = {
  points: Point[];
  entityIds: string[];
  area: number;
  bounds: Bounds;
};

function closedRingsFromSegments(
  segments: Segment[],
  entities: Map<string, EntityGeometry>,
  tolerance: number,
): ClosedRing[] {
  const unused = new Set(segments.map((_, index) => index));
  const endpointBuckets = new Map<string, Array<{ index: number; point: Point }>>();

  segments.forEach((segment, index) => {
    for (const point of [segment.a, segment.b]) {
      const bucket = pointBucket(point, tolerance);
      const key = bucketKey(bucket.x, bucket.y);
      endpointBuckets.set(key, [...(endpointBuckets.get(key) ?? []), { index, point }]);
    }
  });

  const nextSegment = (point: Point) => {
    let match: number | undefined;
    forNearbyBuckets(point, tolerance, (key) => {
      if (match !== undefined) return;
      match = endpointBuckets
        .get(key)
        ?.find((candidate) => unused.has(candidate.index) && pointsAreNear(candidate.point, point, tolerance))
        ?.index;
    });
    return match;
  };

  const rings: ClosedRing[] = [];
  while (unused.size) {
    const firstIndex = unused.values().next().value as number;
    const first = segments[firstIndex];
    unused.delete(firstIndex);
    const points = [first.a, first.b];
    const ringSegments = [first];
    let current = first.b;
    let closed = false;

    for (let guard = 0; guard < segments.length; guard += 1) {
      if (points.length >= 4 && pointsAreNear(current, points[0], tolerance)) {
        closed = true;
        break;
      }
      const candidateIndex = nextSegment(current);
      if (candidateIndex === undefined) break;
      const candidate = segments[candidateIndex];
      unused.delete(candidateIndex);
      ringSegments.push(candidate);
      current = pointsAreNear(candidate.a, current, tolerance) ? candidate.b : candidate.a;
      points.push(current);
    }

    if (!closed) continue;
    const polygon = points.slice(0, -1);
    const entityIds = Array.from(new Set(ringSegments.map((segment) => segment.entityId)));
    const singleEntity = entityIds.length === 1 ? entities.get(entityIds[0]) : undefined;
    rings.push({
      points: polygon,
      entityIds,
      area: singleEntity?.closed ? singleEntity.area : polygonArea(polygon),
      bounds: boundsFromSegments(ringSegments),
    });
  }
  return rings;
}

function pointInRing(point: Point, ring: ClosedRing) {
  if (
    point.x < ring.bounds.minX ||
    point.x > ring.bounds.maxX ||
    point.y < ring.bounds.minY ||
    point.y > ring.bounds.maxY
  ) {
    return false;
  }
  let inside = false;
  for (let index = 0, previous = ring.points.length - 1; index < ring.points.length; previous = index, index += 1) {
    const currentPoint = ring.points[index];
    const previousPoint = ring.points[previous];
    const crosses =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function netGeometryArea(entities: EntityGeometry[], connectionTolerance = 0.01) {
  const areaEntities = entities.filter((entity) => !entity.isBend);
  const entityMap = new Map(areaEntities.map((entity) => [entity.id, entity]));
  const rings = closedRingsFromSegments(
    areaEntities.flatMap((entity) => entity.segments),
    entityMap,
    Math.max(connectionTolerance, 0.000001),
  );

  const netArea = rings.reduce((total, ring, index) => {
    const probe = ring.points[0];
    const nestingDepth = rings.reduce(
      (depth, candidate, candidateIndex) =>
        candidateIndex !== index && pointInRing(probe, candidate) ? depth + 1 : depth,
      0,
    );
    return total + (nestingDepth % 2 === 0 ? ring.area : -ring.area);
  }, 0);
  return Math.max(0, netArea);
}

export function areaToleranceFromLinear(width: number, height: number, tolerance: number) {
  const linearTolerance = Math.max(0.001, tolerance);
  return Math.max(
    linearTolerance * linearTolerance,
    (Math.max(0, width) + Math.max(0, height)) * linearTolerance + linearTolerance * linearTolerance,
  );
}

function componentIsClosed(segments: Segment[], tolerance: number) {
  if (segments.length < 3) return false;
  const buckets = new Map<string, Array<{ point: Point; degree: number }>>();
  const nodes: Array<{ point: Point; degree: number }> = [];

  for (const segment of segments) {
    for (const point of [segment.a, segment.b]) {
      let match: { point: Point; degree: number } | undefined;
      forNearbyBuckets(point, tolerance, (key) => {
        if (match) return;
        match = buckets
          .get(key)
          ?.find((node) => Math.hypot(node.point.x - point.x, node.point.y - point.y) <= tolerance);
      });
      if (match) {
        match.degree += 1;
        continue;
      }
      const node = { point, degree: 1 };
      nodes.push(node);
      const bucket = pointBucket(point, tolerance);
      const key = bucketKey(bucket.x, bucket.y);
      buckets.set(key, [...(buckets.get(key) ?? []), node]);
    }
  }

  return nodes.length >= 3 && nodes.every((node) => node.degree % 2 === 0);
}

export function connectedGeometryComponents(
  entities: EntityGeometry[],
  connectionTolerance = 0.01,
): GeometryComponent[] {
  if (!entities.length) return [];
  const tolerance = Math.max(connectionTolerance, 0.000001);
  const parent = entities.map((_, index) => index);
  const find = (index: number): number => {
    if (parent[index] !== index) parent[index] = find(parent[index]);
    return parent[index];
  };
  const unite = (first: number, second: number) => {
    const firstRoot = find(first);
    const secondRoot = find(second);
    if (firstRoot !== secondRoot) parent[secondRoot] = firstRoot;
  };
  const endpointBuckets = new Map<string, Array<{ point: Point; entityIndex: number }>>();

  entities.forEach((entity, entityIndex) => {
    entity.segments.forEach((segment) => {
      for (const point of [segment.a, segment.b]) {
        forNearbyBuckets(point, tolerance, (key) => {
          endpointBuckets.get(key)?.forEach((candidate) => {
            if (Math.hypot(candidate.point.x - point.x, candidate.point.y - point.y) <= tolerance) {
              unite(entityIndex, candidate.entityIndex);
            }
          });
        });
        const bucket = pointBucket(point, tolerance);
        const key = bucketKey(bucket.x, bucket.y);
        endpointBuckets.set(key, [
          ...(endpointBuckets.get(key) ?? []),
          { point, entityIndex },
        ]);
      }
    });
  });

  const groups = new Map<number, EntityGeometry[]>();
  entities.forEach((entity, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), entity]);
  });

  return Array.from(groups.values()).map((group, index) => {
    const segments = group.flatMap((entity) => entity.segments);
    return {
      id: `component-${index}`,
      entityIds: group.map((entity) => entity.id),
      segments,
      bounds: boundsFromSegments(segments),
      closed: componentIsClosed(segments, tolerance),
      length: segments.reduce((sum, segment) => sum + segmentLength(segment), 0),
    };
  });
}

export function geometryStats(entities: EntityGeometry[], bounds: Bounds): GeometryStats {
  const contourComponents = connectedGeometryComponents(
    entities.filter((entity) => !entity.isBend && entity.type !== "CIRCLE"),
  ).filter((component) => component.closed);
  return {
    totalLength: entities.reduce((sum, entity) => sum + entity.length, 0),
    area: netGeometryArea(entities),
    width: Math.max(0, bounds.maxX - bounds.minX),
    height: Math.max(0, bounds.maxY - bounds.minY),
    holes: entities.filter((entity) => entity.type === "CIRCLE").length,
    cutouts: Math.max(0, contourComponents.length - 1),
    contours: contourComponents.length,
    bends: entities.filter((entity) => entity.isBend).length,
  };
}

export function nearestDistance(point: Point, segments: Segment[]) {
  let closest = Number.POSITIVE_INFINITY;
  for (const segment of segments) {
    const dx = segment.b.x - segment.a.x;
    const dy = segment.b.y - segment.a.y;
    const lengthSquared = dx * dx + dy * dy;
    const ratio = lengthSquared
      ? Math.max(0, Math.min(1, ((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) / lengthSquared))
      : 0;
    const projection = { x: segment.a.x + ratio * dx, y: segment.a.y + ratio * dy };
    closest = Math.min(closest, Math.hypot(point.x - projection.x, point.y - projection.y));
  }
  return closest;
}

export function sampleSegments(segments: Segment[], step: number) {
  const points: Point[] = [];
  for (const segment of segments) {
    const length = segmentLength(segment);
    const count = Math.max(1, Math.min(500, Math.ceil(length / Math.max(step, 0.1))));
    for (let index = 0; index <= count; index += 1) {
      const ratio = index / count;
      points.push({
        x: segment.a.x + (segment.b.x - segment.a.x) * ratio,
        y: segment.a.y + (segment.b.y - segment.a.y) * ratio,
      });
    }
  }
  return points;
}
