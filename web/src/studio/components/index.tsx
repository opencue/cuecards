/**
 * cue studio — atomic presentational components.
 * All styling comes from src/studio/styles.css; no API hooks here.
 */
import React from "react";

// ── Dot ──────────────────────────────────────────────────────────────────────

export interface DotProps {
  /** Visual state of the dot. */
  variant?: "ok" | "violet" | "warn" | "red";
  /** Extra CSS class names. */
  className?: string;
}

/** Small status indicator circle. Wraps `.hdot` CSS class. */
export function Dot({ variant = "ok", className = "" }: DotProps) {
  return (
    <span
      className={`hdot ${variant === "warn" ? "amber" : variant} ${className}`.trim()}
    />
  );
}

/** Live (pulsing green) indicator dot. Wraps `.live-dot`. */
export function LiveDot({ className = "" }: { className?: string }) {
  return <span className={`live-dot ${className}`.trim()} />;
}

// ── Badge / Pill ──────────────────────────────────────────────────────────────

export interface PillProps {
  /** Label text. */
  label: string;
  /** Optional numeric count shown in a violet badge at the right. */
  count?: number;
  className?: string;
}

/** Pill-shaped label with an optional count chip. Wraps `.pill`. */
export function Pill({ label, count, className = "" }: PillProps) {
  return (
    <div className={`pill ${className}`.trim()}>
      <span className="pill-t">{label}</span>
      {count !== undefined && <span className="pill-n">{count}</span>}
    </div>
  );
}

export interface McpBadgeProps {
  label: string;
  /** ok = green "installed" style */
  variant?: "default" | "ok";
  className?: string;
}

/** Small tag badge for MCP/skill cards. Wraps `.mc-badge`. */
export function McpBadge({ label, variant = "default", className = "" }: McpBadgeProps) {
  const cls = `mc-badge${variant === "ok" ? " ok" : ""} ${className}`.trim();
  return <span className={cls}>{label}</span>;
}

// ── StatTile ──────────────────────────────────────────────────────────────────

export interface StatTileProps {
  /** Large number or value to display. */
  value: string | number;
  /** Short label below the number. */
  label: string;
  /** Optional sub-label (even smaller, dim). */
  sub?: string;
  /** Semantic color for the number. */
  variant?: "default" | "violet" | "green" | "red" | "amber";
  /** Size: "lg" = 26px (`.stat-n`), "md" = 23px (`.mt-n`). */
  size?: "lg" | "md";
  className?: string;
}

/**
 * Metric tile — a big number with a label. Wraps `.stat` / `.mt-n` CSS.
 * Used in dashboard band stat groups.
 */
export function StatTile({
  value,
  label,
  sub,
  variant = "default",
  size = "lg",
  className = "",
}: StatTileProps) {
  const numClass =
    size === "lg"
      ? `stat-n${variant !== "default" ? ` ${variant}` : ""}`
      : `mt-n${variant !== "default" ? ` ${variant}` : ""}`;
  const labelClass = size === "lg" ? "stat-l" : "mt-l";

  return (
    <div className={`stat ${className}`.trim()}>
      <span className={numClass}>{value}</span>
      <span className={labelClass}>{label}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

// ── Band ──────────────────────────────────────────────────────────────────────

export interface BandProps {
  /** Section heading text (rendered uppercase). */
  heading: string;
  /** Optional tag shown at the far right of the heading row. */
  tag?: string;
  /** ok = green filled tag. */
  tagVariant?: "default" | "ok";
  /** Optional icon element for the heading row. */
  icon?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

/**
 * Rounded card section used in the dashboard three-column grid.
 * Wraps `.band`, `.band-top`, `.band-h`, `.band-tag`.
 */
export function Band({
  heading,
  tag,
  tagVariant = "default",
  icon,
  children,
  className = "",
}: BandProps) {
  return (
    <div className={`band ${className}`.trim()}>
      <div className="band-top">
        {icon && <span className="band-ic">{icon}</span>}
        <h3 className="band-h">{heading}</h3>
        {tag && (
          <span className={`band-tag${tagVariant === "ok" ? " ok" : ""}`}>
            {tag}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────

export interface CardProps {
  /** Card heading text. */
  title?: string;
  /** Subtitle below the title. */
  subtitle?: string;
  /** Status dot in the title row. */
  dot?: "ok" | "warn" | "red" | "live";
  /** Slot for actions (buttons, badges) placed at top-right. */
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

/**
 * Primary container card. Wraps `.card`, `.card-head`, `.card-title`, `.card-sub`.
 * Every card has a header with a status dot, a title, and optional actions.
 */
export function Card({
  title,
  subtitle,
  dot,
  actions,
  children,
  className = "",
}: CardProps) {
  const hasHeader = title || dot || actions;
  return (
    <div className={`card ${className}`.trim()}>
      {hasHeader && (
        <div className="card-head">
          <div>
            {title && (
              <div className="card-title">
                {dot === "live" ? <LiveDot /> : dot && <Dot variant={dot} />}
                {title}
              </div>
            )}
            {subtitle && (
              <div className="card-sub" dangerouslySetInnerHTML={{ __html: subtitle }} />
            )}
          </div>
          {actions && <div>{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

// ── GhostButton ───────────────────────────────────────────────────────────────

export interface GhostButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  /** danger = red text on hover */
  variant?: "default" | "danger";
  active?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * Transparent-bg bordered button — the studio's default action style.
 * No dedicated CSS class in the sheet; styled inline with variables.
 */
export function GhostButton({
  children,
  onClick,
  variant = "default",
  active = false,
  disabled = false,
  className = "",
}: GhostButtonProps) {
  const style: React.CSSProperties = {
    fontFamily: "var(--mono)",
    fontSize: "11px",
    color: active ? "#fff" : "var(--fg2)",
    background: active ? "var(--violet-d)" : "var(--bg3)",
    border: `1px solid ${active ? "var(--violet)" : "var(--bd)"}`,
    borderRadius: "6px",
    padding: "4px 10px",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
  return (
    <button
      style={style}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={className}
    >
      {children}
    </button>
  );
}

// ── SegmentedControl ──────────────────────────────────────────────────────────

export interface SegmentedControlProps {
  options: Array<{ label: string; value: string }>;
  value: string;
  onChange?: (value: string) => void;
  className?: string;
}

/**
 * Tab-style filter control. Wraps `.seg` and its `button` children.
 * Active option gets violet bg; inactive get bg3 hover.
 */
export function SegmentedControl({
  options,
  value,
  onChange,
  className = "",
}: SegmentedControlProps) {
  return (
    <div className={`seg ${className}`.trim()}>
      {options.map((opt) => (
        <button
          key={opt.value}
          className={opt.value === value ? "on" : undefined}
          onClick={() => onChange?.(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── EmptyState ────────────────────────────────────────────────────────────────

export interface EmptyStateProps {
  /** One-sentence description of the empty state. */
  message: string;
  /** CLI command that would populate it — shown in mono. */
  command?: string;
  className?: string;
}

/**
 * Centered dim placeholder shown when a card has no data.
 * Per DESIGN.md: always include a CLI command that would populate it.
 */
export function EmptyState({ message, command, className = "" }: EmptyStateProps) {
  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        padding: "32px 16px",
        color: "var(--fg3)",
        fontSize: "13px",
        textAlign: "center",
      }}
    >
      <span>{message}</span>
      {command && (
        <span style={{ fontFamily: "var(--mono)", fontSize: "11px" }}>
          {command}
        </span>
      )}
    </div>
  );
}

// ── PageHeader ────────────────────────────────────────────────────────────────

export interface PageHeaderProps {
  /** Primary heading. */
  title: string;
  /** Optional subtitle / description. */
  subtitle?: string;
  /** Dot variant beside the title. */
  dot?: "ok" | "warn" | "red" | "live";
  /** Slot for actions placed at the right of the header row. */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Page-level heading row. Wraps `.page-head`, `.page-title`, `.page-sub`.
 * Used at the top of every studio view.
 */
export function PageHeader({
  title,
  subtitle,
  dot,
  actions,
  className = "",
}: PageHeaderProps) {
  return (
    <div className={`page-head ${className}`.trim()}>
      <div>
        <div className="page-title">
          {dot === "live" ? <LiveDot /> : dot && <Dot variant={dot} />}
          {title}
        </div>
        {subtitle && <div className="page-sub">{subtitle}</div>}
      </div>
      {actions && <div>{actions}</div>}
    </div>
  );
}

// ── McpCard ───────────────────────────────────────────────────────────────────

export interface McpCardProps {
  /** Display name of the MCP / skill. */
  name: string;
  /** Short description. */
  description?: string;
  /** Emoji icon or image URL. */
  icon?: string;
  /** Badges shown below the name (e.g. "installed", category). */
  badges?: Array<{ label: string; variant?: "default" | "ok" }>;
  /** Tool names listed in the card footer. */
  tools?: string[];
  /** Install command shown in the card footer. */
  command?: string;
  /** Stats: install count, version, etc. */
  stats?: Array<{ label: string; value: string }>;
  className?: string;
}

/**
 * MCP / skill catalog card. Wraps the `.mc-card` family of classes.
 * Used in the Market, MCPs, and Plugins views.
 */
export function McpCard({
  name,
  description,
  icon,
  badges = [],
  tools = [],
  command,
  stats = [],
  className = "",
}: McpCardProps) {
  const isUrl = icon && (icon.startsWith("http") || icon.startsWith("/"));
  return (
    <div className={`mc-card ${className}`.trim()}>
      <div className="mc-head">
        <div className="mc-emoji">
          {isUrl ? (
            <img
              src={icon}
              width={34}
              height={34}
              className="mc-img"
              alt={name}
            />
          ) : (
            icon ?? "🔧"
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="mc-name">{name}</div>
          {badges.length > 0 && (
            <div className="mc-badges">
              {badges.map((b, i) => (
                <McpBadge key={i} label={b.label} variant={b.variant} />
              ))}
            </div>
          )}
        </div>
      </div>

      {description && <div className="mc-desc">{description}</div>}

      {stats.length > 0 && (
        <div className="mc-stats">
          {stats.map((s, i) => (
            <div key={i} className="mc-stat">
              <div className="n">{s.value}</div>
              <div className="l">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {tools.length > 0 && (
        <>
          <div className="mc-label">TOOLS</div>
          <div className="mc-tools">
            {tools.map((t) => (
              <span key={t} className="mc-tool">
                {t}
                <span className="dt-paren">()</span>
              </span>
            ))}
          </div>
        </>
      )}

      {command && (
        <div className="mc-cmd">
          <span className="prompt">$</span>
          <span className="cmd-txt">{command}</span>
          <span className="mc-copy" style={{ marginLeft: "auto" }}>
            copy
          </span>
        </div>
      )}
    </div>
  );
}

// ── MonoTag ───────────────────────────────────────────────────────────────────

export interface MonoTagProps {
  children: React.ReactNode;
  /** dim = fg3 color; default = cyan */
  variant?: "default" | "dim" | "green" | "amber" | "red";
  className?: string;
}

/**
 * Inline monospace tag — path, PID, version string, CLI command fragment.
 * Used inline in tables and card bodies.
 */
export function MonoTag({ children, variant = "default", className = "" }: MonoTagProps) {
  const colorMap: Record<string, string> = {
    default: "var(--cyan)",
    dim: "var(--fg3)",
    green: "var(--green)",
    amber: "var(--amber)",
    red: "var(--red)",
  };
  return (
    <span
      className={`mono ${className}`.trim()}
      style={{
        color: colorMap[variant],
        background: "var(--bg1)",
        border: "1px solid var(--bd)",
        borderRadius: "5px",
        padding: "1px 7px",
        fontSize: "11.5px",
      }}
    >
      {children}
    </span>
  );
}
