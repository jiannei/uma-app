// src/bubble/composables/useToolColor.ts — per-tool color mapping.
//
// `pillHex` is the saturated background color used by the header tool pill
// in UnifiedBubbleCard, aligned with uma-pet's bubble.css:150-159 palette
// so the two projects read identically at a glance.
//
// `dotClass` is a Tailwind utility class kept for any caller that wants a
// small filled dot; it tracks pillHex visually (same hue family) but is
// not hex-identical — Tailwind's blue-500 (#3b82f6) and uma-pet's Edit
// blue (#5b8dd9) are deliberately distinct to avoid pinning the palette
// twice.
//
// Unknown / missing tool names fall back to a neutral zinc.

import type { ToolName } from "@/types/permission";

const TOOL_COLOR_MAP: Record<
  ToolName,
  { pillHex: string; dotClass: string }
> = {
  Bash: { pillHex: "#d97757", dotClass: "bg-orange-500" },
  Shell: { pillHex: "#d97757", dotClass: "bg-orange-500" },
  Edit: { pillHex: "#5b8dd9", dotClass: "bg-blue-500" },
  Write: { pillHex: "#8b7ec7", dotClass: "bg-violet-500" },
  NotebookEdit: { pillHex: "#8b7ec7", dotClass: "bg-violet-500" },
  Read: { pillHex: "#5a9e6f", dotClass: "bg-emerald-500" },
  Glob: { pillHex: "#5a9eab", dotClass: "bg-cyan-500" },
  Grep: { pillHex: "#5a9eab", dotClass: "bg-cyan-500" },
  Agent: { pillHex: "#c47a9a", dotClass: "bg-pink-500" },
  WebFetch: { pillHex: "#3b82f6", dotClass: "bg-sky-500" },
  WebSearch: { pillHex: "#3b82f6", dotClass: "bg-sky-500" },
};

const FALLBACK = { pillHex: "#52525b", dotClass: "bg-zinc-500" } as const;

export function useToolColor(toolName: string | undefined): {
  pillHex: string;
  dotClass: string;
} {
  if (!toolName) return { ...FALLBACK };
  // Normalize: capitalize first letter to match ToolName union
  const normalized = toolName.charAt(0).toUpperCase() + toolName.slice(1);
  return TOOL_COLOR_MAP[normalized as ToolName] ?? { ...FALLBACK };
}