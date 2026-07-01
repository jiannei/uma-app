// src/permission/bubble-policy.ts — per-kind autoClose policy.
//
// Pure-function source of truth for "should this kind of bubble auto-close
// after N seconds if the user does nothing?" The settings.json carries
// per-kind seconds; BubbleShellRoot reads the policy via this module and
// arms a VueUse `useTimeoutFn` to dismiss.
//
// The Rust 5-minute timeout remains the absolute safety net; per-kind
// autoClose is a UX nicety that fires earlier if the user opts in.

import { computed, type ComputedRef } from "vue";
import { useStorage } from "@vueuse/core";
import type { PermissionKind } from "@/types/permission";

export type BubbleKind = PermissionKind | "notification" | "update";

export interface BubblePolicy {
  enabled: boolean;
  autoCloseMs: number;
}

export interface BubblePolicySnapshot {
  bubblePermissionAutoCloseSeconds: number;
  bubbleNotificationAutoCloseSeconds: number;
  bubbleUpdateAutoCloseSeconds: number;
}

export const MAX_AUTO_CLOSE_SECONDS = 3600;

export function clampSeconds(s: number): number {
  if (!Number.isFinite(s) || s < 0) return 0;
  return Math.min(s, MAX_AUTO_CLOSE_SECONDS);
}

/**
 * Pure function: derive a per-kind BubblePolicy from a settings snapshot.
 * Exposed via __test for unit testing.
 */
export function getBubblePolicy(
  snapshot: Partial<BubblePolicySnapshot>,
  kind: BubbleKind,
): BubblePolicy {
  let seconds: number;
  switch (kind) {
    case "SideEffect":
    case "Elicitation":
    case "PlanReview":
      seconds = clampSeconds(snapshot.bubblePermissionAutoCloseSeconds ?? 0);
      break;
    case "notification":
      seconds = clampSeconds(snapshot.bubbleNotificationAutoCloseSeconds ?? 6);
      break;
    case "update":
      seconds = clampSeconds(snapshot.bubbleUpdateAutoCloseSeconds ?? 9);
      break;
  }
  return {
    enabled: seconds > 0,
    autoCloseMs: seconds * 1000,
  };
}

/**
 * Reactive composable: reads autoClose policy from settings.json via
 * useStorage. Updates whenever the storage value changes.
 */
export function useBubblePolicy(kind: BubbleKind): ComputedRef<BubblePolicy> {
  const permissionAutoClose = useStorage("bubble.permissionAutoCloseSeconds", 0);
  const notificationAutoClose = useStorage("bubble.notificationAutoCloseSeconds", 6);
  const updateAutoClose = useStorage("bubble.updateAutoCloseSeconds", 9);

  return computed(() =>
    getBubblePolicy(
      {
        bubblePermissionAutoCloseSeconds: permissionAutoClose.value,
        bubbleNotificationAutoCloseSeconds: notificationAutoClose.value,
        bubbleUpdateAutoCloseSeconds: updateAutoClose.value,
      },
      kind,
    ),
  );
}