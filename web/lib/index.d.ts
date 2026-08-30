/**
 * cue studio — atomic presentational components.
 * All styling comes from src/studio/styles.css; no API hooks here.
 */
import React from "react";
export interface DotProps {
    /** Visual state of the dot. */
    variant?: "ok" | "violet" | "warn" | "red";
    /** Extra CSS class names. */
    className?: string;
}
/** Small status indicator circle. Wraps `.hdot` CSS class. */
export declare function Dot({ variant, className }: DotProps): import("react/jsx-runtime").JSX.Element;
/** Live (pulsing green) indicator dot. Wraps `.live-dot`. */
export declare function LiveDot({ className }: {
    className?: string;
}): import("react/jsx-runtime").JSX.Element;
export interface PillProps {
    /** Label text. */
    label: string;
    /** Optional numeric count shown in a violet badge at the right. */
    count?: number;
    className?: string;
}
/** Pill-shaped label with an optional count chip. Wraps `.pill`. */
export declare function Pill({ label, count, className }: PillProps): import("react/jsx-runtime").JSX.Element;
export interface McpBadgeProps {
    label: string;
    /** ok = green "installed" style */
    variant?: "default" | "ok";
    className?: string;
}
/** Small tag badge for MCP/skill cards. Wraps `.mc-badge`. */
export declare function McpBadge({ label, variant, className }: McpBadgeProps): import("react/jsx-runtime").JSX.Element;
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
export declare function StatTile({ value, label, sub, variant, size, className, }: StatTileProps): import("react/jsx-runtime").JSX.Element;
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
export declare function Band({ heading, tag, tagVariant, icon, children, className, }: BandProps): import("react/jsx-runtime").JSX.Element;
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
export declare function Card({ title, subtitle, dot, actions, children, className, }: CardProps): import("react/jsx-runtime").JSX.Element;
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
export declare function GhostButton({ children, onClick, variant, active, disabled, className, }: GhostButtonProps): import("react/jsx-runtime").JSX.Element;
export interface SegmentedControlProps {
    options: Array<{
        label: string;
        value: string;
    }>;
    value: string;
    onChange?: (value: string) => void;
    className?: string;
}
/**
 * Tab-style filter control. Wraps `.seg` and its `button` children.
 * Active option gets violet bg; inactive get bg3 hover.
 */
export declare function SegmentedControl({ options, value, onChange, className, }: SegmentedControlProps): import("react/jsx-runtime").JSX.Element;
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
export declare function EmptyState({ message, command, className }: EmptyStateProps): import("react/jsx-runtime").JSX.Element;
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
export declare function PageHeader({ title, subtitle, dot, actions, className, }: PageHeaderProps): import("react/jsx-runtime").JSX.Element;
export interface McpCardProps {
    /** Display name of the MCP / skill. */
    name: string;
    /** Short description. */
    description?: string;
    /** Emoji icon or image URL. */
    icon?: string;
    /** Badges shown below the name (e.g. "installed", category). */
    badges?: Array<{
        label: string;
        variant?: "default" | "ok";
    }>;
    /** Tool names listed in the card footer. */
    tools?: string[];
    /** Install command shown in the card footer. */
    command?: string;
    /** Stats: install count, version, etc. */
    stats?: Array<{
        label: string;
        value: string;
    }>;
    className?: string;
}
/**
 * MCP / skill catalog card. Wraps the `.mc-card` family of classes.
 * Used in the Market, MCPs, and Plugins views.
 */
export declare function McpCard({ name, description, icon, badges, tools, command, stats, className, }: McpCardProps): import("react/jsx-runtime").JSX.Element;
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
export declare function MonoTag({ children, variant, className }: MonoTagProps): import("react/jsx-runtime").JSX.Element;
