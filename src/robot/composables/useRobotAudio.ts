// src/robot/composables/useRobotAudio.ts — Owns the audio cache +
// throttled sound playback + DND pause integration.
//
// What lives here:
//   - The `audioCache` (Map<name, HTMLAudioElement>)
//   - The throttled `playSound(name)` helper (10s cooldown via
//     `useThrottleFn` from @vueuse/core)
//   - A `watch(settings.value.dnd)` that pauses all in-flight audio
//     when DND flips to true (ADR-0006 §Context point 5: DND does
//     NOT suppress state transitions, but it does pause sounds)
//
// What does NOT live here:
//   - The "play a sound on attention transition" rule. That
//     cross-cutting rule lives in RobotRoot.vue, where
//     `watch(displayState, (next, prev) => { if (next === 'attention'
//     && prev !== 'attention') playSound('complete') })`. The
//     composable doesn't know about display states.

import { watch, type Ref } from "vue";
import { useThrottleFn } from "@vueuse/core";
import type { Settings } from "@/types/settings";

export interface UseRobotAudioDeps {
  settings: Ref<Settings>;
}

export interface UseRobotAudioReturn {
  /** Play a sound by short name (e.g. 'complete'). Throttled to one
   * play per 10s per name. No-op when sound is disabled. */
  playSound: (name: string) => void;
  /** Pause every cached audio element. Used on DND flip. */
  pauseAll: () => void;
}

export function useRobotAudio(deps: UseRobotAudioDeps): UseRobotAudioReturn {
  const { settings } = deps;
  const audioCache = new Map<string, HTMLAudioElement>();

  const playSound = useThrottleFn((name: string) => {
    if (!settings.value.sound_enabled) return;

    let audio = audioCache.get(name);
    if (!audio) {
      audio = new Audio(`/sounds/${name}.mp3`);
      audio.volume = 0.5;
      audioCache.set(name, audio);
    }
    audio.currentTime = 0;
    audio.play().catch((err) => {
      console.warn(`[useRobotAudio] sound play failed: ${err}`);
    });
  }, 10000);

  function pauseAll(): void {
    audioCache.forEach((a) => a.pause());
  }

  // DND change → pause any in-flight sounds. settings.value.dnd is
  // updated by useSettings()'s DND_CHANGE listener; this watch only
  // triggers the audio-pause side effect.
  watch(
    () => settings.value.dnd,
    (dnd) => {
      if (dnd) pauseAll();
    },
  );

  return { playSound, pauseAll };
}