// src/bubble/lang.ts — shared language state for the bubble webview.
//
// The bubble is a single Tauri webview with one Vue app; SideEffect /
// Elicitation / PlanReview bubble components all render into it
// (mutually exclusive, dispatched by `kind`). They share a single
// reactive `lang` ref so the language setting flip is instant
// across whichever branch is mounted.
//
// Initial value comes from `get_settings` (Rust command); live
// updates come from the `language-change` Tauri event emitted
// by `set_language`. The bubble's webview is created at app
// startup; we init here so the subscription survives across
// permission-request renders.

import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Lang } from "./strings";

const lang = ref<Lang>("en");
let unlisten: UnlistenFn | undefined;
let initPromise: Promise<void> | null = null;

/** Idempotent — call once at the bubble's entry. Subsequent
 * calls return the same promise (so HMR / reloads don't double-
 * subscribe). */
export function initBubbleLang(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (!unlisten) {
      unlisten = await listen<{ language: string }>(
        "language-change",
        (e) => {
          const next = e.payload?.language;
          if (next === "en" || next === "zh") lang.value = next;
        },
      );
    }
    try {
      const settings = await invoke<{ language?: string }>("get_settings");
      const v = settings?.language;
      if (v === "en" || v === "zh") lang.value = v;
    } catch {
      /* fall back to "en" (the default) */
    }
  })();
  return initPromise;
}

/** Read the current bubble language. All bubble components use
 * this; updates from `set_language` propagate via Vue's
 * reactivity without any extra wiring. */
export function useBubbleLang() {
  return lang;
}