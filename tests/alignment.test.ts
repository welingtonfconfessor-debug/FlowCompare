import assert from "node:assert/strict";
import test from "node:test";
import { alignmentForDocuments } from "../app/lib/alignment";
import { transformBounds } from "../app/lib/geometry";
import type { Bounds, DxfDocument } from "../app/types";

function documentWithBounds(name: string, bounds: Bounds): DxfDocument {
  return {
    name,
    size: 0,
    entities: [],
    bounds,
    stats: {
      totalLength: 0,
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
      holes: 0,
      cutouts: 0,
      contours: 0,
      bends: 0,
    },
    unsupported: [],
    sourceUnits: "milímetros",
  };
}

test("realinhamento pelo centro preserva a rotação manual", () => {
  const reference = documentWithBounds("A.dxf", { minX: 0, minY: 0, maxX: 100, maxY: 50 });
  const compared = documentWithBounds("B.dxf", { minX: 0, minY: 0, maxX: 50, maxY: 100 });
  const transform = alignmentForDocuments(reference, compared, "bounds", 90);
  const alignedBounds = transformBounds(compared.bounds, transform);

  assert.equal(transform.rotation, 90);
  assert.ok(Math.abs(alignedBounds.minX - reference.bounds.minX) < 1e-9);
  assert.ok(Math.abs(alignedBounds.maxX - reference.bounds.maxX) < 1e-9);
  assert.ok(Math.abs(alignedBounds.minY - reference.bounds.minY) < 1e-9);
  assert.ok(Math.abs(alignedBounds.maxY - reference.bounds.maxY) < 1e-9);
});

test("realinhamento pela origem usa os limites já rotacionados", () => {
  const reference = documentWithBounds("A.dxf", { minX: 10, minY: 20, maxX: 110, maxY: 70 });
  const compared = documentWithBounds("B.dxf", { minX: -5, minY: 4, maxX: 45, maxY: 104 });
  const transform = alignmentForDocuments(reference, compared, "origin", 30);
  const alignedBounds = transformBounds(compared.bounds, transform);

  assert.equal(transform.rotation, 30);
  assert.ok(Math.abs(alignedBounds.minX - reference.bounds.minX) < 1e-9);
  assert.ok(Math.abs(alignedBounds.minY - reference.bounds.minY) < 1e-9);
});
