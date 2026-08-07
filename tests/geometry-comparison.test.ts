import assert from "node:assert/strict";
import test from "node:test";
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
