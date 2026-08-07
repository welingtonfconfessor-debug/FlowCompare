import { jsPDF } from "jspdf";
import autoTable, { type CellDef } from "jspdf-autotable";
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
  const isCount = /holes|cutouts|contours/.test(difference.id);
  if (difference.source === "metric") {
    return signedNumber(difference.signedValue, isCount ? " un." : " mm");
  }
  return `${formatNumber(difference.value)} mm`;
}

function severityColor(severity: DifferenceSeverity) {
  if (severity === "large") return COLORS.red;
  if (severity === "small") return COLORS.yellow;
  return COLORS.green;
}

function metricSeverity(delta: number, tolerance: number, count = false): DifferenceSeverity {
  const limit = count ? 0.01 : tolerance;
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
    pdf.setDrawColor(...COLORS.line);
    pdf.line(14, 286, 196, 286);
    pdf.setTextColor(...COLORS.muted);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.text("FlowCompare | Relatório de divergências DXF", 14, 291);
    pdf.text(
      `Gerado em ${generatedAt.toLocaleString("pt-BR")} | Página ${page} de ${totalPages}`,
      196,
      291,
      { align: "right" },
    );
  }
}

export function createComparisonReportPdf(input: ComparisonReportInput) {
  const generatedAt = input.generatedAt ?? new Date();
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  const { documentA, documentB, comparison, tolerance, transform } = input;
  const actionable = comparison.differences
    .filter((difference) => difference.severity !== "correct")
    .sort((first, second) => {
      const rank = { large: 2, small: 1, correct: 0 };
      return rank[second.severity] - rank[first.severity] || second.value - first.value;
    });

  pdf.setFillColor(...COLORS.dark);
  pdf.rect(0, 0, 210, 28, "F");
  pdf.setFillColor(...COLORS.blue);
  pdf.roundedRect(14, 7, 14, 14, 2, 2, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.text("FC", 21, 16, { align: "center" });
  pdf.setFontSize(16);
  pdf.text("FlowCompare", 34, 13);
  pdf.setFontSize(8.5);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(177, 191, 198);
  pdf.text("Relatório de divergências entre arquivos DXF", 34, 19);
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
  if (input.comparisonImage) {
    sectionTitle(pdf, "Sobreposição analisada", cursorY);
    pdf.setDrawColor(...COLORS.line);
    pdf.setFillColor(...COLORS.dark);
    pdf.roundedRect(14, cursorY + 4, 182, 66, 1.5, 1.5, "FD");
    pdf.addImage(input.comparisonImage, "PNG", 16, cursorY + 6, 178, 62, undefined, "FAST");
    cursorY += 78;
  }

  sectionTitle(pdf, "Resumo geométrico", cursorY);
  const geometryRows: Array<[string, number, number, boolean]> = [
    ["Largura total", documentA.stats.width, documentB.stats.width, false],
    ["Comprimento total", documentA.stats.height, documentB.stats.height, false],
    ["Comprimento de geometria", documentA.stats.totalLength, documentB.stats.totalLength, false],
    ["Furos", documentA.stats.holes, documentB.stats.holes, true],
    ["Recortes", documentA.stats.cutouts, documentB.stats.cutouts, true],
    ["Contornos", documentA.stats.contours, documentB.stats.contours, true],
    ["Linhas de dobra", documentA.stats.bends, documentB.stats.bends, true],
  ];
  autoTable(pdf, {
    startY: cursorY + 4,
    margin: { left: 14, right: 14, bottom: 15 },
    theme: "grid",
    head: [["Métrica", "Referência A", "Arquivo B", "Diferença", "Situação"]],
    body: geometryRows.map(([label, a, b, count]) => {
      const delta = b - a;
      const severity = metricSeverity(delta, tolerance, count);
      return [
        label,
        count ? formatNumber(a, 0) : `${formatNumber(a)} mm`,
        count ? formatNumber(b, 0) : `${formatNumber(b)} mm`,
        signedNumber(delta, count ? " un." : " mm"),
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
