// src/devtools/panels/StoresPanel.test.ts — Component snapshot test
// (ADR-0018 Stage B PR1 wiring-level smoke).
//
// Mounts StoresPanel with one PendingEntryView per kind (SideEffect,
// Elicitation, PlanReview) and snapshots the rendered HTML. The
// snapshot pins:
//   - the badge variant mapping (registry.badgeVariant → Badge prop)
//   - the per-kind detail string (registry.presentation.detail)
//   - the overall row layout
//
// Future drift in the consumer template surfaces as a snapshot diff.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import StoresPanel from "./StoresPanel.vue";
import type { PermissionRequest } from "../../types/permission";

const baseEntry = {
  requestId: "perm-001",
  agentId: "claude-code",
};

const sideEffectReq: PermissionRequest = {
  kind: "SideEffect",
  requestId: "perm-001",
  sessionId: "s-1",
  agent: "claude-code",
  agentDisplayName: "Claude Code",
  toolName: "Bash",
  toolInput: { command: "ls -la" },
  permissionSuggestions: [],
};

const elicitationReq: PermissionRequest = {
  kind: "Elicitation",
  requestId: "perm-002",
  sessionId: "s-1",
  agent: "claude-code",
  agentDisplayName: "Claude Code",
  toolName: "AskUserQuestion",
  questions: [
    {
      question: "Which test runner?",
      header: "Tests",
      multiSelect: false,
      options: [{ label: "Vitest" }, { label: "Jest" }],
    },
  ],
};

const planReviewReq: PermissionRequest = {
  kind: "PlanReview",
  requestId: "perm-003",
  sessionId: "s-1",
  agent: "claude-code",
  agentDisplayName: "Claude Code",
  toolName: "ExitPlanMode",
  planContent: "## Refactor auth\n1. Extract middleware",
};

describe("StoresPanel", () => {
  it("renders three pending entries (one per kind)", () => {
    const wrapper = mount(StoresPanel, {
      props: {
        pending: [
          { ...baseEntry, request: sideEffectReq },
          { ...baseEntry, requestId: "perm-002", request: elicitationReq },
          { ...baseEntry, requestId: "perm-003", request: planReviewReq },
        ],
      },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("renders the empty state when no pending requests", () => {
    const wrapper = mount(StoresPanel, { props: { pending: [] } });
    expect(wrapper.html()).toMatchSnapshot();
  });
});