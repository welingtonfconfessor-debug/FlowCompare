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
};

function severityFor(value: number, tolerance: number): DifferenceSeverity {
  if (value <= tolerance) return "correct";
  if (value <= tolerance * 5) return "small";
  return "large";
}

function boundsArea(bounds: Bounds) {
  return Math.max(0, bounds.maxX - bounds.minX) * Math.max(0, bounds.maxY - bounds.minY);
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

  const componentFeatures = components.map((component): ComparisonFeature => {
    let category: DifferenceCategory = "geometry";
    let label = `Geometria ${++geometryIndex}`;
    if (component.closed && component.id === externalId) {
      category = "contour";
      label = "Contorno externo";
    } else if (component.closed) {
      category = "cutout";
      label = `Recorte ${++cutoutIndex}`;
    }
    return {
      id: component.id,
      label,
      category,
      entityIds: component.entityIds,
      segments: component.segments,
      bounds: component.bounds,
      length: component.length,
    };
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
  }));

  const bendFeatures = bends.map((entity, index): ComparisonFeature => ({
    id: `bend-${entity.id}`,
    label: `Linha de dobra ${index + 1}`,
    category: "bend",
    entityIds: [entity.id],
    segments: entity.segments,
    bounds: entity.bounds,
    length: entity.length,
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

function featureDistance(first: ComparisonFeature, second: ComparisonFeature, tolerance: number) {
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
  };
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
  { id: "top", label: "Linha superior", axis: "y", coordinate: "maxY" },
  { id: "bottom", label: "Linha inferior", axis: "y", coordinate: "minY" },
  { id: "left", label: "Linha esquerda", axis: "x", coordinate: "minX" },
  { id: "right", label: "Linha direita", axis: "x", coordinate: "maxX" },
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
      correction:
        value > 0.000001
          ? { direction: correctionDirection(side.axis, correctionDelta), value }
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
  if (featureA.category === "contour") {
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
      .filter(({ featureA: first, featureB: second }) => first.category === second.category)
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
