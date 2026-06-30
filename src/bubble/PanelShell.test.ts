// src/bubble/PanelShell.test.ts — Component snapshot test
// (ADR-0018 Stage B PR3 wiring-level smoke).
//
// Mounts PanelShell with each kind and snapshots the rendered HTML.
// The two template branches (Elicitation → AskPanelContent,
// PlanReview → PlanPanelContent) stay because they render different
// sub-components, but the per-kind casts are gone and the focus
// decision flows through `permissionRegistry[kind].presentation.focusKey`.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import PanelShell from "./PanelShell.vue";
import type {
  ElicitationRequest,
  PlanReviewRequest,
} from "../types/permission";

const elicitationReq: ElicitationRequest = {
  kind: "Elicitation",
  requestId: "perm-300",
  sessionId: "s-1",
  agent: "claude-code",
  agentDisplayName: "Claude Code",
  toolName: "AskUserQuestion",
  questions: [
    {
      question: "Which test runner?",
      header: "Tests",
      multiSelect: false,
      options: [
        { label: "Vitest", description: "ESM-native" },
        { label: "Jest", description: "Default" },
      ],
    },
  ],
};

const planReviewReq: PlanReviewRequest = {
  kind: "PlanReview",
  requestId: "perm-301",
  sessionId: "s-1",
  agent: "claude-code",
  agentDisplayName: "Claude Code",
  toolName: "ExitPlanMode",
  planContent: "## Refactor auth\n1. Extract middleware",
};

describe("PanelShell", () => {
  it("Elicitation: renders AskPanelContent", () => {
    const wrapper = mount(PanelShell, { props: { request: elicitationReq } });
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("PlanReview: renders PlanPanelContent", () => {
    const wrapper = mount(PanelShell, { props: { request: planReviewReq } });
    expect(wrapper.html()).toMatchSnapshot();
  });
});