export type Point = {
  x: number;
  y: number;
};

export type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type Segment = {
  a: Point;
  b: Point;
  entityId: string;
  entityType: string;
  layer: string;
};

export type EntityGeometry = {
  id: string;
  type: string;
  layer: string;
  segments: Segment[];
  bounds: Bounds;
  closed: boolean;
  length: number;
  area: number;
  radius?: number;
  isBend: boolean;
};

export type GeometryStats = {
  totalLength: number;
  area: number;
  width: number;
  height: number;
  holes: number;
  cutouts: number;
  contours: number;
  bends: number;
};

export type DxfDocument = {
  name: string;
  size: number;
  entities: EntityGeometry[];
  bounds: Bounds;
  stats: GeometryStats;
  unsupported: string[];
  sourceUnits: string;
};

export type DrawingTransform = {
  x: number;
  y: number;
  rotation: number;
};

export type DifferenceSeverity = "correct" | "small" | "large";

export type CorrectionDirection = "up" | "down" | "left" | "right";

export type CorrectionEndpoint = "left" | "right" | "top" | "bottom" | "start" | "end" | "both";

export type DifferenceCorrection =
  | {
      kind: "move";
      direction: CorrectionDirection;
      value: number;
    }
  | {
      kind: "resize";
      operation: "extend" | "shorten";
      endpoint: CorrectionEndpoint;
      value: number;
      eachEnd?: number;
    };

export type DifferenceCategory =
  | "geometry"
  | "dimension"
  | "hole"
  | "cutout"
  | "contour"
  | "bend";

export type Difference = {
  id: string;
  label: string;
  category: DifferenceCategory;
  severity: DifferenceSeverity;
  value: number;
  signedValue: number;
  unit: "mm" | "mm2" | "count";
  corrections?: DifferenceCorrection[];
  bounds: Bounds;
  source: "A" | "B" | "metric";
  entityIds?: {
    A: string[];
    B: string[];
  };
};

export type ComparisonResult = {
  differences: Difference[];
  similarity: number;
  totalCompared: number;
  correct: number;
  small: number;
  large: number;
  maxDifference: number;
  transformedB: Segment[];
  alignedStatsB: GeometryStats;
};
