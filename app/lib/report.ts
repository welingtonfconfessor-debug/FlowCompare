import { jsPDF } from "jspdf";
import autoTable, { type CellDef } from "jspdf-autotable";
import { FLOWCOMPARE_LOGO, type FlowCompareLogoPath } from "./brand";
import { areaToleranceFromLinear } from "./geometry";
import type {
  ComparisonResult,
  Difference,
  DifferenceSeverity,
  DrawingTransform,
  DxfDocument,
} from "../types";

export type ComparisonReportInput = {
  documentA: DxfDocument;
  documentB: DxfDocument;
  comparison: ComparisonResult;
  tolerance: number;
  transform: DrawingTransform;
  comparisonImage?: string;
  generatedAt?: Date;
};

const COLORS = {
  ink: [28, 39, 45] as [number, number, number],
  muted: [95, 109, 117] as [number, number, number],
  line: [210, 218, 222] as [number, number, number],
  paper: [246, 249, 250] as [number, number, number],
  dark: [7, 16, 21] as [number, number, number],
  blue: [47, 125, 246] as [number, number, number],
  green: [44, 145, 72] as [number, number, number],
  yellow: [181, 137, 0] as [number, number, number],
  red: [201, 62, 54] as [number, number, number],
};

type PdfPathOperation =
  | { op: "m" | "l"; c: [number, number] }
  | { op: "h"; c: [] };

function vectorPathOperations(path: FlowCompareLogoPath, x: number, y: number, logoScale: number) {
  const tokens = path.d.match(/[MLZ]|-?\d+(?:\.\d+)?/g) ?? [];
  const operations: PdfPathOperation[] = [];
  let command: "M" | "L" | "Z" = "M";

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "M" || token === "L" || token === "Z") {
      command = token;
      if (command === "Z") operations.push({ op: "h", c: [] });
      continue;
    }

    if (command === "Z") continue;
    const sourceX = Number(token);
    const sourceY = Number(tokens[index + 1]);
    index += 1;
    const logoX = path.translateX + (sourceX - path.originX) * path.scale;
    const logoY = path.translateY + (sourceY - path.originY) * path.scale;
    operations.push({
      op: command === "M" ? "m" : "l",
      c: [x + logoX * logoScale, y + logoY * logoScale],
    });
  }

  return operations;
}

function drawFlowCompareLogo(pdf: jsPDF, x: number, y: number, width: number) {
  const logoScale = width / FLOWCOMPARE_LOGO.width;
  for (const path of FLOWCOMPARE_LOGO.paths) {
    const color: [number, number, number] =
      path.fill === "blue" ? [20, 103, 239] : [220, 230, 235];
    pdf.setFillColor(...color);
    pdf.path(vectorPathOperations(path, x, y, logoScale));
    pdf.fillEvenOdd();
  }
}

const CATEGORY_LABELS: Record<Difference["category"], string> = {
  geometry: "Geometria",
  dimension: "Dimensão",
  hole: "Furo",
  cutout: "Recorte",
  contour: "Contorno",
  bend: "Linha de dobra",
};

const SEVERITY_LABELS: Record<DifferenceSeverity, string> = {
  correct: "Dentro da tolerância",
  small: "Pequena",
  large: "Grande",
};

const formatNumber = (value: number, digits = 2) =>
  value.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

const signedNumber = (value: number, suffix = " mm") =>
  `${value > 0 ? "+" : value < 0 ? "-" : ""}${formatNumber(Math.abs(value))}${suffix}`;

const sourceLabel = (source: Difference["source"]) => {
  if (source === "A") return "Referência A";
  if (source === "B") return "Arquivo B";
  return "Métrica geral";
};

function differenceValue(difference: Difference) {
  const suffix = difference.unit === "mm2" ? " mm²" : difference.unit === "count" ? " un." : " mm";
  if (difference.source === "metric") {
    return signedNumber(difference.signedValue, suffix);
  }
  return `${formatNumber(difference.value)}${suffix}`;
}

function severityColor(severity: DifferenceSeverity) {
  if (severity === "large") return COLORS.red;
  if (severity === "small") return COLORS.yellow;
  return COLORS.green;
}

function metricSeverity(delta: number, limit: number): DifferenceSeverity {
  if (Math.abs(delta) <= limit) return "correct";
  if (Math.abs(delta) <= limit * 5) return "small";
  return "large";
}

function summaryCard(
  pdf: jsPDF,
  x: number,
  y: number,
  width: number,
  label: string,
  value: string,
  color: [number, number, number],
) {
  pdf.setFillColor(...COLORS.paper);
  pdf.setDrawColor(...COLORS.line);
  pdf.roundedRect(x, y, width, 21, 1.5, 1.5, "FD");
  pdf.setFillColor(...color);
  pdf.rect(x, y, 2.2, 21, "F");
  pdf.setTextColor(...COLORS.muted);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  pdf.text(label, x + 6, y + 7);
  pdf.setTextColor(...COLORS.ink);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.text(value, x + 6, y + 16);
}

function sectionTitle(pdf: jsPDF, title: string, y: number) {
  pdf.setFillColor(...COLORS.blue);
  pdf.rect(14, y - 3.5, 2, 4.5, "F");
  pdf.setTextColor(...COLORS.ink);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.text(title, 19, y);
}

function tableFinalY(pdf: jsPDF, fallback: number) {
  return (
    pdf as jsPDF & {
      lastAutoTable?: { finalY?: number };
    }
  ).lastAutoTable?.finalY ?? fallback;
}

function addPageFooters(pdf: jsPDF, generatedAt: Date) {
  const totalPages = pdf.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    pdf.setPage(page);
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const footerLineY = pageHeight - 11;
    const footerTextY = pageHeight - 6;
    pdf.setDrawColor(...COLORS.line);
    pdf.line(14, footerLineY, pageWidth - 14, footerLineY);
    pdf.setTextColor(...COLORS.muted);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.text("FlowCompare | Relatório de divergências DXF", 14, footerTextY);
    pdf.text(
      `Gerado em ${generatedAt.toLocaleString("pt-BR")} | Página ${page} de ${totalPages}`,
      pageWidth - 14,
      footerTextY,
      { align: "right" },
    );
  }
}

function addComparisonPreviewPage(
  pdf: jsPDF,
  input: ComparisonReportInput,
  actionableCount: number,
) {
  if (!input.comparisonImage) return;

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const statusColor =
    input.comparison.large > 0
      ? COLORS.red
      : actionableCount > 0
        ? COLORS.yellow
        : COLORS.green;

  pdf.setFillColor(...COLORS.dark);
  pdf.rect(0, 0, pageWidth, 24, "F");
  drawFlowCompareLogo(pdf, 14, 4.5, 68);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.5);
  pdf.setTextColor(177, 191, 198);
  pdf.text("Visualização ampliada da comparação", 88, 14.5);
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(8);
  pdf.text(`${input.documentA.name}  x  ${input.documentB.name}`, pageWidth - 14, 14, {
    align: "right",
    maxWidth: 132,
  });

  pdf.setFillColor(...statusColor);
  pdf.roundedRect(14, 29, pageWidth - 28, 10, 1.5, 1.5, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8.5);
  pdf.text(
    actionableCount > 0
      ? `${actionableCount} DIVERGÊNCIA(S) ACIMA DA TOLERÂNCIA`
      : "NENHUMA DIVERGÊNCIA ACIMA DA TOLERÂNCIA",
    19,
    35.5,
  );
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  pdf.text(
    `Similaridade ${formatNumber(input.comparison.similarity, 1)}% | Tolerância ${formatNumber(input.tolerance)} mm | Máxima ${formatNumber(input.comparison.maxDifference)} mm`,
    pageWidth - 19,
    35.5,
    { align: "right" },
  );

  const frameX = 14;
  const frameY = 44;
  const frameWidth = pageWidth - 28;
  const frameHeight = pageHeight - frameY - 21;
  const imagePadding = 4;
  const maxImageWidth = frameWidth - imagePadding * 2;
  const maxImageHeight = frameHeight - imagePadding * 2;
  const properties = pdf.getImageProperties(input.comparisonImage);
  const ratio = properties.width > 0 && properties.height > 0 ? properties.width / properties.height : 1.75;
  let imageWidth = maxImageWidth;
  let imageHeight = imageWidth / ratio;

  if (imageHeight > maxImageHeight) {
    imageHeight = maxImageHeight;
    imageWidth = imageHeight * ratio;
  }

  const imageX = frameX + (frameWidth - imageWidth) / 2;
  const imageY = frameY + (frameHeight - imageHeight) / 2;
  pdf.setDrawColor(...COLORS.line);
  pdf.setFillColor(...COLORS.dark);
  pdf.roundedRect(frameX, frameY, frameWidth, frameHeight, 1.5, 1.5, "FD");
  pdf.addImage(
    input.comparisonImage,
    "PNG",
    imageX,
    imageY,
    imageWidth,
    imageHeight,
    undefined,
    "FAST",
  );
}

export function createComparisonReportPdf(input: ComparisonReportInput) {
  const generatedAt = input.generatedAt ?? new Date();
  const { documentA, documentB, comparison, tolerance, transform } = input;
  const actionable = comparison.differences
    .filter((difference) => difference.severity !== "correct")
    .sort((first, second) => {
      const rank = { large: 2, small: 1, correct: 0 };
      return rank[second.severity] - rank[first.severity] || second.value - first.value;
    });
  const pdf = new jsPDF({
    orientation: input.comparisonImage ? "landscape" : "portrait",
    unit: "mm",
    format: "a4",
    compress: true,
  });

  if (input.comparisonImage) {
    addComparisonPreviewPage(pdf, input, actionable.length);
    pdf.addPage("a4", "portrait");
  }

  pdf.setFillColor(...COLORS.dark);
  pdf.rect(0, 0, 210, 28, "F");
  drawFlowCompareLogo(pdf, 14, 5.5, 60);
  pdf.setFontSize(8.5);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(177, 191, 198);
  pdf.text("Relatório de divergências entre arquivos DXF", 79, 15.5);
  pdf.setFontSize(7.5);
  pdf.text("Comparação geométrica em milímetros", 196, 16, { align: "right" });

  pdf.setTextColor(...COLORS.muted);
  pdf.setFontSize(7.5);
  pdf.text("REFERÊNCIA A", 14, 36);
  pdf.text("ARQUIVO B", 107, 36);
  pdf.setTextColor(...COLORS.ink);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9.5);
  pdf.text(documentA.name, 14, 42, { maxWidth: 84 });
  pdf.text(documentB.name, 107, 42, { maxWidth: 84 });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  pdf.setTextColor(...COLORS.muted);
  pdf.text(`${documentA.entities.length} geometrias | ${documentA.sourceUnits}`, 14, 48);
  pdf.text(`${documentB.entities.length} geometrias | ${documentB.sourceUnits}`, 107, 48);

  const hasDivergence = actionable.length > 0;
  const statusColor = comparison.large > 0 ? COLORS.red : hasDivergence ? COLORS.yellow : COLORS.green;
  pdf.setFillColor(...statusColor);
  pdf.roundedRect(14, 55, 182, 12, 1.5, 1.5, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.text(
    hasDivergence
      ? `${actionable.length} DIVERGÊNCIA(S) ACIMA DA TOLERÂNCIA`
      : "NENHUMA DIVERGÊNCIA ACIMA DA TOLERÂNCIA",
    19,
    63,
  );
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  pdf.text(`Máxima: ${formatNumber(comparison.maxDifference)} mm`, 191, 63, { align: "right" });

  const cardWidth = 42.5;
  summaryCard(pdf, 14, 74, cardWidth, "Similaridade", `${formatNumber(comparison.similarity, 1)}%`, COLORS.blue);
  summaryCard(pdf, 60.5, 74, cardWidth, "Tolerância", `${formatNumber(tolerance)} mm`, COLORS.green);
  summaryCard(pdf, 107, 74, cardWidth, "Pequenas", String(comparison.small), COLORS.yellow);
  summaryCard(pdf, 153.5, 74, cardWidth, "Grandes", String(comparison.large), COLORS.red);

  let cursorY = 104;

  sectionTitle(pdf, "Resumo geométrico", cursorY);
  const areaTolerance = areaToleranceFromLinear(documentA.stats.width, documentA.stats.height, tolerance);
  const geometryRows: Array<{
    label: string;
    a: number;
    b: number;
    unit: "mm" | "mm2" | "count";
    limit: number;
  }> = [
    { label: "Largura total", a: documentA.stats.width, b: comparison.alignedStatsB.width, unit: "mm", limit: tolerance },
    { label: "Comprimento total", a: documentA.stats.height, b: comparison.alignedStatsB.height, unit: "mm", limit: tolerance },
    { label: "Área líquida", a: documentA.stats.area, b: documentB.stats.area, unit: "mm2", limit: areaTolerance },
    { label: "Furos", a: documentA.stats.holes, b: documentB.stats.holes, unit: "count", limit: 0.01 },
    { label: "Recortes", a: documentA.stats.cutouts, b: documentB.stats.cutouts, unit: "count", limit: 0.01 },
    { label: "Contornos", a: documentA.stats.contours, b: documentB.stats.contours, unit: "count", limit: 0.01 },
    { label: "Linhas de dobra", a: documentA.stats.bends, b: documentB.stats.bends, unit: "count", limit: 0.01 },
  ];
  autoTable(pdf, {
    startY: cursorY + 4,
    margin: { left: 14, right: 14, bottom: 15 },
    theme: "grid",
    head: [["Métrica", "Referência A", "Arquivo B", "Diferença", "Situação"]],
    body: geometryRows.map(({ label, a, b, unit, limit }) => {
      const delta = b - a;
      const severity = metricSeverity(delta, limit);
      const digits = unit === "count" ? 0 : 2;
      const suffix = unit === "mm2" ? " mm²" : unit === "count" ? "" : " mm";
      return [
        label,
        `${formatNumber(a, digits)}${suffix}`,
        `${formatNumber(b, digits)}${suffix}`,
        signedNumber(delta, unit === "count" ? " un." : suffix),
        { content: SEVERITY_LABELS[severity], styles: { textColor: severityColor(severity), fontStyle: "bold" } } as CellDef,
      ];
    }),
    styles: { font: "helvetica", fontSize: 7.5, cellPadding: 2.2, textColor: COLORS.ink, lineColor: COLORS.line, lineWidth: 0.2 },
    headStyles: { fillColor: COLORS.dark, textColor: [255, 255, 255], fontStyle: "bold" },
    alternateRowStyles: { fillColor: COLORS.paper },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "center" } },
  });

  cursorY = tableFinalY(pdf, cursorY + 50) + 11;
  if (cursorY > 258) {
    pdf.addPage();
    cursorY = 20;
  }
  sectionTitle(pdf, "Divergências encontradas", cursorY);

  if (actionable.length) {
    autoTable(pdf, {
      startY: cursorY + 4,
      margin: { left: 14, right: 14, bottom: 15 },
      theme: "grid",
      showHead: "everyPage",
      head: [["Elemento", "Categoria", "Origem", "Desvio", "Classificação"]],
      body: actionable.map((difference) => [
        difference.label,
        CATEGORY_LABELS[difference.category],
        sourceLabel(difference.source),
        differenceValue(difference),
        {
          content: SEVERITY_LABELS[difference.severity],
          styles: { textColor: severityColor(difference.severity), fontStyle: "bold" },
        } as CellDef,
      ]),
      styles: { font: "helvetica", fontSize: 7.2, cellPadding: 2.1, textColor: COLORS.ink, lineColor: COLORS.line, lineWidth: 0.2 },
      headStyles: { fillColor: COLORS.dark, textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: COLORS.paper },
      columnStyles: { 3: { halign: "right" }, 4: { halign: "center" } },
    });
    cursorY = tableFinalY(pdf, cursorY + 30) + 11;
  } else {
    pdf.setFillColor(235, 247, 238);
    pdf.setDrawColor(170, 213, 180);
    pdf.roundedRect(14, cursorY + 5, 182, 18, 1.5, 1.5, "FD");
    pdf.setTextColor(...COLORS.green);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text("Todos os itens comparados estão dentro da tolerância definida.", 20, cursorY + 16);
    cursorY += 31;
  }

  if (cursorY > 255) {
    pdf.addPage();
    cursorY = 20;
  }
  sectionTitle(pdf, "Critérios e alinhamento", cursorY);
  pdf.setTextColor(...COLORS.muted);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7.5);
  const criteria = [
    `Correto: desvio menor ou igual a ${formatNumber(tolerance)} mm.`,
    `Pequena divergência: acima da tolerância e até ${formatNumber(tolerance * 5)} mm.`,
    `Grande divergência: acima de ${formatNumber(tolerance * 5)} mm.`,
    `Ajuste aplicado ao Arquivo B: X ${signedNumber(transform.x)}, Y ${signedNumber(transform.y)}, rotação ${signedNumber(transform.rotation, "°")}.`,
    "Valores geométricos são calculados diretamente das entidades importadas dos arquivos DXF.",
  ];
  pdf.text(criteria, 14, cursorY + 7, { maxWidth: 182, lineHeightFactor: 1.55 });

  addPageFooters(pdf, generatedAt);
  return pdf;
}

export function reportFilename(documentA: DxfDocument, documentB: DxfDocument) {
  const clean = (value: string) => value.replace(/\.dxf$/i, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "");
  return `flowcompare-${clean(documentA.name)}-vs-${clean(documentB.name)}.pdf`;
}

export function downloadComparisonReportPdf(input: ComparisonReportInput) {
  const pdf = createComparisonReportPdf(input);
  pdf.save(reportFilename(input.documentA, input.documentB));
}
