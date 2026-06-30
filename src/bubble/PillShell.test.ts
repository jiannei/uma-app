// src/bubble/PillShell.test.ts — Component snapshot test (ADR-0018
// Stage B PR1 wiring-level smoke).
//
// Mounts PillShell with a SideEffectRequest and snapshots the rendered
// HTML. The snapshot pins:
//   - the compact summary line (registry.presentation.summary)
//   - the expanded title text (registry.presentation.title)
//   - the allow / deny compact action buttons
//
// Three render-kinds are covered so a future regression in the
// SideEffect presentation pipeline surfaces as a snapshot diff.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import PillShell from "./PillShell.vue";
import type { SideEffectRequest } from "../types/permission";

function makeRequest(
  overrides: Partial<SideEffectRequest> = {},
): SideEffectRequest {
  return {
    kind: "SideEffect",
    requestId: "perm-100",
    sessionId: "s-1",
    agent: "claude-code",
    agentDisplayName: "Claude Code",
    toolName: "Bash",
    toolInput: { command: "ls" },
    permissionSuggestions: [],
    ...overrides,
  };
}

describe("PillShell", () => {
  it("bash: summary is the command, title is the toolName", () => {
    const wrapper = mount(PillShell, {
      props: {
        request: makeRequest({
          toolName: "Bash",
          toolInput: { command: "rm -rf /tmp/foo" },
        }),
      },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("edit: summary is the filePath, title is the toolName", () => {
    const wrapper = mount(PillShell, {
      props: {
        request: makeRequest({
          toolName: "Edit",
          toolInput: {
            file_path: "src/foo.ts",
            new_string: "new",
            old_string: "old",
          },
        }),
      },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("json (unknown tool): summary falls back to toolName or 'Tool call'", () => {
    const wrapper = mount(PillShell, {
      props: {
        request: makeRequest({
          toolName: "WebFetch",
          toolInput: { url: "https://example.com" },
        }),
      },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });
});