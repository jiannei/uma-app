import { describe, it, expect } from "vitest";
import {
  getBubblePolicy,
  clampSeconds,
  MAX_AUTO_CLOSE_SECONDS,
  type BubblePolicySnapshot,
} from "./bubble-policy";

const baseSnapshot: BubblePolicySnapshot = {
  bubblePermissionAutoCloseSeconds: 0,
  bubbleNotificationAutoCloseSeconds: 6,
  bubbleUpdateAutoCloseSeconds: 9,
};

describe("clampSeconds", () => {
  it("returns 0 for negative or NaN", () => {
    expect(clampSeconds(-1)).toBe(0);
    expect(clampSeconds(NaN)).toBe(0);
    expect(clampSeconds(Infinity)).toBe(0);
  });
  it("caps at MAX_AUTO_CLOSE_SECONDS", () => {
    expect(clampSeconds(99999)).toBe(MAX_AUTO_CLOSE_SECONDS);
  });
  it("passes through valid values", () => {
    expect(clampSeconds(30)).toBe(30);
  });
});

describe("getBubblePolicy", () => {
  it("permission default is disabled (autoCloseMs === 0)", () => {
    const p = getBubblePolicy(baseSnapshot, "SideEffect");
    expect(p.enabled).toBe(false);
    expect(p.autoCloseMs).toBe(0);
  });

  it("notification default is 6 seconds", () => {
    const p = getBubblePolicy(baseSnapshot, "notification");
    expect(p.enabled).toBe(true);
    expect(p.autoCloseMs).toBe(6000);
  });

  it("update default is 9 seconds", () => {
    const p = getBubblePolicy(baseSnapshot, "update");
    expect(p.enabled).toBe(true);
    expect(p.autoCloseMs).toBe(9000);
  });

  it("applies permission seconds to all permission kinds", () => {
    const snap = { ...baseSnapshot, bubblePermissionAutoCloseSeconds: 30 };
    expect(getBubblePolicy(snap, "SideEffect").autoCloseMs).toBe(30000);
    expect(getBubblePolicy(snap, "Elicitation").autoCloseMs).toBe(30000);
    expect(getBubblePolicy(snap, "PlanReview").autoCloseMs).toBe(30000);
  });

  it("clamps values above MAX_AUTO_CLOSE_SECONDS", () => {
    const p = getBubblePolicy(
      { ...baseSnapshot, bubblePermissionAutoCloseSeconds: 99999 },
      "SideEffect",
    );
    expect(p.autoCloseMs).toBe(MAX_AUTO_CLOSE_SECONDS * 1000);
  });
});