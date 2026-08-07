import type {
  Bounds,
  ComparisonResult,
  Difference,
  DifferenceCategory,
  DifferenceSeverity,
  DrawingTransform,
  DxfDocument,
  EntityGeometry,
  Segment,
} from "../types";
import {
  boundsFromSegments,
  nearestDistance,
  sampleSegments,
  transformBounds,
  transformSegment,
} from "./geometry";

type CompareOptions = {
  tolerance: number;
  ignoreInternal: boolean;
};

const TYPE_LABELS: Record<string, string> = {
  LINE: "Linha",
  LWPOLYLINE: "Polilinha",
  POLYLINE: "Polilinha",
  SPLINE: "Spline",
  CIRCLE: "Furo",
  ARC: "Arco",
  ELLIPSE: "Elipse",
};

function severityFor(value: number, tolerance: number): DifferenceSeverity {
  if (value <= tolerance) return "correct";
  if (value <= tolerance * 5) return "small";
  return "large";
}

function entityCategory(entity: EntityGeometry): DifferenceCategory {
  if (entity.isBend) return "bend";
  if (entity.type === "CIRCLE") return "hole";
  if (entity.closed) return "contour";
  return "geometry";
}

function entityLabel(entity: EntityGeometry, index: number, externalId: string | undefined) {
  if (entity.id === externalId) return "Contorno externo";
  if (entity.isBend) return `Linha de dobra ${index + 1}`;
  if (entity.type === "CIRCLE" && entity.radius) {
    return `Furo Ø${(entity.radius * 2).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}`;
  }
  if (entity.closed) return `Recorte ${index + 1}`;
  return `${TYPE_LABELS[entity.type] ?? entity.type} ${index + 1}`;
}

function largestClosedId(entities: EntityGeometry[]) {
  return entities
    .filter((entity) => entity.closed)
    .sort((first, second) => second.area - first.area)[0]?.id;
}

function entityDistance(entity: EntityGeometry, target: Segment[], tolerance: number) {
  const diagonal = Math.hypot(
    entity.bounds.maxX - entity.bounds.minX,
    entity.bounds.maxY - entity.bounds.minY,
  );
  const step = Math.max(tolerance * 0.75, diagonal / 80, 0.2);
  const points = sampleSegments(entity.segments, step);
  if (!points.length || !target.length) return Number.POSITIVE_INFINITY;
  return points.reduce((maximum, point) => Math.max(maximum, nearestDistance(point, target)), 0);
}

function metricDifference(
  id: string,
  label: string,
  category: DifferenceCategory,
  aValue: number,
  bValue: number,
  tolerance: number,
  bounds: Bounds,
): Difference {
  const signedValue = bValue - aValue;
  const value = Math.abs(signedValue);
  return {
    id,
    label,
    category,
    severity: severityFor(value, tolerance),
    value,
    signedValue,
    bounds,
    source: "metric",
  };
}

function entityDifferences(
  sourceEntities: EntityGeometry[],
  targetSegments: Segment[],
  tolerance: number,
  source: "A" | "B",
  transform?: DrawingTransform,
) {
  const externalId = largestClosedId(sourceEntities);
  return sourceEntities.map((entity, index): Difference => {
    const workingSegments = transform
      ? entity.segments.map((segment) => transformSegment(segment, transform))
      : entity.segments;
    const workingEntity = transform
      ? { ...entity, segments: workingSegments, bounds: transformBounds(entity.bounds, transform) }
      : entity;
    const value = entityDistance(workingEntity, targetSegments, tolerance);
    return {
      id: `${source}-${entity.id}`,
      label: entityLabel(entity, index, externalId),
      category: entityCategory(entity),
      severity: severityFor(value, tolerance),
      value,
      signedValue: source === "B" ? value : -value,
      bounds: boundsFromSegments(workingSegments),
      source,
    };
  });
}

function filterInternal(document: DxfDocument, ignoreInternal: boolean) {
  if (!ignoreInternal) return document.entities;
  const external = largestClosedId(document.entities);
  return document.entities.filter((entity) => entity.id === external || !entity.closed);
}

export function compareDocuments(
  documentA: DxfDocument,
  documentB: DxfDocument,
  transform: DrawingTransform,
  options: CompareOptions,
): ComparisonResult {
  const tolerance = Math.max(0.001, options.tolerance);
  const entitiesA = filterInternal(documentA, options.ignoreInternal);
  const entitiesB = filterInternal(documentB, options.ignoreInternal);
  const segmentsA = entitiesA.flatMap((entity) => entity.segments);
  const transformedB = entitiesB
    .flatMap((entity) => entity.segments)
    .map((segment) => transformSegment(segment, transform));

  const geometryA = entityDifferences(entitiesA, transformedB, tolerance, "A");
  const geometryB = entityDifferences(entitiesB, segmentsA, tolerance, "B", transform);
  const transformedBoundsB = transformBounds(documentB.bounds, transform);
  const metrics = [
    metricDifference(
      "metric-width",
      "Largura total",
      "dimension",
      documentA.stats.width,
      documentB.stats.width,
      tolerance,
      documentA.bounds,
    ),
    metricDifference(
      "metric-height",
      "Comprimento total",
      "dimension",
      documentA.stats.height,
      documentB.stats.height,
      tolerance,
      documentA.bounds,
    ),
    metricDifference(
      "metric-path",
      "Comprimento de geometria",
      "dimension",
      documentA.stats.totalLength,
      documentB.stats.totalLength,
      tolerance,
      documentA.bounds,
    ),
    metricDifference(
      "metric-holes",
      "Quantidade de furos",
      "hole",
      documentA.stats.holes,
      documentB.stats.holes,
      0.01,
      transformedBoundsB,
    ),
    metricDifference(
      "metric-cutouts",
      "Quantidade de recortes",
      "cutout",
      documentA.stats.cutouts,
      documentB.stats.cutouts,
      0.01,
      transformedBoundsB,
    ),
    metricDifference(
      "metric-contours",
      "Quantidade de contornos",
      "contour",
      documentA.stats.contours,
      documentB.stats.contours,
      0.01,
      transformedBoundsB,
    ),
  ];

  const differences = [...metrics, ...geometryA, ...geometryB].filter((difference) =>
    Number.isFinite(difference.value),
  );
  const correct = differences.filter((difference) => difference.severity === "correct").length;
  const small = differences.filter((difference) => difference.severity === "small").length;
  const large = differences.filter((difference) => difference.severity === "large").length;
  const allSamples = [
    ...sampleSegments(segmentsA, Math.max(tolerance, documentA.stats.width / 250, 0.25)).map((point) =>
      nearestDistance(point, transformedB),
    ),
    ...sampleSegments(transformedB, Math.max(tolerance, documentB.stats.width / 250, 0.25)).map((point) =>
      nearestDistance(point, segmentsA),
    ),
  ].filter(Number.isFinite);
  const withinTolerance = allSamples.filter((distance) => distance <= tolerance).length;
  const averageDistance = allSamples.length
    ? allSamples.reduce((sum, distance) => sum + distance, 0) / allSamples.length
    : 0;
  const drawingDiagonal = Math.max(
    Math.hypot(documentA.stats.width, documentA.stats.height),
    Math.hypot(documentB.stats.width, documentB.stats.height),
    tolerance,
  );
  const matchedRatio = allSamples.length ? withinTolerance / allSamples.length : 0;
  const distanceScore = 1 - Math.min(1, averageDistance / Math.max(drawingDiagonal * 0.02, tolerance));
  const similarity = Math.max(0, Math.min(100, (matchedRatio * 0.78 + distanceScore * 0.22) * 100));

  return {
    differences,
    similarity,
    totalCompared: differences.length,
    correct,
    small,
    large,
    maxDifference: Math.max(0, ...differences.map((difference) => difference.value)),
    transformedB,
  };
}
