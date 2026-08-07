import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import test from "node:test";
import { compareDocuments } from "../app/lib/comparison";
import { parseDxfText } from "../app/lib/dxf";
import { createComparisonReportPdf } from "../app/lib/report";

function reportFixtureDxf(width: number, holeX: number) {
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

test("gera um relatório PDF com as divergências calculadas", async () => {
  const documentA = parseDxfText(reportFixtureDxf(100, 20), "bandeja_solidworks.dxf");
  const documentB = parseDxfText(reportFixtureDxf(102, 21), "bandeja_metalflow.dxf");
  const transform = { x: -1, y: 0, rotation: 0 };
  const comparison = compareDocuments(documentA, documentB, transform, {
    tolerance: 0.2,
    ignoreInternal: false,
  });
  const pdf = createComparisonReportPdf({
    documentA,
    documentB,
    comparison,
    tolerance: 0.2,
    transform,
    generatedAt: new Date("2026-08-07T12:00:00-03:00"),
  });
  const bytes = Buffer.from(pdf.output("arraybuffer"));

  assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
  assert.ok(bytes.length > 4_000);
  assert.ok(comparison.large > 0);

  const outputDirectory = new URL("../output/pdf/", import.meta.url);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(new URL("flowcompare-relatorio-exemplo.pdf", outputDirectory), bytes);
});
