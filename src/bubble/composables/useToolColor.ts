// src/bubble/composables/useToolColor.ts — per-tool pill color mapping.
// Maps Claude Code tool names to Tailwind utility classes for the
// pill background, dot indicator, and ring. Unknown / missing tool
// names fall back to a neutral zinc palette.

import type { ToolName } from "@/types/permission";

const TOOL_COLOR_MAP: Record<ToolName, { dotClass: string; pillClass: string }> = {
  Bash: {
    dotClass: "bg-orange-500",
    pillClass: "bg-orange-500/20 text-orange-700 ring-1 ring-inset ring-orange-500/30",
  },
  Edit: {
    dotClass: "bg-emerald-500",
    pillClass: "bg-emerald-500/20 text-emerald-700 ring-1 ring-inset ring-emerald-500/30",
  },
  Write: {
    dotClass: "bg-blue-500",
    pillClass: "bg-blue-500/20 text-blue-700 ring-1 ring-inset ring-blue-500/30",
  },
  Read: {
    dotClass: "bg-zinc-500",
    pillClass: "bg-zinc-500/20 text-zinc-700 ring-1 ring-inset ring-zinc-500/30",
  },
  Glob: {
    dotClass: "bg-violet-500",
    pillClass: "bg-violet-500/20 text-violet-700 ring-1 ring-inset ring-violet-500/30",
  },
  Grep: {
    dotClass: "bg-violet-500",
    pillClass: "bg-violet-500/20 text-violet-700 ring-1 ring-inset ring-violet-500/30",
  },
  Agent: {
    dotClass: "bg-pink-500",
    pillClass: "bg-pink-500/20 text-pink-700 ring-1 ring-inset ring-pink-500/30",
  },
  Shell: {
    dotClass: "bg-yellow-500",
    pillClass: "bg-yellow-500/20 text-yellow-700 ring-1 ring-inset ring-yellow-500/30",
  },
  WebFetch: {
    dotClass: "bg-cyan-500",
    pillClass: "bg-cyan-500/20 text-cyan-700 ring-1 ring-inset ring-cyan-500/30",
  },
  WebSearch: {
    dotClass: "bg-cyan-500",
    pillClass: "bg-cyan-500/20 text-cyan-700 ring-1 ring-inset ring-cyan-500/30",
  },
  NotebookEdit: {
    dotClass: "bg-indigo-500",
    pillClass: "bg-indigo-500/20 text-indigo-700 ring-1 ring-inset ring-indigo-500/30",
  },
};

const FALLBACK = {
  dotClass: "bg-zinc-500",
  pillClass: "bg-zinc-500/20 text-zinc-700 ring-1 ring-inset ring-zinc-500/30",
} as const;

export function useToolColor(toolName: string | undefined): {
  dotClass: string;
  pillClass: string;
} {
  if (!toolName) return { ...FALLBACK };
  // Normalize: capitalize first letter to match ToolName union
  const normalized = toolName.charAt(0).toUpperCase() + toolName.slice(1);
  return TOOL_COLOR_MAP[normalized as ToolName] ?? { ...FALLBACK };
}