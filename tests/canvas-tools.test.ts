import assert from "node:assert/strict";
import test from "node:test";
import {
  canvasPointFromClient,
  measurementDistance,
  snapCanvasPoint,
  transformAfterCanvasDrag,
} from "../app/lib/canvas-tools";
import type { Segment } from "../app/types";

const rect = { left: 10, top: 20, width: 200, height: 100 };
const viewBox = { x: -100, y: -50, width: 400, height: 200 };

test("converte a posição do ponteiro para coordenadas do desenho", () => {
  assert.deepEqual(canvasPointFromClient(110, 70, rect, viewBox), { x: 100, y: 50 });
});

test("arrastar o Arquivo B atualiza X e Y preservando a rotação", () => {
  const result = transformAfterCanvasDrag(
    { x: 5, y: 8, rotation: 17 },
    { x: 100, y: 100 },
    { x: 120, y: 110 },
    rect,
    viewBox,
  );

  assert.deepEqual(result, { x: 45, y: -12, rotation: 17 });
});

test("régua encaixa no segmento mais próximo e mede em milímetros", () => {
  const segments: Segment[] = [
    {
      a: { x: 0, y: 0 },
      b: { x: 100, y: 0 },
      entityId: "line-1",
      entityType: "LINE",
      layer: "0",
    },
  ];
  const snapped = snapCanvasPoint({ x: 25, y: 2 }, segments, 5);

  assert.deepEqual(snapped, { x: 25, y: 0 });
  assert.equal(snapCanvasPoint({ x: 25, y: 20 }, segments, 5), null);
  assert.equal(measurementDistance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
});

test("régua prioriza a interseção exata sobre a projeção na linha", () => {
  const segments: Segment[] = [
    {
      a: { x: 0, y: 0 },
      b: { x: 100, y: 0 },
      entityId: "horizontal",
      entityType: "LINE",
      layer: "0",
    },
    {
      a: { x: 50, y: -50 },
      b: { x: 50, y: 50 },
      entityId: "vertical",
      entityType: "LINE",
      layer: "0",
    },
  ];

  assert.deepEqual(snapCanvasPoint({ x: 53, y: 2 }, segments, 6), { x: 50, y: 0 });
});
