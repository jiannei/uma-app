// src/bubble/suggestion-label.ts — port of uma-pet's
// `getSuggestionLabel`. Renders a one-line human label for a
// Claude Code `permission_suggestions[]` entry. Each entry is a
// `PermissionUpdateEntry` discriminated union (addRules / setMode
// / etc.); we surface the operation in user-facing language and
// substitute placeholders in the strings table.

import type { PermissionUpdateEntry } from "../types/permission";
import { bubbleText, type Lang } from "./strings";

const DEFAULT_LANG: Lang = "en";

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

/** A shortened rule for `Always allow `<rule>`` display. Per
 * uma-pet, we truncate to 30 chars; we only do this when
 * `extractDir` doesn't recognise the rule as a directory
 * pattern. */
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
 * entry. */
export function suggestionLabel(
  entry: PermissionUpdateEntry,
  lang: Lang = DEFAULT_LANG,
): string {
  switch (entry.type) {
    case "setMode": {
      if (entry.mode === "acceptEdits")
        return bubbleText(lang, "autoAcceptEdits");
      if (entry.mode === "plan") return bubbleText(lang, "switchToPlanMode");
      return bubbleText(lang, "setMode", { mode: entry.mode });
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
            ? bubbleText(lang, "alwaysAllowDenyInDir", { tool, dir })
            : bubbleText(lang, "allowInDir", { tool, dir });
        }
        return deny
          ? bubbleText(lang, "alwaysAllowDeny", { tool })
          : bubbleText(lang, "alwaysAllowRule", { rule: shortRule(rule.ruleContent) });
      }
      return deny
        ? bubbleText(lang, "alwaysAllowDeny", { tool })
        : bubbleText(lang, "alwaysAllow", { tool });
    }
    case "addDirectories":
      return bubbleText(lang, "addAllowedDirectories");
    case "removeDirectories":
      return bubbleText(lang, "removeAllowedDirs");
    default:
      return bubbleText(lang, "applySuggestion");
  }
}