// src/robot/Sprite.test.ts — Regression test for the SVG rendering bug.
//
// Bug history: Sprite.vue used to render SVG themes via <object>, and
// APNG themes via <img>. In Tauri 2 macOS webview, <object> loaded with
// an SVG asset renders as 0×0 — getBoundingClientRect returns 0×0 and
// the SVG content is invisible to the user (no DOM error fires). The
// hit-zone workaround in RobotRoot.vue masked getBoundingClientRect,
// but the actual sprite was never visible. Symptoms: "uma can't display",
// "default theme doesn't render", while Calico (which uses <img> for
// APNG) showed fine.
//
// Fix: Sprite.vue now uses <img> for both SVG and APNG themes (the
// dual-element pattern is gone). Chromium renders SVG natively in <img>,
// so the same DOM path works for both.
//
// This test guards the fix:
//   - No <object> element is rendered (was the broken path)
//   - The <img> element gets the SVG asset as src
//   - The <img> element ends up with display:block (visible)

import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import Sprite from './Sprite.vue';
import { ThemeManager } from './theme-manager.js';
import type { ThemeManifest } from './display-state-types';

const umaTheme: ThemeManifest = {
  name: 'Uma',
  timings: {
    minDisplay: {},
    autoReturn: {},
    yawnDuration: 3000,
    wakeDuration: 1500,
    deepSleepTimeout: 600000,
    mouseIdleTimeout: 20000,
    mouseSleepTimeout: 60000,
  },
  states: {
    idle: { file: 'uma-idle-follow.svg', type: 'svg' },
  },
  hitBoxes: { default: { x: 0, y: 0, width: 45, height: 45 } },
  fileViewBoxes: {},
  fileHitBoxes: {},
  wideHitboxFiles: [],
  sleepingHitboxFiles: [],
  viewBox: { x: -15, y: -25, width: 45, height: 45 },
  objectScale: { widthRatio: 1.9, heightRatio: 1.3, offsetX: -0.45, offsetY: -0.25 },
} as unknown as ThemeManifest;

function mountSprite(): { wrapper: ReturnType<typeof mount>; tm: ThemeManager } {
  const tm = new ThemeManager();
  tm.registerTheme('uma', umaTheme);
  tm.setTheme('uma');
  const wrapper = mount(Sprite, {
    props: { state: 'idle', themeManager: tm },
    attachTo: document.body,
  });
  return { wrapper, tm };
}

describe('Sprite renderer', () => {
  it('does not render an <object> element (was 0×0 in Tauri webview)', () => {
    const { wrapper } = mountSprite();
    expect(wrapper.find('object').exists()).toBe(false);
  });

  it('binds the SVG asset to <img>.src', async () => {
    const { wrapper } = mountSprite();
    await wrapper.vm.$nextTick();
    const img = wrapper.find('img#robot-sprite');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toContain('uma-idle-follow.svg');
  });

  it('marks the sprite wrapper as visible (display: block)', async () => {
    const { wrapper } = mountSprite();
    await wrapper.vm.$nextTick();
    const wrap = wrapper.find('#robot-sprite-wrapper');
    expect(wrap.exists()).toBe(true);
    expect(wrap.classes()).toContain('block');
    expect(wrap.classes()).not.toContain('hidden');
  });

  it('exposes getActiveElement() that returns the <img> node (not null)', async () => {
    const { wrapper } = mountSprite();
    await wrapper.vm.$nextTick();
    const spriteRef = wrapper.vm as unknown as {
      getActiveElement: () => HTMLImageElement | null;
    };
    const active = spriteRef.getActiveElement();
    expect(active).not.toBeNull();
    expect(active?.tagName).toBe('IMG');
  });

  // Regression guard for the Chromium <img>-SVG percent-width quirk:
  // when CSS `width` is a percentage > 100% of the containing block on
  // an <img> with intrinsic dimensions (SVG), Chromium silently clamps
  // the rendered offsetWidth to the containing block width. The fix is
  // to put the percentages on a wrapper <div> instead and have the
  // <img> fill it at 100%. This test verifies the wrapper is the
  // element that carries the geometry styles, NOT the <img> itself.
  it('puts percentage geometry on a wrapper, not on <img>', async () => {
    const { wrapper } = mountSprite();
    await wrapper.vm.$nextTick();
    const wrap = wrapper.find('#robot-sprite-wrapper');
    const img = wrapper.find('img#robot-sprite');
    expect(wrap.exists()).toBe(true);
    expect(img.exists()).toBe(true);
    // Wrapper has the percent-based geometry (e.g. width: 190%)
    expect(wrap.attributes('style') || '').toMatch(/width:\s*190%/);
    // <img> uses 100% to fill the wrapper (avoids the Chromium quirk)
    expect(img.attributes('style') || '').toMatch(/width:\s*100%/);
  });
});