import assert from "node:assert/strict";
import test from "node:test";
import { alignmentForDocuments } from "../app/lib/alignment";
import { compareDocuments } from "../app/lib/comparison";
import { parseDxfText } from "../app/lib/dxf";

function trayDxf(width: number, holeX: number) {
  return `0
SECTION
2
HEADER
9
$INSUNITS
70
4
0
ENDSEC
0
SECTION
2
ENTITIES
0
LWPOLYLINE
8
CONTORNO
90
4
70
1
10
0
20
0
10
${width}
20
0
10
${width}
20
50
10
0
20
50
0
CIRCLE
8
FUROS
10
${holeX}
20
25
40
5
0
LINE
8
DOBRA
10
50
20
5
11
50
21
45
0
ENDSEC
0
EOF`;
}

function rectangleFromLinesDxf(width: number, height: number) {
  const lines = [
    [0, 0, width, 0],
    [width, 0, width, height],
    [width, height, 0, height],
    [0, height, 0, 0],
  ];
  return `0
SECTION
2
ENTITIES
${lines.map(([x1, y1, x2, y2]) => `0
LINE
8
CONTORNO
10
${x1}
20
${y1}
11
${x2}
21
${y2}`).join("\n")}
0
ENDSEC
0
EOF`;
}

function rectangleFromPolylineDxf(width: number, height: number) {
  return `0
SECTION
2
ENTITIES
0
LWPOLYLINE
8
CONTORNO
90
4
70
1
10
0
20
0
10
${width}
20
0
10
${width}
20
${height}
10
0
20
${height}
0
ENDSEC
0
EOF`;
}

test("lê geometrias e estatísticas reais do DXF", () => {
  const document = parseDxfText(trayDxf(100, 20), "bandeja-a.dxf");
  assert.equal(document.stats.width, 100);
  assert.equal(document.stats.height, 50);
  assert.equal(document.stats.holes, 1);
  assert.equal(document.stats.bends, 1);
  assert.equal(document.entities.length, 3);
});

test("detecta diferenças a partir da geometria importada", () => {
  const documentA = parseDxfText(trayDxf(100, 20), "bandeja-a.dxf");
  const documentB = parseDxfText(trayDxf(102, 21), "bandeja-b.dxf");
  const result = compareDocuments(
    documentA,
    documentB,
    { x: -1, y: 0, rotation: 0 },
    { tolerance: 0.2, ignoreInternal: false },
  );

  assert.ok(result.maxDifference > 0.2);
  assert.ok(result.large > 0);
  assert.ok(result.similarity < 100);
  assert.ok(result.differences.some((difference) => difference.label === "Largura total"));
});

test("desenhos idênticos recebem similaridade total", () => {
  const document = parseDxfText(trayDxf(100, 20), "bandeja.dxf");
  const result = compareDocuments(
    document,
    document,
    { x: 0, y: 0, rotation: 0 },
    { tolerance: 0.2, ignoreInternal: false },
  );
  assert.equal(result.similarity, 100);
  assert.equal(result.large, 0);
  assert.equal(result.small, 0);
});

test("trata linhas conectadas e polilinha como o mesmo contorno após rotação", () => {
  const documentA = parseDxfText(rectangleFromLinesDxf(100, 50), "linhas.dxf");
  const documentB = parseDxfText(rectangleFromPolylineDxf(50, 100), "polilinha.dxf");
  const transform = alignmentForDocuments(documentA, documentB, "origin", 90);
  const result = compareDocuments(
    documentA,
    documentB,
    transform,
    { tolerance: 0.2, ignoreInternal: false },
  );

  assert.equal(documentA.stats.contours, 1);
  assert.equal(documentB.stats.contours, 1);
  assert.equal(result.totalCompared, 7);
  assert.equal(result.correct, 7);
  assert.equal(result.small, 0);
  assert.equal(result.large, 0);
  assert.equal(result.similarity, 100);
  assert.ok(Math.abs(result.alignedStatsB.width - 100) < 1e-9);
  assert.ok(Math.abs(result.alignedStatsB.height - 50) < 1e-9);
});

test("reporta uma única divergência de contorno sem inverter largura e comprimento", () => {
  const documentA = parseDxfText(rectangleFromLinesDxf(100, 50), "referencia.dxf");
  const documentB = parseDxfText(rectangleFromPolylineDxf(50, 100.4), "comparado.dxf");
  const transform = alignmentForDocuments(documentA, documentB, "origin", 90);
  const result = compareDocuments(
    documentA,
    documentB,
    transform,
    { tolerance: 0.201, ignoreInternal: false },
  );

  const width = result.differences.find((difference) => difference.id === "metric-width");
  const height = result.differences.find((difference) => difference.id === "metric-height");
  const contours = result.differences.filter((difference) => difference.label === "Contorno externo");

  assert.ok(width && Math.abs(width.signedValue - 0.4) < 1e-9);
  assert.ok(height && Math.abs(height.signedValue) < 1e-9);
  assert.equal(contours.length, 1);
  assert.equal(result.totalCompared, 7);
  assert.equal(result.small, 3);
  assert.equal(result.large, 0);
  assert.ok(result.maxDifference < 1);
  assert.ok(result.similarity > 95);
});
