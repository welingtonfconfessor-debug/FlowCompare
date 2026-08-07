import type { DrawingTransform, DxfDocument } from "../types";
import { transformBounds } from "./geometry";

export type AlignmentMethod = "bounds" | "origin";

export function alignmentForDocuments(
  documentA: DxfDocument,
  documentB: DxfDocument,
  method: AlignmentMethod,
  rotation = 0,
): DrawingTransform {
  const rotatedBoundsB = transformBounds(documentB.bounds, {
    x: 0,
    y: 0,
    rotation,
  });

  if (method === "origin") {
    return {
      x: documentA.bounds.minX - rotatedBoundsB.minX,
      y: documentA.bounds.minY - rotatedBoundsB.minY,
      rotation,
    };
  }

  return {
    x:
      (documentA.bounds.minX + documentA.bounds.maxX) / 2 -
      (rotatedBoundsB.minX + rotatedBoundsB.maxX) / 2,
    y:
      (documentA.bounds.minY + documentA.bounds.maxY) / 2 -
      (rotatedBoundsB.minY + rotatedBoundsB.maxY) / 2,
    rotation,
  };
}
