// src/bubble/agent-icons.ts — A.7: 每个 agent 一个 Lucide icon (preset-icons).
//
// 未来加 agent 时在这里加一行。
// 已知：`claude-code` (Anthropic) → Sparkles；`cursor` → MousePointer2。
// 未知 → Cpu（generic fallback）。
//
// PR-3: returns UnoCSS preset-icons class string instead of Vue component,
// so consumer just does `<div :class="agentIcon(agent)" />` (no
// `<component :is="...">` indirection).

const AGENT_ICONS: Record<string, string> = {
  "claude-code": "i-lucide-sparkles",
  cursor: "i-lucide-mouse-pointer-2",
};

const FALLBACK_ICON = "i-lucide-cpu";

export function agentIcon(agent: string): string {
  return AGENT_ICONS[agent] ?? FALLBACK_ICON;
}
