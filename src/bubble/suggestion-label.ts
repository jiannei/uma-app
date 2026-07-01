// src/bubble/suggestion-label.ts — renders a one-line human label for a
// Claude Code `permission_suggestions[]` entry. Each entry is a
// `PermissionUpdateEntry` discriminated union (addRules / setMode
// / etc.); we surface the operation in user-facing language and
// substitute placeholders in the strings table.

import type { PermissionUpdateEntry } from "../types/permission";

/** Type for vue-i18n's t function */
type TranslateFn = (key: string, vars?: Record<string, unknown>) => string;

/** A shortened rule for `Always allow `<rule>`` display. We truncate
 * to 30 chars so very long rules don't blow up the bubble. */
function shortRule(ruleContent: string): string {
  return ruleContent.length > 30
    ? ruleContent.slice(0, 29) + "…"
    : ruleContent;
}

/** First rule in `rules` (or empty for entries with no rules). */
function firstRule(
  entry: Extract<PermissionUpdateEntry, { rules: unknown }>,
): { toolName?: string; ruleContent?: string } {
  const fromRules = Array.isArray(entry.rules) ? entry.rules[0] : undefined;
  return fromRules ?? {};
}

/** Render the human label for a CC `permission_suggestions`
 * entry. Caller passes the `t` function from useI18n(). */
export function suggestionLabel(
  entry: PermissionUpdateEntry,
  t: TranslateFn,
): string {
  switch (entry.type) {
    case "setMode": {
      if (entry.mode === "acceptEdits")
        return t("bubble.autoAcceptEdits");
      if (entry.mode === "plan") return t("bubble.switchToPlanMode");
      return t("bubble.setMode", { mode: entry.mode });
    }
    case "addRules":
    case "replaceRules":
    case "removeRules": {
      const rule = firstRule(entry);
      const tool = rule.toolName ?? "";
      const deny = entry.behavior === "deny";
      if (rule.ruleContent) {
        // Always show the full ruleContent (truncated if very long) —
        // the "allow in <dir>" truncation was confusing users because
        // the regex match ate command flags. Tradeoff: less compact
        // for glob patterns, but accurate to what CC is actually
        // allowing.
        return deny
          ? t("bubble.alwaysAllowDeny", { tool })
          : t("bubble.alwaysAllowRule", { rule: shortRule(rule.ruleContent) });
      }
      return deny
        ? t("bubble.alwaysAllowDeny", { tool })
        : t("bubble.alwaysAllow", { tool });
    }
    case "addDirectories":
      return t("bubble.addAllowedDirectories");
    case "removeDirectories":
      return t("bubble.removeAllowedDirs");
    default:
      return t("bubble.applySuggestion");
  }
}