// src/bubble/suggestion-label.ts — renders a one-line human label for a
// Claude Code `permission_suggestions[]` entry. Each entry is a
// `PermissionUpdateEntry` discriminated union (addRules / setMode
// / etc.); we surface the operation in user-facing language and
// substitute placeholders in the strings table.

import type { PermissionUpdateEntry } from "../types/permission";

/** Type for vue-i18n's t function */
type TranslateFn = (key: string, vars?: Record<string, unknown>) => string;

/** Detect a directory-shaped ruleContent and extract the
 * human-friendly directory name. CC encodes "Bash in /foo/"
 * patterns as "<dir>/**" — we take the last path segment. */
function extractDir(ruleContent: string | undefined): string | null {
  if (!ruleContent) return null;
  const m = ruleContent.match(/^([^/*]+)/);
  if (!m) return null;
  const head = m[1].replace(/[\\/]$/, "");
  const segments = head.split(/[\\/]/).filter(Boolean);
  return segments.length ? segments[segments.length - 1] : null;
}

/** A shortened rule for `Always allow `<rule>`` display. We truncate
 * to 30 chars; we only do this when `extractDir` doesn't recognise
 * the rule as a directory pattern. */
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
        const dir = extractDir(rule.ruleContent);
        if (dir) {
          return deny
            ? t("bubble.alwaysAllowDenyInDir", { tool, dir })
            : t("bubble.allowInDir", { tool, dir });
        }
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