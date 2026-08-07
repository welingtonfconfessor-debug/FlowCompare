import DxfParser from "dxf-parser";
import type { DxfDocument } from "../types";
import {
  boundsFromSegments,
  entityToGeometry,
  geometryStats,
  type RawEntity,
} from "./geometry";

type ParsedDxf = {
  entities?: RawEntity[];
  header?: Record<string, unknown>;
};

const UNIT_SCALE_TO_MM: Record<number, number> = {
  0: 1,
  1: 25.4,
  2: 304.8,
  4: 1,
  5: 10,
  6: 1000,
  9: 0.0254,
  10: 914.4,
};

const UNIT_LABEL: Record<number, string> = {
  0: "sem unidade (tratado como mm)",
  1: "polegadas",
  2: "pés",
  4: "milímetros",
  5: "centímetros",
  6: "metros",
  9: "milésimos de polegada",
  10: "jardas",
};

function unitCode(header?: Record<string, unknown>) {
  const value = header?.$INSUNITS;
  return typeof value === "number" ? value : 0;
}

export function parseDxfText(text: string, name = "desenho.dxf", size = text.length): DxfDocument {
  const parser = new DxfParser();
  const parsed = parser.parseSync(text) as ParsedDxf | null;
  if (!parsed?.entities?.length) {
    throw new Error("O arquivo não possui entidades DXF compatíveis na seção ENTITIES.");
  }

  const code = unitCode(parsed.header);
  const scale = UNIT_SCALE_TO_MM[code] ?? 1;
  const supported = parsed.entities
    .map((entity, index) => entityToGeometry(entity, index, scale))
    .filter((entity): entity is NonNullable<typeof entity> => Boolean(entity));

  if (!supported.length) {
    throw new Error("Nenhuma geometria compatível foi encontrada neste DXF.");
  }

  const supportedIds = new Set(supported.map((entity) => Number(entity.id.split("-")[1])));
  const unsupported = Array.from(
    new Set(
      parsed.entities
        .map((entity, index) => ({ entity, index }))
        .filter(({ index }) => !supportedIds.has(index))
        .map(({ entity }) => String(entity.type ?? "DESCONHECIDO")),
    ),
  );
  const segments = supported.flatMap((entity) => entity.segments);
  const bounds = boundsFromSegments(segments);

  return {
    name,
    size,
    entities: supported,
    bounds,
    stats: geometryStats(supported, bounds),
    unsupported,
    sourceUnits: UNIT_LABEL[code] ?? `código DXF ${code}`,
  };
}

export async function parseDxfFile(file: File) {
  if (!file.name.toLowerCase().endsWith(".dxf")) {
    throw new Error("Selecione um arquivo com extensão .dxf.");
  }
  return parseDxfText(await file.text(), file.name, file.size);
}
