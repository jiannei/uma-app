// src/bubble/format-side-effect.ts — B.4 + A.8: tool-aware classifier。
//
// 把 `toolName + toolInput` 解析成 4 种 renderer 之一的描述结构：
//   - bash  → 命令字符串（mono block）
//   - edit  → file_path + added/removed 行数
//   - write → file_path + 字符数
//   - read  → file_path + offset/limit（无 preview，wire format 没文件内容）
//  退路：json（其他 tool 或 input 为空）。

import { firstStringValue } from "./format-detail";

export type SideEffectRender =
  | { kind: "bash"; command: string }
  | {
      kind: "edit";
      filePath: string;
      addedLines: number;
      removedLines: number;
    }
  | { kind: "write"; filePath: string; charCount: number }
  | {
      kind: "read";
      filePath: string;
      offset?: number;
      limit?: number;
    }
  | { kind: "json"; toolName?: string; raw: unknown };

export function classifySideEffect(
  toolName: string | undefined,
  toolInput: unknown,
): SideEffectRender {
  if (!toolInput || typeof toolInput !== "object") {
    return { kind: "json", toolName, raw: toolInput };
  }
  const input = toolInput as Record<string, unknown>;

  switch (toolName) {
    case "Bash": {
      const command = firstStringValue(input, ["command", "cmd"]);
      if (command) return { kind: "bash", command };
      break;
    }
    case "Edit":
    case "MultiEdit": {
      const path = firstStringValue(input, [
        "file_path",
        "filePath",
        "path",
      ]);
      if (path) {
        const newString = firstStringValue(input, [
          "new_string",
          "newString",
          "content",
        ]);
        const oldString = firstStringValue(input, [
          "old_string",
          "oldString",
        ]);
        return {
          kind: "edit",
          filePath: path,
          addedLines: newString ? newString.split("\n").length : 0,
          removedLines: oldString ? oldString.split("\n").length : 0,
        };
      }
      break;
    }
    case "Write": {
      const path = firstStringValue(input, [
        "file_path",
        "filePath",
        "path",
      ]);
      if (path) {
        const content = firstStringValue(input, ["content"]);
        return {
          kind: "write",
          filePath: path,
          charCount: content.length,
        };
      }
      break;
    }
    case "Read": {
      const path = firstStringValue(input, [
        "file_path",
        "filePath",
        "path",
      ]);
      if (path) {
        const offset =
          typeof input.offset === "number" ? input.offset : undefined;
        const limit =
          typeof input.limit === "number" ? input.limit : undefined;
        return { kind: "read", filePath: path, offset, limit };
      }
      break;
    }
  }

  return { kind: "json", toolName, raw: input };
}
