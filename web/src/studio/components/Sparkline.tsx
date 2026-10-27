/**
 * Reusable cubic-Bezier area sparkline.  Shared by Dashboard (MiniSpark) and
 * Explorer (Spark) — they used an identical path-building algorithm, differing
 * only in slice length, dimensions, gradient id, and color.
 */

interface SparklineProps {
  data: number[];
  /** How many trailing data points to render. */
  slice?: number;
  width?: number;
  height?: number;
  /** CSS color value for the stroke and gradient fill. */
  color: string;
  /** Must be unique per page to avoid SVG gradient-id collisions. */
  gradientId: string;
  /** Extra class name applied to the `<svg>` element. */
  className?: string;
  /** Whether to return null (default) or an empty svg when length < 2. */
  emptyMode?: "null" | "empty-svg";
  /** SVG stroke width (default 1.6). */
  strokeWidth?: number;
  /** Gradient fill start opacity (default 0.30). */
  fillOpacity?: number;
  /** Whether to add strokeLinecap/strokeLinejoin="round" (default true). */
  roundCaps?: boolean;
}

export function Sparkline({
  data,
  slice = 20,
  width = 120,
  height = 38,
  color,
  gradientId,
  className,
  emptyMode = "null",
  strokeWidth = 1.6,
  fillOpacity = 0.30,
  roundCaps = true,
}: SparklineProps) {
  const d = data.slice(-slice);
  const w = width, h = height;
  const max = Math.max(1, ...d);
  if (d.length < 2) {
    if (emptyMode === "empty-svg") {
      return <svg className={className} viewBox={`0 0 ${w} ${h}`} />;
    }
    return null;
  }
  const pts = d.map((v, i) => [(i / (d.length - 1)) * w, h - 3 - (v / max) * (h - 8)] as const);
  let path = `M ${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const mx = (pts[i]![0] + pts[i + 1]![0]) / 2;
    path += ` C ${mx} ${pts[i]![1]}, ${mx} ${pts[i + 1]![1]}, ${pts[i + 1]![0]} ${pts[i + 1]![1]}`;
  }
  return (
    <svg
      className={className}
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      preserveAspectRatio="none"
      style={className ? undefined : { display: "block" }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={fillOpacity} />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path} L ${w} ${h} L 0 ${h} Z`} fill={`url(#${gradientId})`} />
      <path d={path} fill="none" stroke={color} strokeWidth={strokeWidth}
        {...(roundCaps ? { strokeLinecap: "round" as const, strokeLinejoin: "round" as const } : {})} />
    </svg>
  );
}
