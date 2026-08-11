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
  areaToleranceFromLinear,
  boundsFromSegments,
  connectedGeometryComponents,
  nearestDistance,
  sampleSegments,
  transformBounds,
  transformSegment,
  unionBounds,
  type GeometryComponent,
} from "./geometry";

type CompareOptions = {
  tolerance: number;
  ignoreInternal: boolean;
};

type ComparisonFeature = {
  id: string;
  label: string;
  category: DifferenceCategory;
  entityIds: string[];
  segments: Segment[];
  bounds: Bounds;
  length: number;
  kind: "line" | "shape";
  axis?: "horizontal" | "vertical";
};

function severityFor(value: number, tolerance: number): DifferenceSeverity {
  if (value <= tolerance) return "correct";
  if (value <= tolerance * 5) return "small";
  return "large";
}

function boundsArea(bounds: Bounds) {
  return Math.max(0, bounds.maxX - bounds.minX) * Math.max(0, bounds.maxY - bounds.minY);
}

function segmentAxis(segment: Segment) {
  const deltaX = Math.abs(segment.b.x - segment.a.x);
  const deltaY = Math.abs(segment.b.y - segment.a.y);
  const length = Math.hypot(deltaX, deltaY);
  if (!length) return undefined;
  if (deltaY <= length * 0.001) return "horizontal" as const;
  if (deltaX <= length * 0.001) return "vertical" as const;
  return undefined;
}

function axisFromSegments(segments: Segment[]) {
  const segment = segments.reduce<Segment | undefined>((longest, candidate) => {
    if (!longest) return candidate;
    const currentLength = Math.hypot(candidate.b.x - candidate.a.x, candidate.b.y - candidate.a.y);
    const longestLength = Math.hypot(longest.b.x - longest.a.x, longest.b.y - longest.a.y);
    return currentLength > longestLength ? candidate : longest;
  }, undefined);
  return segment ? segmentAxis(segment) : undefined;
}

function externalContourFeatures(component: GeometryComponent): ComparisonFeature[] {
  const diagonal = Math.hypot(
    component.bounds.maxX - component.bounds.minX,
    component.bounds.maxY - component.bounds.minY,
  );
  const minimumLength = Math.max(0.1, diagonal * 0.005);
  const boundaryTolerance = Math.max(0.01, diagonal * 0.00001);
  const edges = component.segments
    .map((segment) => ({
      segment,
      axis: segmentAxis(segment),
      length: Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y),
    }))
    .filter((edge): edge is typeof edge & { axis: "horizontal" | "vertical" } =>
      edge.axis !== undefined && edge.length >= minimumLength,
    );
  if (edges.length < 2) return [];

  const labels = new Map<string, number>();
  return edges.map((edge, index) => {
    const bounds = boundsFromSegments([edge.segment]);
    let baseLabel: string;
    if (edge.axis === "horizontal" && Math.abs(bounds.maxY - component.bounds.maxY) <= boundaryTolerance) {
      baseLabel = "Linha externa superior";
    } else if (edge.axis === "horizontal" && Math.abs(bounds.minY - component.bounds.minY) <= boundaryTolerance) {
      baseLabel = "Linha externa inferior";
    } else if (edge.axis === "vertical" && Math.abs(bounds.minX - component.bounds.minX) <= boundaryTolerance) {
      baseLabel = "Linha externa esquerda";
    } else if (edge.axis === "vertical" && Math.abs(bounds.maxX - component.bounds.maxX) <= boundaryTolerance) {
      baseLabel = "Linha externa direita";
    } else {
      baseLabel = edge.axis === "horizontal" ? "Trecho externo horizontal" : "Trecho externo vertical";
    }
    const count = (labels.get(baseLabel) ?? 0) + 1;
    labels.set(baseLabel, count);
    return {
      id: `${component.id}-edge-${index}`,
      label: count === 1 ? baseLabel : `${baseLabel} ${count}`,
      category: "contour",
      entityIds: [edge.segment.entityId],
      segments: [edge.segment],
      bounds,
      length: edge.length,
      kind: "line",
      axis: edge.axis,
    };
  });
}

function comparisonFeatures(entities: EntityGeometry[]): ComparisonFeature[] {
  const holes = entities.filter((entity) => entity.type === "CIRCLE" && !entity.isBend);
  const bends = entities.filter((entity) => entity.isBend);
  const components = connectedGeometryComponents(
    entities.filter((entity) => !entity.isBend && entity.type !== "CIRCLE"),
  );
  const closed = components.filter((component) => component.closed);
  const externalId = closed.sort(
    (first, second) => boundsArea(second.bounds) - boundsArea(first.bounds),
  )[0]?.id;
  let cutoutIndex = 0;
  let geometryIndex = 0;

  const componentFeatures = components.flatMap((component): ComparisonFeature[] => {
    let category: DifferenceCategory = "geometry";
    let label = `Geometria ${++geometryIndex}`;
    if (component.closed && component.id === externalId) {
      category = "contour";
      label = "Contorno externo";
      const contourLines = externalContourFeatures(component);
      if (contourLines.length) return contourLines;
    } else if (component.closed) {
      category = "cutout";
      label = `Recorte ${++cutoutIndex}`;
    }
    return [{
      id: component.id,
      label,
      category,
      entityIds: component.entityIds,
      segments: component.segments,
      bounds: component.bounds,
      length: component.length,
      kind: "shape",
    }];
  });

  const holeFeatures = holes.map((entity, index): ComparisonFeature => ({
    id: `hole-${entity.id}`,
    label: entity.radius
      ? `Furo Ø${(entity.radius * 2).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}`
      : `Furo ${index + 1}`,
    category: "hole",
    entityIds: [entity.id],
    segments: entity.segments,
    bounds: entity.bounds,
    length: entity.length,
    kind: "shape",
  }));

  const bendFeatures = bends.map((entity, index): ComparisonFeature => ({
    id: `bend-${entity.id}`,
    label: `Linha de dobra ${index + 1}`,
    category: "bend",
    entityIds: [entity.id],
    segments: entity.segments,
    bounds: entity.bounds,
    length: entity.length,
    kind: "line",
    axis: axisFromSegments(entity.segments),
  }));

  return [...componentFeatures, ...holeFeatures, ...bendFeatures];
}

function segmentSetDistance(source: Segment[], target: Segment[], tolerance: number) {
  if (!source.length || !target.length) return Number.POSITIVE_INFINITY;
  const bounds = boundsFromSegments(source);
  const diagonal = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const step = Math.max(tolerance * 0.75, diagonal / 100, 0.2);
  const points = sampleSegments(source, step);
  return points.reduce(
    (maximum, point) => Math.max(maximum, nearestDistance(point, target)),
    0,
  );
}

function bendSupportDistance(first: ComparisonFeature, second: ComparisonFeature) {
  const lineA = longestSegment(first);
  const lineB = longestSegment(second);
  if (!lineA || !lineB) return Number.POSITIVE_INFINITY;
  const vectorA = { x: lineA.b.x - lineA.a.x, y: lineA.b.y - lineA.a.y };
  const vectorB = { x: lineB.b.x - lineB.a.x, y: lineB.b.y - lineB.a.y };
  const lengthA = Math.hypot(vectorA.x, vectorA.y);
  const lengthB = Math.hypot(vectorB.x, vectorB.y);
  if (!lengthA || !lengthB) return Number.POSITIVE_INFINITY;
  const tangentA = { x: vectorA.x / lengthA, y: vectorA.y / lengthA };
  const tangentB = { x: vectorB.x / lengthB, y: vectorB.y / lengthB };
  const parallelism = Math.abs(tangentA.x * tangentB.x + tangentA.y * tangentB.y);
  const normal = { x: -tangentA.y, y: tangentA.x };
  const centerA = featureCenter(first);
  const centerB = featureCenter(second);
  const supportOffset = Math.abs(
    (centerA.x - centerB.x) * normal.x +
    (centerA.y - centerB.y) * normal.y,
  );
  return supportOffset + (1 - parallelism) * Math.max(lengthA, lengthB);
}

function featureDistance(first: ComparisonFeature, second: ComparisonFeature, tolerance: number) {
  if (first.category === "bend" && second.category === "bend") {
    return bendSupportDistance(first, second);
  }
  return Math.max(
    segmentSetDistance(first.segments, second.segments, tolerance),
    segmentSetDistance(second.segments, first.segments, tolerance),
  );
}

function transformFeature(feature: ComparisonFeature, transform: DrawingTransform): ComparisonFeature {
  const segments = feature.segments.map((segment) => transformSegment(segment, transform));
  return {
    ...feature,
    segments,
    bounds: boundsFromSegments(segments),
    axis: feature.kind === "line" ? axisFromSegments(segments) : feature.axis,
  };
}

const CORRECTION_DISPLAY_EPSILON = 0.005;

function featureCenter(feature: ComparisonFeature) {
  return {
    x: (feature.bounds.minX + feature.bounds.maxX) / 2,
    y: (feature.bounds.minY + feature.bounds.maxY) / 2,
  };
}

function moveCorrections(deltaX: number, deltaY: number): NonNullable<Difference["corrections"]> {
  const corrections: NonNullable<Difference["corrections"]> = [];
  if (Math.abs(deltaX) >= CORRECTION_DISPLAY_EPSILON) {
    corrections.push({
      kind: "move",
      direction: correctionDirection("x", deltaX),
      value: Math.abs(deltaX),
    });
  }
  if (Math.abs(deltaY) >= CORRECTION_DISPLAY_EPSILON) {
    corrections.push({
      kind: "move",
      direction: correctionDirection("y", deltaY),
      value: Math.abs(deltaY),
    });
  }
  return corrections;
}

function longestSegment(feature: ComparisonFeature) {
  return feature.segments.reduce<Segment | undefined>((longest, segment) => {
    const length = Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y);
    if (!longest) return segment;
    const longestLength = Math.hypot(longest.b.x - longest.a.x, longest.b.y - longest.a.y);
    return length > longestLength ? segment : longest;
  }, undefined);
}

function straightLineCorrections(
  featureA: ComparisonFeature,
  featureB: ComparisonFeature,
): Difference["corrections"] {
  const lineA = longestSegment(featureA);
  const lineB = longestSegment(featureB);
  if (!lineA || !lineB) return undefined;
  let tangent = {
    x: lineA.b.x - lineA.a.x,
    y: lineA.b.y - lineA.a.y,
  };
  const lengthA = Math.hypot(tangent.x, tangent.y);
  const vectorB = {
    x: lineB.b.x - lineB.a.x,
    y: lineB.b.y - lineB.a.y,
  };
  const lengthB = Math.hypot(vectorB.x, vectorB.y);
  if (!lengthA || !lengthB) return undefined;
  tangent = { x: tangent.x / lengthA, y: tangent.y / lengthA };
  if (
    (Math.abs(tangent.x) >= Math.abs(tangent.y) && tangent.x < 0) ||
    (Math.abs(tangent.y) > Math.abs(tangent.x) && tangent.y < 0)
  ) {
    tangent = { x: -tangent.x, y: -tangent.y };
  }
  const unitB = { x: vectorB.x / lengthB, y: vectorB.y / lengthB };
  const parallelism = Math.abs(tangent.x * unitB.x + tangent.y * unitB.y);
  if (parallelism < 0.995) return undefined;

  const project = (point: { x: number; y: number }) => point.x * tangent.x + point.y * tangent.y;
  const projectionsA = featureA.segments.flatMap((segment) => [project(segment.a), project(segment.b)]);
  const projectionsB = featureB.segments.flatMap((segment) => [project(segment.a), project(segment.b)]);
  const minA = Math.min(...projectionsA);
  const maxA = Math.max(...projectionsA);
  const minB = Math.min(...projectionsB);
  const maxB = Math.max(...projectionsB);
  const tangentDelta = (minA + maxA - minB - maxB) / 2;
  const normal = { x: -tangent.y, y: tangent.x };
  const centerA = featureCenter(featureA);
  const centerB = featureCenter(featureB);
  const normalDelta =
    (centerA.x - centerB.x) * normal.x +
    (centerA.y - centerB.y) * normal.y;
  const moveX = tangent.x * tangentDelta + normal.x * normalDelta;
  const moveY = tangent.y * tangentDelta + normal.y * normalDelta;
  const corrections = moveCorrections(moveX, moveY);
  const lengthDelta = maxA - minA - (maxB - minB);
  if (Math.abs(lengthDelta) >= CORRECTION_DISPLAY_EPSILON) {
    corrections.push({
      kind: "resize",
      operation: lengthDelta > 0 ? "extend" : "shorten",
      endpoint: "both",
      value: Math.abs(lengthDelta),
      eachEnd: Math.abs(lengthDelta) / 2,
    });
  }
  return corrections.length ? corrections : undefined;
}

function bendLineCorrections(
  featureA: ComparisonFeature,
  featureB: ComparisonFeature,
): Difference["corrections"] {
  const lineA = longestSegment(featureA);
  const lineB = longestSegment(featureB);
  if (!lineA || !lineB) return undefined;
  const vectorA = { x: lineA.b.x - lineA.a.x, y: lineA.b.y - lineA.a.y };
  const vectorB = { x: lineB.b.x - lineB.a.x, y: lineB.b.y - lineB.a.y };
  const lengthA = Math.hypot(vectorA.x, vectorA.y);
  const lengthB = Math.hypot(vectorB.x, vectorB.y);
  if (!lengthA || !lengthB) return undefined;
  const tangent = { x: vectorA.x / lengthA, y: vectorA.y / lengthA };
  const unitB = { x: vectorB.x / lengthB, y: vectorB.y / lengthB };
  if (Math.abs(tangent.x * unitB.x + tangent.y * unitB.y) < 0.995) return undefined;
  const normal = { x: -tangent.y, y: tangent.x };
  const centerA = featureCenter(featureA);
  const centerB = featureCenter(featureB);
  const normalDelta =
    (centerA.x - centerB.x) * normal.x +
    (centerA.y - centerB.y) * normal.y;
  const corrections = moveCorrections(normal.x * normalDelta, normal.y * normalDelta);
  return corrections.length ? corrections : undefined;
}

function featureCorrections(
  featureA: ComparisonFeature,
  featureB: ComparisonFeature,
): Difference["corrections"] {
  if (featureA.category === "bend") {
    return bendLineCorrections(featureA, featureB);
  }
  if (featureA.category === "contour" && featureA.kind === "line") {
    return straightLineCorrections(featureA, featureB);
  }
  const centerA = {
    x: (featureA.bounds.minX + featureA.bounds.maxX) / 2,
    y: (featureA.bounds.minY + featureA.bounds.maxY) / 2,
  };
  const centerB = {
    x: (featureB.bounds.minX + featureB.bounds.maxX) / 2,
    y: (featureB.bounds.minY + featureB.bounds.maxY) / 2,
  };
  const deltaX = centerA.x - centerB.x;
  const deltaY = centerA.y - centerB.y;
  const corrections = moveCorrections(deltaX, deltaY);
  return corrections.length ? corrections : undefined;
}

function matchedFeatureDifference(
  featureA: ComparisonFeature,
  featureB: ComparisonFeature,
  value: number,
  tolerance: number,
): Difference {
  const lengthDelta = featureB.length - featureA.length;
  const direction = Math.abs(lengthDelta) > 0.000001 ? Math.sign(lengthDelta) : 1;
  return {
    id: `feature-${featureA.id}-${featureB.id}`,
    label: featureA.label,
    category: featureA.category,
    severity: severityFor(value, tolerance),
    value,
    signedValue: value * direction,
    unit: "mm",
    corrections: featureCorrections(featureA, featureB),
    bounds: unionBounds([featureA.bounds, featureB.bounds]),
    source: "B",
    entityIds: { A: featureA.entityIds, B: featureB.entityIds },
  };
}

type ContourSide = {
  id: "top" | "bottom" | "left" | "right";
  label: string;
  axis: "x" | "y";
  coordinate: "minX" | "minY" | "maxX" | "maxY";
};

const CONTOUR_SIDES: ContourSide[] = [
  { id: "top", label: "Linha externa superior", axis: "y", coordinate: "maxY" },
  { id: "bottom", label: "Linha externa inferior", axis: "y", coordinate: "minY" },
  { id: "left", label: "Linha externa esquerda", axis: "x", coordinate: "minX" },
  { id: "right", label: "Linha externa direita", axis: "x", coordinate: "maxX" },
];

function correctionDirection(axis: ContourSide["axis"], delta: number) {
  if (axis === "x") return delta > 0 ? "right" : "left";
  return delta > 0 ? "up" : "down";
}

function contourSideBounds(
  side: ContourSide,
  boundsA: Bounds,
  boundsB: Bounds,
): Bounds {
  const coordinateA = boundsA[side.coordinate];
  const coordinateB = boundsB[side.coordinate];
  if (side.axis === "y") {
    return {
      minX: Math.min(boundsA.minX, boundsB.minX),
      minY: Math.min(coordinateA, coordinateB),
      maxX: Math.max(boundsA.maxX, boundsB.maxX),
      maxY: Math.max(coordinateA, coordinateB),
    };
  }
  return {
    minX: Math.min(coordinateA, coordinateB),
    minY: Math.min(boundsA.minY, boundsB.minY),
    maxX: Math.max(coordinateA, coordinateB),
    maxY: Math.max(boundsA.maxY, boundsB.maxY),
  };
}

function contourSideDifferences(
  featureA: ComparisonFeature,
  featureB: ComparisonFeature,
  tolerance: number,
): Difference[] {
  return CONTOUR_SIDES.map((side) => {
    const correctionDelta = featureA.bounds[side.coordinate] - featureB.bounds[side.coordinate];
    const value = Math.abs(correctionDelta);
    return {
      id: `feature-${featureA.id}-${featureB.id}-${side.id}`,
      label: side.label,
      category: "contour",
      severity: severityFor(value, tolerance),
      value,
      signedValue: correctionDelta,
      unit: "mm",
      corrections:
        value >= CORRECTION_DISPLAY_EPSILON
          ? [{ kind: "move", direction: correctionDirection(side.axis, correctionDelta), value }]
          : undefined,
      bounds: contourSideBounds(side, featureA.bounds, featureB.bounds),
      source: "B",
      entityIds: { A: featureA.entityIds, B: featureB.entityIds },
    };
  });
}

function matchedFeatureDifferences(
  featureA: ComparisonFeature,
  featureB: ComparisonFeature,
  value: number,
  tolerance: number,
) {
  if (featureA.category === "contour" && featureA.kind === "shape") {
    return contourSideDifferences(featureA, featureB, tolerance);
  }
  return [matchedFeatureDifference(featureA, featureB, value, tolerance)];
}

function missingFeatureDifference(
  feature: ComparisonFeature,
  source: "A" | "B",
  oppositeSegments: Segment[],
  tolerance: number,
  drawingDiagonal: number,
): Difference {
  const nearest = segmentSetDistance(feature.segments, oppositeSegments, tolerance);
  const value = Math.max(
    tolerance * 6,
    Number.isFinite(nearest) ? nearest : drawingDiagonal,
  );
  return {
    id: `feature-${source}-${feature.id}`,
    label: `${feature.label} (somente ${source})`,
    category: feature.category,
    severity: severityFor(value, tolerance),
    value,
    signedValue: source === "B" ? value : -value,
    unit: "mm",
    bounds: feature.bounds,
    source,
    entityIds: {
      A: source === "A" ? feature.entityIds : [],
      B: source === "B" ? feature.entityIds : [],
    },
  };
}

function compareFeatures(
  featuresA: ComparisonFeature[],
  featuresB: ComparisonFeature[],
  tolerance: number,
  drawingDiagonal: number,
) {
  const candidates = featuresA.flatMap((featureA, indexA) =>
    featuresB
      .map((featureB, indexB) => ({ featureA, featureB, indexA, indexB }))
      .filter(({ featureA: first, featureB: second }) =>
        first.category === second.category &&
        (!first.axis || !second.axis || first.axis === second.axis),
      )
      .map((candidate) => ({
        ...candidate,
        distance: featureDistance(candidate.featureA, candidate.featureB, tolerance),
      })),
  ).sort((first, second) => first.distance - second.distance);
  const matchedA = new Set<number>();
  const matchedB = new Set<number>();
  const matches = new Map<number, (typeof candidates)[number]>();
  const differences: Difference[] = [];

  candidates.forEach((candidate) => {
    if (matchedA.has(candidate.indexA) || matchedB.has(candidate.indexB)) return;
    matchedA.add(candidate.indexA);
    matchedB.add(candidate.indexB);
    matches.set(candidate.indexA, candidate);
  });

  const segmentsA = featuresA.flatMap((feature) => feature.segments);
  const segmentsB = featuresB.flatMap((feature) => feature.segments);
  featuresA.forEach((feature, index) => {
    const match = matches.get(index);
    if (match) {
      differences.push(
        ...matchedFeatureDifferences(
          match.featureA,
          match.featureB,
          match.distance,
          tolerance,
        ),
      );
    } else {
      differences.push(
        missingFeatureDifference(feature, "A", segmentsB, tolerance, drawingDiagonal),
      );
    }
  });
  featuresB.forEach((feature, index) => {
    if (!matchedB.has(index)) {
      differences.push(
        missingFeatureDifference(feature, "B", segmentsA, tolerance, drawingDiagonal),
      );
    }
  });

  return differences;
}

function metricDifference(
  id: string,
  label: string,
  category: DifferenceCategory,
  aValue: number,
  bValue: number,
  tolerance: number,
  bounds: Bounds,
  unit: Difference["unit"] = "mm",
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
    unit,
    bounds,
    source: "metric",
  };
}

function filterInternal(document: DxfDocument, ignoreInternal: boolean) {
  if (!ignoreInternal) return document.entities;
  const components = connectedGeometryComponents(
    document.entities.filter((entity) => !entity.isBend && entity.type !== "CIRCLE"),
  ).filter((component) => component.closed);
  const external = components.sort(
    (first, second) => boundsArea(second.bounds) - boundsArea(first.bounds),
  )[0];
  if (!external) return document.entities.filter((entity) => !entity.closed);
  const externalIds = new Set(external.entityIds);
  return document.entities.filter(
    (entity) => entity.isBend || externalIds.has(entity.id),
  );
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
  const transformedBoundsB = transformBounds(documentB.bounds, transform);
  const alignedStatsB = {
    ...documentB.stats,
    width: Math.max(0, transformedBoundsB.maxX - transformedBoundsB.minX),
    height: Math.max(0, transformedBoundsB.maxY - transformedBoundsB.minY),
  };
  const drawingDiagonal = Math.max(
    Math.hypot(documentA.stats.width, documentA.stats.height),
    Math.hypot(alignedStatsB.width, alignedStatsB.height),
    tolerance,
  );
  const featuresA = comparisonFeatures(entitiesA);
  const featuresB = comparisonFeatures(entitiesB).map((feature) =>
    transformFeature(feature, transform),
  );
  const geometry = compareFeatures(featuresA, featuresB, tolerance, drawingDiagonal);
  const areaTolerance = areaToleranceFromLinear(
    documentA.stats.width,
    documentA.stats.height,
    tolerance,
  );
  const metrics = [
    metricDifference(
      "metric-width",
      "Largura total",
      "dimension",
      documentA.stats.width,
      alignedStatsB.width,
      tolerance,
      documentA.bounds,
    ),
    metricDifference(
      "metric-height",
      "Comprimento total",
      "dimension",
      documentA.stats.height,
      alignedStatsB.height,
      tolerance,
      documentA.bounds,
    ),
    metricDifference(
      "metric-area",
      "Área líquida",
      "dimension",
      documentA.stats.area,
      documentB.stats.area,
      areaTolerance,
      documentA.bounds,
      "mm2",
    ),
    metricDifference(
      "metric-holes",
      "Quantidade de furos",
      "hole",
      documentA.stats.holes,
      documentB.stats.holes,
      0.01,
      transformedBoundsB,
      "count",
    ),
    metricDifference(
      "metric-cutouts",
      "Quantidade de recortes",
      "cutout",
      documentA.stats.cutouts,
      documentB.stats.cutouts,
      0.01,
      transformedBoundsB,
      "count",
    ),
    metricDifference(
      "metric-contours",
      "Quantidade de contornos",
      "contour",
      documentA.stats.contours,
      documentB.stats.contours,
      0.01,
      transformedBoundsB,
      "count",
    ),
  ];

  const differences = [...metrics, ...geometry].filter((difference) =>
    Number.isFinite(difference.value),
  );
  const correct = differences.filter((difference) => difference.severity === "correct").length;
  const small = differences.filter((difference) => difference.severity === "small").length;
  const large = differences.filter((difference) => difference.severity === "large").length;
  const sampleStep = Math.max(tolerance, drawingDiagonal / 350, 0.25);
  const allSamples = [
    ...sampleSegments(segmentsA, sampleStep).map((point) =>
      nearestDistance(point, transformedB),
    ),
    ...sampleSegments(transformedB, sampleStep).map((point) =>
      nearestDistance(point, segmentsA),
    ),
  ].filter(Number.isFinite);
  const exactRatio = allSamples.length
    ? allSamples.filter((distance) => distance <= tolerance).length / allSamples.length
    : 0;
  const smallRatio = allSamples.length
    ? allSamples.filter((distance) => distance <= tolerance * 5).length / allSamples.length
    : 0;
  const averageDistance = allSamples.length
    ? allSamples.reduce((sum, distance) => sum + distance, 0) / allSamples.length
    : 0;
  const distanceScore = 1 - Math.min(
    1,
    averageDistance / Math.max(drawingDiagonal * 0.02, tolerance),
  );
  const similarityScore = Math.max(
    0,
    Math.min(100, (exactRatio * 0.1 + smallRatio * 0.55 + distanceScore * 0.35) * 100),
  );
  const similarity = similarityScore > 99.999999 ? 100 : similarityScore;

  return {
    differences,
    similarity,
    totalCompared: differences.length,
    correct,
    small,
    large,
    maxDifference: Math.max(
      0,
      ...differences
        .filter((difference) => difference.unit === "mm")
        .map((difference) => difference.value),
    ),
    transformedB,
    alignedStatsB,
  };
}
