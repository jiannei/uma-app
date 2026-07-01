// src/bubble/UnifiedBubbleCard.test.ts — snapshot + unit tests for the
// unified permission bubble card (ADR-0018 Stage B + bubble-display-design
// spec 方案 B). Covers the three kind branches and the per-kind footer
// layout.
//
// Test patterns (mirrors the deleted PillShell / PanelShell / ToolPill
// test style):
//   - `mount(Component, { props, global: { plugins } })` from
//     `@vue/test-utils`, with `createTestingI18n("en")` for t() calls.
//   - Snapshot assertions for structure, targeted assertions for
//     per-kind behavior.
//
// Note: UnifiedBubbleCard itself doesn't call Tauri APIs (invoke /
// listen / useResizeObserver) — that lives in BubbleShellRoot. So we
// don't need to stub Tauri or vueuse here; just i18n.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { createTestingI18n } from "@/i18n/testing";
import type {
  ElicitationRequest,
  PlanReviewRequest,
  PermissionUpdateEntry,
  SideEffectRequest,
} from "@/types/permission";
import UnifiedBubbleCard from "./UnifiedBubbleCard.vue";
import ElicitationBody from "./ElicitationBody.vue";

// ── Fixtures ──

const makeSideEffect = (
  overrides: Partial<SideEffectRequest> = {},
): SideEffectRequest => ({
  kind: "SideEffect",
  requestId: "r-side",
  sessionId: "s-12345678-90ab",
  agent: "claude-code",
  agentDisplayName: "Claude Code",
  toolName: "Bash",
  toolInput: { command: "rm -rf /tmp/foo" },
  permissionSuggestions: [],
  ...overrides,
});

const makeElicitation = (
  overrides: Partial<ElicitationRequest> = {},
): ElicitationRequest => ({
  kind: "Elicitation",
  requestId: "r-elicit",
  sessionId: "s-12345678-90ab",
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
    {
      question: "Set up migrations?",
      header: "Migrations",
      multiSelect: false,
      options: [
        { label: "Yes" },
        { label: "No" },
      ],
    },
  ],
  ...overrides,
});

const makePlanReview = (
  overrides: Partial<PlanReviewRequest> = {},
): PlanReviewRequest => ({
  kind: "PlanReview",
  requestId: "r-plan",
  sessionId: "s-12345678-90ab",
  agent: "claude-code",
  agentDisplayName: "Claude Code",
  toolName: "ExitPlanMode",
  planContent: "## Refactor auth\n1. Extract middleware\n2. Wire routes",
  ...overrides,
});

const i18n = createTestingI18n("en");

// ── Snapshots ──

describe("UnifiedBubbleCard snapshots", () => {
  it("bash sideeffect renders unified card", () => {
    const wrapper = mount(UnifiedBubbleCard, {
      props: { request: makeSideEffect() },
      global: { plugins: [i18n] },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("elicitation 2 questions renders unified card", () => {
    const wrapper = mount(UnifiedBubbleCard, {
      props: { request: makeElicitation() },
      global: { plugins: [i18n] },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });

  it("planreview renders unified card", () => {
    const wrapper = mount(UnifiedBubbleCard, {
      props: { request: makePlanReview() },
      global: { plugins: [i18n] },
    });
    expect(wrapper.html()).toMatchSnapshot();
  });
});

// ── Per-kind footer layout ──

describe("UnifiedBubbleCard footer layout", () => {
  it("sideeffect footer has [Allow] and [Deny] buttons (primary first)", () => {
    const wrapper = mount(UnifiedBubbleCard, {
      props: { request: makeSideEffect() },
      global: { plugins: [i18n] },
    });
    const buttons = wrapper.findAll(".footer .btn");
    expect(buttons.length).toBe(2);
    // Primary action first (uma-pet convention), Allow button uses
    // tool-pill color (verified by inline style, not class)
    expect(buttons[0].classes()).toContain("btn-allow");
    expect(buttons[0].text()).toContain("Allow");
    expect(buttons[0].attributes("style")).toContain("#d97757");
    expect(buttons[1].classes()).toContain("btn-deny");
    expect(buttons[1].text()).toContain("Deny");
  });

  it("elicitation footer shows Previous disabled on first Q", () => {
    const wrapper = mount(UnifiedBubbleCard, {
      props: { request: makeElicitation() },
      global: { plugins: [i18n] },
    });
    const buttons = wrapper.findAll(".footer .btn");
    expect(buttons.length).toBe(2);
    // Previous is disabled on first Q (strict gate: can't go back further)
    expect(buttons[0].attributes("disabled")).toBeDefined();
    expect(buttons[0].text()).toContain("Previous");
  });

  it("elicitation footer shows Submit Answer on last Q (when all answered)", async () => {
    const wrapper = mount(UnifiedBubbleCard, {
      props: {
        request: makeElicitation(),
        // Pre-filled answers to enable Submit
      },
      global: { plugins: [i18n] },
    });
    // Navigate to last question
    await wrapper.setData({ elicitActiveIndex: 1 });
    const buttons = wrapper.findAll(".footer .btn");
    expect(buttons[1].text()).toContain("Submit");
  });

  it("planreview footer has only [Approve] button (no Deny)", () => {
    const wrapper = mount(UnifiedBubbleCard, {
      props: { request: makePlanReview() },
      global: { plugins: [i18n] },
    });
    const buttons = wrapper.findAll(".footer .btn");
    expect(buttons.length).toBe(1);
    expect(buttons[0].classes()).toContain("btn-allow");
    expect(buttons[0].text()).toContain("Approve");
    // Deny button should not exist
    expect(wrapper.find(".footer .btn-deny").exists()).toBe(false);
  });
});

// ── Emit behavior ──

describe("UnifiedBubbleCard emits", () => {
  it("sideeffect click Allow emits allow with no payload", async () => {
    const wrapper = mount(UnifiedBubbleCard, {
      props: { request: makeSideEffect() },
      global: { plugins: [i18n] },
    });
    await wrapper.find(".footer .btn-allow").trigger("click");
    expect(wrapper.emitted("allow")).toBeTruthy();
    // Plain Allow once: emit("allow") with no args → args array is empty
    const allowEmit = wrapper.emitted("allow")!;
    expect(allowEmit.length).toBe(1);
    expect(allowEmit[0].length).toBe(0);
  });

  it("sideeffect click Deny emits deny with no message", async () => {
    const wrapper = mount(UnifiedBubbleCard, {
      props: { request: makeSideEffect() },
      global: { plugins: [i18n] },
    });
    await wrapper.find(".footer .btn-deny").trigger("click");
    expect(wrapper.emitted("deny")).toBeTruthy();
    const denyEmit = wrapper.emitted("deny")!;
    expect(denyEmit.length).toBe(1);
    expect(denyEmit[0][0]).toBeUndefined();
  });

  it("planreview click Approve emits allow", async () => {
    const wrapper = mount(UnifiedBubbleCard, {
      props: { request: makePlanReview() },
      global: { plugins: [i18n] },
    });
    await wrapper.find(".footer .btn-allow").trigger("click");
    expect(wrapper.emitted("allow")).toBeTruthy();
  });

  it("planreview feedback flow: input → enable submit → click → emit deny with message", async () => {
    const wrapper = mount(UnifiedBubbleCard, {
      props: { request: makePlanReview() },
      global: { plugins: [i18n] },
    });
    // Click "Tell Claude what to change" suggestion to open feedback form
    const feedbackTrigger = wrapper.findAll(".btn-suggestion")[0];
    await feedbackTrigger.trigger("click");
    expect(wrapper.find(".plan-feedback-form").exists()).toBe(true);
    // Submit button should be disabled until feedback is typed
    const submitBtn = wrapper.find(".plan-feedback-actions .btn-allow");
    expect(submitBtn.attributes("disabled")).toBeDefined();
    // Type feedback → submit enabled
    await wrapper.find(".plan-feedback-textarea").setValue("use a migration tool");
    expect(submitBtn.attributes("disabled")).toBeUndefined();
    // Click Send → emit deny with feedback as message
    await submitBtn.trigger("click");
    expect(wrapper.emitted("deny")).toBeTruthy();
    expect(wrapper.emitted("deny")![0][0]).toBe("use a migration tool");
  });

  it("elicitation auto-injects Other option for every question", () => {
    const wrapper = mount(UnifiedBubbleCard, {
      props: { request: makeElicitation() },
      global: { plugins: [i18n] },
    });
    // Other is a preset-injected radio alongside the agent-supplied options
    const otherInput = wrapper.find('input[data-other="true"]');
    expect(otherInput.exists()).toBe(true);
    // Label contains the localized "Other" string
    const labels = wrapper.findAll(".option-item-label");
    const otherLabel = labels.find((l) => l.text().includes("Other"));
    expect(otherLabel).toBeTruthy();
  });

  it("elicitation answered question shows as summary button when navigated away", async () => {
    const wrapper = mount(UnifiedBubbleCard, {
      props: { request: makeElicitation() },
      global: { plugins: [i18n] },
    });
    // Answer first question
    const firstOption = wrapper.find('input[name="elicitation-0"]:not([data-other])');
    await firstOption.trigger("change");
    // Navigate to second question
    await wrapper.setData({ elicitActiveIndex: 1 });
    // First question should now appear as a summary button
    const summaries = wrapper.findAll(".question-summary");
    expect(summaries.length).toBe(1);
    // Click summary → emits update:activeIndex on the ElicitationBody sub-component
    await summaries[0].trigger("click");
    const elicitationBody = wrapper.findComponent(ElicitationBody);
    expect(elicitationBody.emitted("update:activeIndex")).toBeTruthy();
    expect(elicitationBody.emitted("update:activeIndex")![0][0]).toBe(0);
  });
});

// ── Visual affordances ──

describe("UnifiedBubbleCard visual", () => {
  it("session tag shows shortId (#first 8 chars)", () => {
    const wrapper = mount(UnifiedBubbleCard, {
      props: { request: makeSideEffect() },
      global: { plugins: [i18n] },
    });
    const tag = wrapper.find(".session-tag");
    expect(tag.exists()).toBe(true);
    expect(tag.text()).toBe("#s-123456");
  });

  it("tool pill uses saturated hex color from useToolColor", () => {
    const wrapper = mount(UnifiedBubbleCard, {
      props: { request: makeSideEffect({ toolName: "Bash" }) },
      global: { plugins: [i18n] },
    });
    const pill = wrapper.find(".tool-pill");
    expect(pill.exists()).toBe(true);
    expect(pill.attributes("data-tool")).toBe("Bash");
    expect(pill.attributes("style")).toContain("#d97757");
  });

  it("tool pill hidden for Elicitation / PlanReview (header shows only title)", () => {
    const elicit = mount(UnifiedBubbleCard, {
      props: { request: makeElicitation() },
      global: { plugins: [i18n] },
    });
    expect(elicit.find(".tool-pill").exists()).toBe(false);

    const plan = mount(UnifiedBubbleCard, {
      props: { request: makePlanReview() },
      global: { plugins: [i18n] },
    });
    expect(plan.find(".tool-pill").exists()).toBe(false);
  });

  it("sideeffect suggestion click emits allow with updatedPermissions", async () => {
    const rule: PermissionUpdateEntry = {
      type: "addRules",
      rules: [{ toolName: "Bash", ruleContent: "rm -rf /tmp/*" }],
      behavior: "allow",
      destination: "session",
    };
    const wrapper = mount(UnifiedBubbleCard, {
      props: {
        request: makeSideEffect({ permissionSuggestions: [rule] }),
      },
      global: { plugins: [i18n] },
    });
    const suggestions = wrapper.findAll(".btn-suggestion");
    expect(suggestions.length).toBe(1);
    await suggestions[0].trigger("click");
    const emitted = wrapper.emitted("allow")!;
    expect(emitted.length).toBe(1);
    const payload = emitted[0][0] as { updatedPermissions: PermissionUpdateEntry[] };
    expect(payload.updatedPermissions).toEqual([rule]);
  });
});