// src/bubble/ToolPillContent.test.ts — Component snapshot test
// (ADR-0018 Stage B PR1 wiring-level smoke).
//
// Mounts ToolPillContent with a SideEffectRequest and snapshots the
// rendered HTML. The snapshot pins:
//   - the COMMAND preview (registry.presentation.content)
//   - the Allow-once + Deny buttons
//   - the suggestion buttons (one per permission_suggestions entry)
//
// bash + edit + json render kinds are covered so a future regression
// in the SideEffect presentation pipeline surfaces as a snapshot diff.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import ToolPillContent from "./ToolPillContent.vue";
import type {
  PermissionUpdateEntry,
  SideEffectRequest,
} from "../types/permission";
import { createTestingI18n } from "@/i18n/testing";

function makeRequest(
  overrides: Partial<SideEffectRequest> = {},
): SideEffectRequest {
  return {
    kind: "SideEffect",
    requestId: "perm-200",
    sessionId: "s-1",
    agent: "claude-code",
    agentDisplayName: "Claude Code",
    toolName: "Bash",
    toolInput: { command: "ls" },
    permissionSuggestions: [],
    ...overrides,
  };
}

const suggestion: PermissionUpdateEntry = {
  type: "addRules",
  rules: [{ toolName: "Bash", ruleContent: "rm -rf" }],
  behavior: "allow",
  destination: "session",
};

describe("ToolPillContent", () => {
  it("bash: preview is the command, with one suggestion button", () => {
    const wrapper = mount(ToolPillContent, {
      props: {
        request: makeRequest({
          toolName: "Bash",
          toolInput: { command: "ls -la" },
          permissionSuggestions: [suggestion],
        }),
      },
      global: {
        plugins: [createTestingI18n("en")],
      },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("edit: preview is the filePath", () => {
    const wrapper = mount(ToolPillContent, {
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
      global: {
        plugins: [createTestingI18n("en")],
      },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("json: preview is pretty-printed raw input", () => {
    const wrapper = mount(ToolPillContent, {
      props: {
        request: makeRequest({
          toolName: "WebFetch",
          toolInput: { url: "https://example.com" },
        }),
      },
      global: {
        plugins: [createTestingI18n("en")],
      },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });
});