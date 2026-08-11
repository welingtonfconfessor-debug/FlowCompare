import {
  AlignCenter,
  Check,
  ChevronDown,
  CircleHelp,
  Download,
  Eye,
  EyeOff,
  FileDown,
  FilePlus2,
  FolderOpen,
  Focus,
  Hand,
  ImageDown,
  Layers3,
  Maximize2,
  Minus,
  Move,
  PanelTop,
  Plus,
  RefreshCcw,
  RotateCcw,
  Ruler,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { alignmentForDocuments, type AlignmentMethod } from "../lib/alignment";
import {
  canvasDeltaFromClient,
  canvasPointFromClient,
  canvasUnitsPerClientPixel,
  measurementDistance,
  snapCanvasPoint,
  transformAfterCanvasDrag,
  viewBoxForBounds,
} from "../lib/canvas-tools";
import { compareDocuments } from "../lib/comparison";
import { parseDxfFile } from "../lib/dxf";
import { transformBounds, transformSegment, unionBounds } from "../lib/geometry";
import type {
  Bounds,
  Difference,
  DifferenceSeverity,
  DrawingTransform,
  DxfDocument,
  Point,
  Segment,
} from "../types";

type Side = "A" | "B";
type ViewTab = "view" | "differences" | "overlay";
type DifferenceFilter = "all" | DifferenceSeverity;
type CanvasTool = "pan" | "measure" | "move";

type Measurement = {
  start: Point;
  end: Point;
  complete: boolean;
};

type SvgViewBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const EMPTY_TRANSFORM: DrawingTransform = { x: 0, y: 0, rotation: 0 };
const EMPTY_VIEWBOX: SvgViewBox = { x: -100, y: -70, width: 200, height: 140 };

const formatNumber = (value: number, digits = 2) =>
  value.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

const differenceUnitSuffix = (difference: Difference) => {
  if (difference.unit === "mm2") return " mm²";
  if (difference.unit === "count") return "";
  return " mm";
};

const formatDifferenceMeasurement = (difference: Difference, signed = false) => {
  const rawValue = signed ? difference.signedValue : difference.value;
  const sign = signed && rawValue !== 0 ? (rawValue > 0 ? "+" : "−") : "";
  const digits = difference.unit === "count" ? 0 : 2;
  return `${sign}${formatNumber(Math.abs(rawValue), digits)}${differenceUnitSuffix(difference)}`;
};

const formatFileSize = (size: number) => {
  if (size < 1024 * 1024) return `${formatNumber(size / 1024, 1)} KB`;
  return `${formatNumber(size / (1024 * 1024), 2)} MB`;
};

const pathFromSegments = (segments: Segment[]) =>
  segments
    .map((segment) => `M ${segment.a.x} ${-segment.a.y} L ${segment.b.x} ${-segment.b.y}`)
    .join(" ");

async function svgToPngDataUrl(svg: SVGSVGElement, width = 1600, height = 1000) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = `
    svg { background: #071015; }
    .grid-minor { stroke: #132129; fill: none; stroke-width: .45; }
    .grid-major { stroke: #1c2d35; fill: none; stroke-width: .7; }
    .axis-line { stroke: #52616a; stroke-width: .7; stroke-dasharray: 7 6; opacity: .55; }
    .drawing-a { stroke: #ff4d57; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
    .drawing-b { stroke: #2f7df6; fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
    .diff-box { stroke: #f5c842; fill: rgba(245,200,66,.025); stroke-width: 1; stroke-dasharray: 6 4; }
    .diff-line { stroke: #f5c842; fill: none; stroke-width: 1; }
    .diff-label { fill: #f5c842; font-family: Arial, sans-serif; font-weight: 700; paint-order: stroke; stroke: #071015; stroke-width: 2px; }
    .severity-large .diff-box, .severity-large .diff-line { stroke: #f08a45; }
    .severity-large .diff-label { fill: #ff9b58; }
    .measurement-line { stroke: #f5c842; fill: none; stroke-width: 1.2; stroke-dasharray: 5 3; }
    .measurement-point { fill: #071015; stroke: #f5c842; stroke-width: 1.2; }
    .measurement-label { fill: #fff1a8; font-family: Arial, sans-serif; font-weight: 700; paint-order: stroke; stroke: #071015; stroke-width: 2px; }
  `;
  clone.prepend(style);
  const source = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error("Não foi possível preparar a imagem da comparação."));
      nextImage.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("O navegador não conseguiu preparar a imagem do relatório.");
    context.fillStyle = "#071015";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/png", 0.95);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const boundsToSvg = (bounds: Bounds) => ({
  x: bounds.minX,
  y: -bounds.maxY,
  width: Math.max(0.001, bounds.maxX - bounds.minX),
  height: Math.max(0.001, bounds.maxY - bounds.minY),
});

function paddedViewBox(bounds: Bounds): SvgViewBox {
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const padding = Math.max(width, height) * 0.09;
  return {
    x: bounds.minX - padding,
    y: -(bounds.maxY + padding),
    width: width + padding * 2,
    height: height + padding * 2,
  };
}

function viewForDocuments(
  documentA: DxfDocument | null,
  documentB: DxfDocument | null,
  transform: DrawingTransform,
) {
  const bounds: Bounds[] = [];
  if (documentA) bounds.push(documentA.bounds);
  if (documentB) bounds.push(transformBounds(documentB.bounds, transform));
  return bounds.length ? paddedViewBox(unionBounds(bounds)) : EMPTY_VIEWBOX;
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch ${checked ? "is-on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

function FileCard({
  side,
  document,
  visible,
  loading,
  onPick,
  onRemove,
  onToggle,
}: {
  side: Side;
  document: DxfDocument | null;
  visible: boolean;
  loading: boolean;
  onPick: () => void;
  onRemove: () => void;
  onToggle: () => void;
}) {
  return (
    <div className={`file-card file-${side.toLowerCase()} ${document ? "has-file" : ""}`}>
      <div className="file-card-heading">
        <span>{side === "A" ? "Referência (A)" : "Arquivo comparado (B)"}</span>
        {document ? (
          <button className="icon-button small" type="button" onClick={onToggle} title={visible ? "Ocultar desenho" : "Mostrar desenho"}>
            {visible ? <Eye size={15} /> : <EyeOff size={15} />}
          </button>
        ) : null}
      </div>
      {document ? (
        <div className="file-info">
          <span className="file-badge">{side}</span>
          <div className="file-copy">
            <strong title={document.name}>{document.name}</strong>
            <span>{formatFileSize(document.size)} · {document.entities.length} geometrias</span>
            <small>{document.sourceUnits}</small>
          </div>
          <button className="icon-button small" type="button" onClick={onRemove} title="Remover arquivo">
            <X size={15} />
          </button>
        </div>
      ) : (
        <button className="file-empty" type="button" onClick={onPick} disabled={loading}>
          <Upload size={18} />
          <span>{loading ? "Lendo DXF..." : `Selecionar DXF ${side}`}</span>
        </button>
      )}
    </div>
  );
}

function MetricRow({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="metric-row">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

export default function FlowCompareWorkspace() {
  const [documentA, setDocumentA] = useState<DxfDocument | null>(null);
  const [documentB, setDocumentB] = useState<DxfDocument | null>(null);
  const [loadingSide, setLoadingSide] = useState<Side | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [transform, setTransform] = useState<DrawingTransform>(EMPTY_TRANSFORM);
  const [tolerance, setTolerance] = useState(0.2);
  const [showA, setShowA] = useState(true);
  const [showB, setShowB] = useState(true);
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const [highlightDifferences, setHighlightDifferences] = useState(true);
  const [ignoreInternal, setIgnoreInternal] = useState(false);
  const [alignmentMethod, setAlignmentMethod] = useState<AlignmentMethod>("bounds");
  const [viewTab, setViewTab] = useState<ViewTab>("view");
  const [differenceFilter, setDifferenceFilter] = useState<DifferenceFilter>("all");
  const [viewBox, setViewBox] = useState<SvgViewBox>(EMPTY_VIEWBOX);
  const [baseViewBox, setBaseViewBox] = useState<SvgViewBox>(EMPTY_VIEWBOX);
  const [canvasTool, setCanvasTool] = useState<CanvasTool>("pan");
  const [measurement, setMeasurement] = useState<Measurement | null>(null);
  const [snapCandidate, setSnapCandidate] = useState<Point | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [isMovingDrawing, setIsMovingDrawing] = useState(false);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [focusedDifferenceId, setFocusedDifferenceId] = useState<string | null>(null);
  const inputARef = useRef<HTMLInputElement>(null);
  const inputBRef = useRef<HTMLInputElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const panRef = useRef<{ x: number; y: number; viewBox: SvgViewBox } | null>(null);
  const moveRef = useRef<{
    x: number;
    y: number;
    transform: DrawingTransform;
    latest: DrawingTransform;
  } | null>(null);

  const comparison = useMemo(() => {
    if (!documentA || !documentB) return null;
    return compareDocuments(documentA, documentB, transform, {
      tolerance,
      ignoreInternal,
    });
  }, [documentA, documentB, transform, tolerance, ignoreInternal]);

  const segmentsA = useMemo(() => documentA?.entities.flatMap((entity) => entity.segments) ?? [], [documentA]);
  const transformedSegmentsB = useMemo(
    () => comparison?.transformedB ?? [],
    [comparison],
  );

  const differingEntityIds = useMemo(() => {
    const idsA = new Set<string>();
    const idsB = new Set<string>();
    comparison?.differences.forEach((difference) => {
      if (difference.severity === "correct") return;
      difference.entityIds?.A.forEach((id) => idsA.add(id));
      difference.entityIds?.B.forEach((id) => idsB.add(id));
      if (difference.id.startsWith("A-")) idsA.add(difference.id.slice(2));
      if (difference.id.startsWith("B-")) idsB.add(difference.id.slice(2));
    });
    return { A: idsA, B: idsB };
  }, [comparison]);

  const displaySegmentsA = useMemo(
    () => (onlyDifferences ? segmentsA.filter((segment) => differingEntityIds.A.has(segment.entityId)) : segmentsA),
    [onlyDifferences, segmentsA, differingEntityIds],
  );
  const displaySegmentsB = useMemo(
    () =>
      onlyDifferences
        ? transformedSegmentsB.filter((segment) => differingEntityIds.B.has(segment.entityId))
        : transformedSegmentsB,
    [onlyDifferences, transformedSegmentsB, differingEntityIds],
  );
  const measurementSegments = useMemo(
    () =>
      showB
        ? documentB?.entities
            .flatMap((entity) => entity.segments)
            .map((segment) => transformSegment(segment, transform)) ?? []
        : [],
    [documentB, showB, transform],
  );
  const measuredDistance = measurement
    ? measurementDistance(measurement.start, measurement.end)
    : 0;

  const fitView = useCallback(() => {
    const next = viewForDocuments(documentA, documentB, transform);
    setViewBox(next);
    setBaseViewBox(next);
  }, [documentA, documentB, transform]);

  const autoAlign = useCallback(() => {
    if (!documentA || !documentB) return;
    const next = alignmentForDocuments(
      documentA,
      documentB,
      alignmentMethod,
      transform.rotation,
    );
    const fitted = viewForDocuments(documentA, documentB, next);
    setTransform(next);
    setViewBox(fitted);
    setBaseViewBox(fitted);
    setMeasurement(null);
    setSnapCandidate(null);
    setNotice(`Desenhos realinhados mantendo a rotação de ${formatNumber(next.rotation, 1)}°.`);
  }, [alignmentMethod, documentA, documentB, transform.rotation]);

  const loadFile = async (side: Side, file?: File) => {
    if (!file) return;
    setLoadingSide(side);
    setError("");
    setNotice("");
    try {
      const parsed = await parseDxfFile(file);
      const nextA = side === "A" ? parsed : documentA;
      const nextB = side === "B" ? parsed : documentB;
      let nextTransform = transform;
      if (nextA && nextB) {
        nextTransform = alignmentForDocuments(nextA, nextB, alignmentMethod);
      }
      const fitted = viewForDocuments(nextA, nextB, nextTransform);
      if (side === "A") setDocumentA(parsed);
      else setDocumentB(parsed);
      if (nextA && nextB) setTransform(nextTransform);
      setViewBox(fitted);
      setBaseViewBox(fitted);
      setFocusedDifferenceId(null);
      setMeasurement(null);
      setSnapCandidate(null);
      setNotice(`${file.name} carregado com sucesso.`);
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : "Não foi possível ler este DXF.");
    } finally {
      setLoadingSide(null);
    }
  };

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files).filter((file) => file.name.toLowerCase().endsWith(".dxf"));
    if (!files.length) {
      setError("Solte um ou dois arquivos DXF nesta área.");
      return;
    }
    if (files[0]) await loadFile(documentA ? "B" : "A", files[0]);
    if (files[1]) await loadFile("B", files[1]);
  };

  const resetProject = () => {
    setDocumentA(null);
    setDocumentB(null);
    setTransform(EMPTY_TRANSFORM);
    setError("");
    setNotice("");
    setCanvasTool("pan");
    setFocusedDifferenceId(null);
    setMeasurement(null);
    setSnapCandidate(null);
    setViewBox(EMPTY_VIEWBOX);
    setBaseViewBox(EMPTY_VIEWBOX);
  };

  const changeViewTab = (tab: ViewTab) => {
    setViewTab(tab);
    if (tab === "differences") setOnlyDifferences(true);
    if (tab === "overlay") {
      setOnlyDifferences(false);
      setShowA(true);
      setShowB(true);
    }
  };

  const zoomAtCenter = (factor: number) => {
    setViewBox((current) => {
      const nextWidth = current.width * factor;
      const nextHeight = current.height * factor;
      return {
        x: current.x + (current.width - nextWidth) / 2,
        y: current.y + (current.height - nextHeight) / 2,
        width: nextWidth,
        height: nextHeight,
      };
    });
  };

  const handleWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const mouse = canvasPointFromClient(event.clientX, event.clientY, rect, viewBox);
    const factor = event.deltaY > 0 ? 1.12 : 0.88;
    const width = viewBox.width * factor;
    const height = viewBox.height * factor;
    setViewBox({
      x: mouse.x - ((mouse.x - viewBox.x) / viewBox.width) * width,
      y: mouse.y - ((mouse.y - viewBox.y) / viewBox.height) * height,
      width,
      height,
    });
  };

  const measurementPoint = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const point = canvasPointFromClient(event.clientX, event.clientY, rect, viewBox);
    const snapDistance = canvasUnitsPerClientPixel(rect, viewBox) * 8;
    return snapCanvasPoint(point, measurementSegments, snapDistance);
  };

  const startCanvasInteraction = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (canvasTool === "measure") {
      const point = measurementPoint(event);
      setSnapCandidate(point);
      if (!point) {
        setNotice("Aproxime o cursor de uma geometria do Arquivo B para medir.");
        return;
      }
      if (!measurement || measurement.complete) {
        setMeasurement({ start: point, end: point, complete: false });
        setNotice("");
      } else {
        const next = { ...measurement, end: point, complete: true };
        setMeasurement(next);
        setNotice(`Medição concluída: ${formatNumber(measurementDistance(next.start, next.end))} mm.`);
      }
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    if (canvasTool === "move" && documentB) {
      moveRef.current = {
        x: event.clientX,
        y: event.clientY,
        transform,
        latest: transform,
      };
      setIsMovingDrawing(true);
      setMeasurement(null);
      return;
    }

    panRef.current = { x: event.clientX, y: event.clientY, viewBox };
    setIsPanning(true);
  };

  const moveCanvasInteraction = (event: ReactPointerEvent<SVGSVGElement>) => {
    const hoverPoint = panRef.current || moveRef.current ? null : measurementPoint(event);
    setSnapCandidate(hoverPoint);

    if (canvasTool === "measure") {
      if (measurement && !measurement.complete) {
        if (hoverPoint) setMeasurement({ ...measurement, end: hoverPoint });
      }
      return;
    }

    const moving = moveRef.current;
    if (moving) {
      const rect = event.currentTarget.getBoundingClientRect();
      const next = transformAfterCanvasDrag(
        moving.transform,
        { x: moving.x, y: moving.y },
        { x: event.clientX, y: event.clientY },
        rect,
        viewBox,
      );
      moving.latest = next;
      setTransform(next);
      return;
    }

    const start = panRef.current;
    if (!start) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const delta = canvasDeltaFromClient(
      { x: start.x, y: start.y },
      { x: event.clientX, y: event.clientY },
      rect,
      start.viewBox,
    );
    setViewBox({
      ...start.viewBox,
      x: start.viewBox.x - delta.x,
      y: start.viewBox.y - delta.y,
    });
  };

  const endCanvasInteraction = () => {
    const moved = moveRef.current?.latest;
    if (moved) {
      setNotice(`Arquivo B ajustado para X ${formatNumber(moved.x)} mm e Y ${formatNumber(moved.y)} mm.`);
    }
    moveRef.current = null;
    panRef.current = null;
    setIsMovingDrawing(false);
    setIsPanning(false);
  };

  const selectCanvasTool = (tool: CanvasTool) => {
    panRef.current = null;
    moveRef.current = null;
    setIsPanning(false);
    setIsMovingDrawing(false);
    setCanvasTool(tool);
    setSnapCandidate(null);
    if (tool === "measure" || tool === "move") setMeasurement(null);
  };

  const exportImage = async () => {
    const svg = svgRef.current;
    if (!svg || (!documentA && !documentB)) return;
    try {
      const imageData = await svgToPngDataUrl(svg);
      const link = document.createElement("a");
      link.href = imageData;
      link.download = "flowcompare-comparacao.png";
      link.click();
    } catch (imageError) {
      setError(imageError instanceof Error ? imageError.message : "Não foi possível exportar a imagem.");
    }
  };

  const generateReport = async () => {
    if (!documentA || !documentB || !comparison || isGeneratingReport) return;
    setIsGeneratingReport(true);
    setError("");
    setNotice("");
    try {
      const comparisonImage = svgRef.current
        ? await svgToPngDataUrl(svgRef.current, 1400, 800)
        : undefined;
      const { downloadComparisonReportPdf } = await import("../lib/report");
      downloadComparisonReportPdf({
        documentA,
        documentB,
        comparison,
        tolerance,
        transform,
        comparisonImage,
      });
      const actionable = comparison.small + comparison.large;
      setNotice(
        actionable
          ? `Relatório gerado com ${actionable} divergência(s) acima da tolerância.`
          : "Relatório gerado sem divergências acima da tolerância.",
      );
    } catch (reportError) {
      setError(reportError instanceof Error ? reportError.message : "Não foi possível gerar o relatório PDF.");
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const visibleDifferences = useMemo(() => {
    const items = comparison?.differences ?? [];
    if (differenceFilter === "all") return items;
    return items.filter((difference) => difference.severity === differenceFilter);
  }, [comparison, differenceFilter]);

  const highlighted = useMemo(
    () => {
      const differences = comparison?.differences ?? [];
      const focused = differences.find(
        (difference) => difference.id === focusedDifferenceId && difference.severity !== "correct",
      );
      const visible = differences
        .filter(
          (difference) =>
            difference.severity !== "correct" &&
            difference.source !== "metric" &&
            difference.id !== focused?.id,
        )
        .sort((first, second) => second.value - first.value);
      return focused ? [focused, ...visible].slice(0, 8) : visible.slice(0, 8);
    },
    [comparison, focusedDifferenceId],
  );

  const focusDifference = useCallback((difference: Difference) => {
    const rect = svgRef.current?.getBoundingClientRect();
    const aspectRatio = rect?.height ? rect.width / rect.height : viewBox.width / viewBox.height;
    const minimumSpan = Math.max(baseViewBox.width, baseViewBox.height) * 0.015;
    setViewBox(viewBoxForBounds(difference.bounds, aspectRatio, 0.16, minimumSpan));
    setFocusedDifferenceId(difference.id);
    setHighlightDifferences(true);
    setOnlyDifferences(false);
    setCanvasTool("pan");
    setMeasurement(null);
    setSnapCandidate(null);
    setNotice(`Visualização centralizada em ${difference.label}.`);
  }, [baseViewBox.height, baseViewBox.width, viewBox.height, viewBox.width]);

  const zoomPercent = Math.round((baseViewBox.width / viewBox.width) * 100);
  const measurementLabelSize = Math.max(viewBox.width / 95, 2.5);
  const measurementMidpoint = measurement
    ? {
        x: (measurement.start.x + measurement.end.x) / 2,
        y: (measurement.start.y + measurement.end.y) / 2,
      }
    : null;

  return (
    <main className="flow-app">
      <header className="topbar">
        <div className="brand">
          <img className="brand-logo" src="/flowcompare-logo-dark.svg" alt="FlowCompare" />
          <span className="brand-subtitle">Comparador DXF</span>
        </div>
        <nav className="top-actions" aria-label="Ações do projeto">
          <button type="button" onClick={resetProject}><FilePlus2 size={17} />Novo</button>
          <button type="button" onClick={() => (documentA ? inputBRef.current : inputARef.current)?.click()}><FolderOpen size={17} />Abrir</button>
          <button type="button" onClick={generateReport} disabled={!comparison || isGeneratingReport} title="Gerar relatório da comparação atual"><FileDown size={17} />{isGeneratingReport ? "Gerando PDF..." : "Relatório PDF"}</button>
          <button type="button" onClick={exportImage} disabled={!documentA && !documentB}><ImageDown size={17} />Exportar imagem</button>
        </nav>
        <div className="top-tools">
          <button className="icon-button" type="button" title="Configurações"><Settings size={18} /></button>
          <button className="icon-button" type="button" title="Ajuda"><CircleHelp size={18} /></button>
        </div>
      </header>

      <div className="app-grid">
        <aside className="left-panel side-panel">
          <section className="panel-section files-section">
            <div className="section-title"><FolderOpen size={15} /><h2>Arquivos</h2></div>
            <input ref={inputARef} type="file" accept=".dxf" hidden onChange={(event) => loadFile("A", event.target.files?.[0])} />
            <input ref={inputBRef} type="file" accept=".dxf" hidden onChange={(event) => loadFile("B", event.target.files?.[0])} />
            <FileCard
              side="A"
              document={documentA}
              visible={showA}
              loading={loadingSide === "A"}
              onPick={() => inputARef.current?.click()}
              onRemove={() => setDocumentA(null)}
              onToggle={() => setShowA((current) => !current)}
            />
            <FileCard
              side="B"
              document={documentB}
              visible={showB}
              loading={loadingSide === "B"}
              onPick={() => inputBRef.current?.click()}
              onRemove={() => setDocumentB(null)}
              onToggle={() => setShowB((current) => !current)}
            />
            <div className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
              <Upload size={18} />
              <span>Arraste até dois arquivos DXF</span>
              <button type="button" onClick={() => (documentA ? inputBRef.current : inputARef.current)?.click()}>Selecionar arquivo</button>
            </div>
            {error ? <div className="message error-message">{error}</div> : null}
            {!error && notice ? <div className="message success-message"><Check size={14} />{notice}</div> : null}
          </section>

          <section className="panel-section">
            <div className="section-title"><AlignCenter size={15} /><h2>Alinhamento</h2></div>
            <label className="field-label" htmlFor="alignment">Método</label>
            <div className="select-wrap">
              <select id="alignment" value={alignmentMethod} onChange={(event) => setAlignmentMethod(event.target.value as AlignmentMethod)}>
                <option value="bounds">Automático · centro dos limites</option>
                <option value="origin">Automático · canto de origem</option>
              </select>
              <ChevronDown size={15} />
            </div>
            <div className={`alignment-status ${documentA && documentB ? "ready" : ""}`}>
              <Sparkles size={15} />
              <div>
                <strong>{documentA && documentB ? "Arquivos prontos para alinhar" : "Aguardando os dois DXFs"}</strong>
                <span>{documentA && documentB ? `Deslocamento: ${formatNumber(Math.hypot(transform.x, transform.y))} mm · Rotação: ${formatNumber(transform.rotation, 1)}°` : "Importe A e B para comparar"}</span>
              </div>
            </div>
            <div className="manual-grid">
              <label>
                <span>X</span>
                <div className="unit-input"><input type="number" step="0.01" value={transform.x} onChange={(event) => setTransform((current) => ({ ...current, x: Number(event.target.value) }))} /><small>mm</small></div>
              </label>
              <label>
                <span>Y</span>
                <div className="unit-input"><input type="number" step="0.01" value={transform.y} onChange={(event) => setTransform((current) => ({ ...current, y: Number(event.target.value) }))} /><small>mm</small></div>
              </label>
            </div>
            <label className="rotation-field">
              <span>Rotação</span>
              <div className="unit-input"><input type="number" step="0.1" value={transform.rotation} onChange={(event) => setTransform((current) => ({ ...current, rotation: Number(event.target.value) }))} /><small>°</small></div>
            </label>
            <div className="alignment-actions">
              <button type="button" className="secondary-button" onClick={() => setTransform(EMPTY_TRANSFORM)} title="Zerar ajustes"><RotateCcw size={16} /></button>
              <button type="button" className="secondary-button wide" onClick={autoAlign} disabled={!documentA || !documentB}><RefreshCcw size={15} />Realinhar</button>
            </div>
          </section>

          <section className="panel-section options-section">
            <div className="section-title"><SlidersHorizontal size={15} /><h2>Comparação</h2></div>
            <label className="option-line tolerance-line">
              <span>Tolerância</span>
              <div className="unit-input compact"><input type="number" min="0.001" step="0.01" value={tolerance} onChange={(event) => setTolerance(Math.max(0.001, Number(event.target.value)))} /><small>mm</small></div>
            </label>
            <div className="option-line"><span>Mostrar somente diferenças</span><Toggle checked={onlyDifferences} onChange={setOnlyDifferences} label="Mostrar somente diferenças" /></div>
            <div className="option-line"><span>Destacar regiões diferentes</span><Toggle checked={highlightDifferences} onChange={setHighlightDifferences} label="Destacar regiões diferentes" /></div>
            <div className="option-line"><span>Ignorar elementos internos</span><Toggle checked={ignoreInternal} onChange={setIgnoreInternal} label="Ignorar elementos internos" /></div>
            <button type="button" className="primary-button" onClick={fitView} disabled={!documentA || !documentB}><Focus size={17} />Comparar arquivos</button>
          </section>
        </aside>

        <section className="workspace-panel">
          <div className="workspace-toolbar">
            <div className="view-tabs" role="tablist" aria-label="Modo de visualização">
              <button className={viewTab === "view" ? "active" : ""} type="button" onClick={() => changeViewTab("view")}><Eye size={15} />Visualização</button>
              <button className={viewTab === "differences" ? "active" : ""} type="button" onClick={() => changeViewTab("differences")}><Ruler size={15} />Diferenças</button>
              <button className={viewTab === "overlay" ? "active" : ""} type="button" onClick={() => changeViewTab("overlay")}><Layers3 size={15} />Sobreposição</button>
            </div>
            <div className="zoom-control">
              <span>Zoom</span>
              <button type="button" onClick={() => zoomAtCenter(1.15)} title="Diminuir zoom"><Minus size={14} /></button>
              <strong>{zoomPercent}%</strong>
              <button type="button" onClick={() => zoomAtCenter(0.87)} title="Aumentar zoom"><Plus size={14} /></button>
              <button type="button" onClick={fitView} title="Ajustar à tela"><Maximize2 size={15} /></button>
            </div>
          </div>

          <div className="legend-bar">
            <button type="button" className={!showA ? "muted" : ""} onClick={() => setShowA((current) => !current)}><i className="legend-line reference" />Referência A</button>
            <button type="button" className={!showB ? "muted" : ""} onClick={() => setShowB((current) => !current)}><i className="legend-line compared" />Arquivo B</button>
            <span><i className="legend-line overlap" />Coincidência</span>
            <span><i className="legend-line difference" />Diferença</span>
          </div>

          <div className={`drawing-stage tool-${canvasTool} ${isPanning ? "is-panning" : ""} ${isMovingDrawing ? "is-moving-drawing" : ""}`}>
            <svg
              ref={svgRef}
              className="drawing-canvas"
              viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
              onWheel={handleWheel}
              onPointerDown={startCanvasInteraction}
              onPointerMove={moveCanvasInteraction}
              onPointerUp={endCanvasInteraction}
              onPointerCancel={endCanvasInteraction}
              onPointerLeave={() => setSnapCandidate(null)}
              aria-label="Área de comparação dos desenhos DXF"
            >
              <defs>
                <pattern id="cad-grid-small" width="10" height="10" patternUnits="userSpaceOnUse">
                  <path d="M 10 0 L 0 0 0 10" className="grid-minor" />
                </pattern>
                <pattern id="cad-grid" width="50" height="50" patternUnits="userSpaceOnUse">
                  <rect width="50" height="50" fill="url(#cad-grid-small)" />
                  <path d="M 50 0 L 0 0 0 50" className="grid-major" />
                </pattern>
              </defs>
              <rect x={viewBox.x} y={viewBox.y} width={viewBox.width} height={viewBox.height} fill="url(#cad-grid)" />
              <line x1={viewBox.x} y1="0" x2={viewBox.x + viewBox.width} y2="0" className="axis-line" />
              <line x1="0" y1={viewBox.y} x2="0" y2={viewBox.y + viewBox.height} className="axis-line" />
              {showA && displaySegmentsA.length ? <path className="drawing-a" d={pathFromSegments(displaySegmentsA)} /> : null}
              {showB && displaySegmentsB.length ? <path className="drawing-b" d={pathFromSegments(displaySegmentsB)} /> : null}
              {highlightDifferences
                ? highlighted.map((difference, index) => {
                    const region = boundsToSvg(difference.bounds);
                    const padding = Math.max(viewBox.width / 220, tolerance * 2);
                    const labelSize = Math.max(viewBox.width / 95, 2.5);
                    const labelX = region.x + region.width + padding * 1.4;
                    const labelY = region.y - padding - index * labelSize * 0.08;
                    return (
                      <g key={difference.id} className={`difference-mark severity-${difference.severity} ${difference.id === focusedDifferenceId ? "is-focused" : ""}`}>
                        <rect className="diff-box" x={region.x - padding} y={region.y - padding} width={region.width + padding * 2} height={region.height + padding * 2} rx={padding * 0.25} />
                        <line className="diff-line" x1={region.x + region.width} y1={region.y} x2={labelX} y2={labelY} />
                        <text className="diff-label" x={labelX + padding * 0.35} y={labelY} fontSize={labelSize}>
                          {formatDifferenceMeasurement(difference, true)}
                        </text>
                      </g>
                    );
                  })
                : null}
              {measurement && measurementMidpoint ? (
                <g className={`measurement-overlay ${measurement.complete ? "complete" : "preview"}`}>
                  <line className="measurement-line" x1={measurement.start.x} y1={measurement.start.y} x2={measurement.end.x} y2={measurement.end.y} />
                  <circle className="measurement-point" cx={measurement.start.x} cy={measurement.start.y} r={measurementLabelSize * 0.28} />
                  <circle className="measurement-point" cx={measurement.end.x} cy={measurement.end.y} r={measurementLabelSize * 0.28} />
                  <text className="measurement-label" x={measurementMidpoint.x} y={measurementMidpoint.y - measurementLabelSize * 0.55} fontSize={measurementLabelSize} textAnchor="middle">
                    {`${formatNumber(measuredDistance)} mm`}
                  </text>
                </g>
              ) : null}
              {showB && snapCandidate ? (
                <circle
                  className="snap-candidate"
                  cx={snapCandidate.x}
                  cy={snapCandidate.y}
                  r={measurementLabelSize * 0.4}
                />
              ) : null}
            </svg>

            {!documentA && !documentB ? (
              <div className="empty-stage">
                <span className="empty-icon"><PanelTop size={30} /></span>
                <h1>Área de comparação DXF</h1>
                <p>Importe a Referência A e o Arquivo B para sobrepor os desenhos.</p>
                <div className="empty-actions">
                  <button type="button" className="primary-button" onClick={() => inputARef.current?.click()}><Upload size={16} />Importar Referência A</button>
                  <button type="button" className="secondary-button" onClick={() => inputBRef.current?.click()}><FolderOpen size={16} />Importar Arquivo B</button>
                </div>
              </div>
            ) : null}

            <div className="canvas-tools">
              <button className={canvasTool === "pan" ? "active" : ""} type="button" title="Navegar pelo desenho" aria-pressed={canvasTool === "pan"} onClick={() => selectCanvasTool("pan")}><Hand size={17} /></button>
              <button type="button" title="Enquadrar desenhos" onClick={() => { fitView(); setNotice("Visualização ajustada à área dos desenhos."); }}><Focus size={17} /></button>
              <button className={canvasTool === "measure" ? "active" : ""} type="button" title="Medir entre linhas do Arquivo B" aria-pressed={canvasTool === "measure"} disabled={!documentB || !showB} onClick={() => selectCanvasTool("measure")}><Ruler size={17} /></button>
              <button className={canvasTool === "move" ? "active" : ""} type="button" title="Arrastar o Arquivo B" aria-pressed={canvasTool === "move"} disabled={!documentB} onClick={() => selectCanvasTool("move")}><Move size={17} /></button>
            </div>
          </div>
        </section>

        <aside className="right-panel side-panel">
          <div className="right-panel-scroll">
          <section className="panel-section summary-section">
            <div className="section-title"><PanelTop size={15} /><h2>Resumo da comparação</h2></div>
            <div className="similarity-wrap">
              <div
                className="similarity-ring"
                style={{ background: `conic-gradient(#58c96a ${comparison?.similarity ?? 0}%, #263238 0)` }}
              >
                <div>
                  <strong>{formatNumber(comparison?.similarity ?? 0, 1)}%</strong>
                  <span>Similaridade</span>
                </div>
              </div>
            </div>
            <div className="stats-list">
              <MetricRow label="Elementos comparados" value={comparison?.totalCompared ?? 0} />
              <MetricRow label="Corretos (na tolerância)" value={comparison?.correct ?? 0} tone="tone-correct" />
              <MetricRow label="Diferenças pequenas" value={comparison?.small ?? 0} tone="tone-small" />
              <MetricRow label="Diferenças grandes" value={comparison?.large ?? 0} tone="tone-large" />
              <MetricRow label="Máxima diferença" value={`${formatNumber(comparison?.maxDifference ?? 0)} mm`} />
            </div>
          </section>

          <section className="panel-section details-section">
            <div className="section-title"><Ruler size={15} /><h2>Detalhes das diferenças</h2></div>
            <div className="filter-tabs">
              <button className={differenceFilter === "all" ? "active" : ""} type="button" onClick={() => setDifferenceFilter("all")}>Todas <span>{comparison?.totalCompared ?? 0}</span></button>
              <button className={differenceFilter === "large" ? "active" : ""} type="button" onClick={() => setDifferenceFilter("large")}>Grandes <span>{comparison?.large ?? 0}</span></button>
              <button className={differenceFilter === "small" ? "active" : ""} type="button" onClick={() => setDifferenceFilter("small")}>Pequenas <span>{comparison?.small ?? 0}</span></button>
            </div>
            <div className="difference-header"><span>Elemento</span><span>Diferença</span></div>
            <div className="difference-list">
              {visibleDifferences.length ? (
                visibleDifferences.map((difference) => (
                  <DifferenceRow
                    key={difference.id}
                    difference={difference}
                    focused={difference.id === focusedDifferenceId}
                    onFocus={focusDifference}
                  />
                ))
              ) : (
                <div className="empty-list">
                  <Layers3 size={21} />
                  <span>{comparison ? "Nenhum item neste filtro." : "As diferenças aparecerão após importar os dois DXFs."}</span>
                </div>
              )}
            </div>
          </section>

          <section className="panel-section geometry-section">
            <div className="section-title"><SlidersHorizontal size={15} /><h2>Geometria dos arquivos</h2></div>
            <div className="geometry-head"><span>Métrica</span><b>A</b><b>B</b></div>
            <GeometryRow label="Largura" a={documentA?.stats.width} b={comparison?.alignedStatsB.width ?? documentB?.stats.width} suffix="mm" />
            <GeometryRow label="Comprimento" a={documentA?.stats.height} b={comparison?.alignedStatsB.height ?? documentB?.stats.height} suffix="mm" />
            <GeometryRow label="Área líquida" a={documentA?.stats.area} b={documentB?.stats.area} suffix="mm²" />
            <GeometryRow label="Furos" a={documentA?.stats.holes} b={documentB?.stats.holes} />
            <GeometryRow label="Recortes" a={documentA?.stats.cutouts} b={documentB?.stats.cutouts} />
            <GeometryRow label="Contornos" a={documentA?.stats.contours} b={documentB?.stats.contours} />
            <GeometryRow label="Linhas de dobra" a={documentA?.stats.bends} b={documentB?.stats.bends} />
          </section>
          </div>

          <button type="button" className="report-button" onClick={generateReport} disabled={!comparison || isGeneratingReport} title="Gerar relatório com as divergências encontradas"><Download size={17} />{isGeneratingReport ? "Gerando relatório..." : "Gerar relatório PDF"}</button>
        </aside>
      </div>
    </main>
  );
}

function DifferenceRow({
  difference,
  focused,
  onFocus,
}: {
  difference: Difference;
  focused: boolean;
  onFocus: (difference: Difference) => void;
}) {
  return (
    <div className={`difference-row severity-${difference.severity} ${focused ? "is-focused" : ""}`}>
      <span title={difference.label}>{difference.label}</span>
      <strong>{formatDifferenceMeasurement(difference, true)}</strong>
      {difference.severity === "correct" ? (
        <Check size={15} />
      ) : (
        <button
          className="difference-focus"
          type="button"
          onClick={() => onFocus(difference)}
          title={`Ir para ${difference.label}`}
          aria-label={`Ir para ${difference.label}`}
        >
          <Eye size={15} />
        </button>
      )}
    </div>
  );
}

function GeometryRow({ label, a, b, suffix = "" }: { label: string; a?: number; b?: number; suffix?: string }) {
  const value = (input?: number) => (input === undefined ? "—" : `${formatNumber(input, suffix ? 2 : 0)}${suffix ? ` ${suffix}` : ""}`);
  return (
    <div className="geometry-row">
      <span>{label}</span>
      <b>{value(a)}</b>
      <b>{value(b)}</b>
    </div>
  );
}
