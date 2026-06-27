// src/bubble/format-detail.ts — port of uma-pet's
// `src/bubble-format.js`. Picks the most useful one-line summary
// of a `tool_input` payload given the `tool_name`. Used by the
// SideEffect bubble to render the tool input section instead of
// dumping the full JSON.
//
// Strategy:
//   1. If the input has a `description` field, prefer that (Claude
//      Code convention for tool explanations).
//   2. Otherwise pick the canonical field per tool:
//        Bash       → input.command
//        Edit/Write/Read → input.file_path
//        Glob/Grep  → input.pattern
//   3. Fall back to the first non-empty string value in the input.
//   4. Last resort: JSON.stringify.
//
// All paths are truncated to keep the bubble compact.

const DEFAULT_MAX = 200;

/** Return the input truncated to `max` chars, with a trailing `…`
 * when truncated. */
export function truncate(s: string, max = DEFAULT_MAX): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

/** Return the first string-typed value in `input` whose key is in
 * `names`, trimmed. Used for explicit field-name fallbacks
 * (`description`, `file_path`, etc.). */
export function firstStringValue(
  input: Record<string, unknown>,
  names: readonly string[],
): string {
  for (const name of names) {
    const value = input[name];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

/** Walk `input` and return the first non-empty string value, with
 * object values recursed one level deep. */
function firstStringAnywhere(
  input: Record<string, unknown>,
  depth = 0,
): string {
  if (depth > 2) return "";
  for (const value of Object.values(input)) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = firstStringAnywhere(
        value as Record<string, unknown>,
        depth + 1,
      );
      if (nested) return nested;
    }
  }
  return "";
}

/** Pick the most useful one-line summary of a tool_input payload.
 *
 * @param toolName  Canonical Claude Code tool name (Bash, Edit, …).
 *                  undefined / empty falls through to the generic
 *                  fallbacks.
 * @param toolInput The raw `tool_input` value (whatever shape the
 *                  agent sent). Falsy input returns "".
 * @param max       Max chars before truncation (default 200).
 */
export function formatDetail(
  toolName: string | undefined,
  toolInput: unknown,
  max = DEFAULT_MAX,
): string {
  if (!toolInput || typeof toolInput !== "object") return "";

  const input = toolInput as Record<string, unknown>;

  // 1. CC's `description` field (Bash, Edit, etc. all support it).
  const description = firstStringValue(input, [
    "description",
    "Description",
  ]);
  if (description) return truncate(description, max);

  // 2. Canonical per-tool fields.
  switch (toolName) {
    case "Bash": {
      const command = firstStringValue(input, ["command", "cmd"]);
      if (command) return truncate(command, max);
      break;
    }
    case "Edit":
    case "Write":
    case "Read":
    case "MultiEdit": {
      const path = firstStringValue(input, [
        "file_path",
        "filePath",
        "FilePath",
        "path",
        "notebook_path",
      ]);
      if (path) return truncate(path, max);
      break;
    }
    case "Glob": {
      const pattern = firstStringValue(input, ["pattern", "glob_pattern"]);
      if (pattern) return truncate(pattern, max);
      break;
    }
    case "Grep": {
      const pattern = firstStringValue(input, ["pattern", "regex", "query"]);
      if (pattern) return truncate(pattern, max);
      break;
    }
    case "WebFetch": {
      const url = firstStringValue(input, ["url", "URL"]);
      if (url) return truncate(url, max);
      break;
    }
    case "WebSearch": {
      const query = firstStringValue(input, ["query", "Query"]);
      if (query) return truncate(query, max);
      break;
    }
    case "Task": {
      const description = firstStringValue(input, [
        "description",
        "prompt",
        "task",
      ]);
      if (description) return truncate(description, max);
      break;
    }
  }

  // 3. Fall back to the first non-empty string value.
  const firstAnywhere = firstStringAnywhere(input);
  if (firstAnywhere) return truncate(firstAnywhere, max);

  // 4. Last resort: compact JSON.
  try {
    return truncate(JSON.stringify(input), max);
  } catch {
    return "(unserializable input)";
  }
}