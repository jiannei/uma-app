// src/pet/theme-manager.js — Minimal theme manager for PoC
// Loads theme.json + assets, provides state → asset URL mapping

const DEFAULT_STATES = {
  idle: { file: 'idle.svg', type: 'svg' },
  thinking: { file: 'idle.svg', type: 'svg' },
  working: { file: 'idle.svg', type: 'svg' },
  building: { file: 'idle.svg', type: 'svg' },
  attention: { file: 'idle.svg', type: 'svg' },
  error: { file: 'idle.svg', type: 'svg' },
  notification: { file: 'idle.svg', type: 'svg' },
  sleeping: { file: 'idle.svg', type: 'svg' },
  waking: { file: 'idle.svg', type: 'svg' },
  sweeping: { file: 'idle.svg', type: 'svg' },
  carrying: { file: 'idle.svg', type: 'svg' },
  'subagent-groove': { file: 'idle.svg', type: 'svg' },
  juggling: { file: 'idle.svg', type: 'svg' },
};

class ThemeManager {
  constructor() {
    this.themes = new Map();
    this.currentThemeId = null;
    this.currentTheme = null;
    this.listeners = new Set();
  }

  /**
   * Register a theme manifest (parsed theme.json)
   */
  registerTheme(themeId, manifest) {
    const states = manifest.states || DEFAULT_STATES;
    this.themes.set(themeId, {
      id: themeId,
      name: manifest.name || themeId,
      manifest,
      states,
      basePath: `themes/${themeId}/assets`,
    });
    console.log(`[theme] registered: ${themeId} (${manifest.name || themeId})`);
  }

  /**
   * Get a sorted list of registered theme ids
   */
  listThemes() {
    return Array.from(this.themes.keys());
  }

  /**
   * Switch to a different theme
   */
  setTheme(themeId) {
    const theme = this.themes.get(themeId);
    if (!theme) {
      console.warn(`[theme] unknown theme: ${themeId}`);
      return false;
    }
    if (this.currentThemeId === themeId) return true;

    this.currentThemeId = themeId;
    this.currentTheme = theme;
    this.notify({ themeId, theme });
    console.log(`[theme] switched to: ${themeId}`);
    return true;
  }

  /**
   * Replace an already-registered theme with a new manifest (read
   * fresh from theme.json by the host after a dev-tool save). Notifies
   * subscribers so the pet window re-renders with the new values.
   * Use case: dev panel writes theme.json → emits theme-updated →
   * pet calls this with the freshly-read manifest → sprite re-renders.
   */
  reloadTheme(themeId, newManifest) {
    if (!this.themes.has(themeId)) {
      console.warn(`[theme] reload unknown theme: ${themeId}`);
      return false;
    }
    this.registerTheme(themeId, newManifest);
    if (this.currentThemeId === themeId) {
      this.currentTheme = this.themes.get(themeId);
      this.notify({ themeId, theme: this.currentTheme });
    }
    console.log(`[theme] reloaded: ${themeId}`);
    return true;
  }

  /**
   * Resolve a state to an asset URL
   */
  getAssetUrl(state) {
    if (!this.currentTheme) return null;
    const stateDef = this.currentTheme.states[state] || this.currentTheme.states.idle;
    return `${this.currentTheme.basePath}/${stateDef.file}`;
  }

  /**
   * Get current theme info
   */
  getCurrentTheme() {
    return this.currentTheme;
  }

  /**
   * Resolve hit-box data for a state — returns the viewBox + hitBox (both in
   * viewBox coords) for the asset currently bound to that state. Used by the
   * pet window to compute the actual screen-space drag rectangle.
   *
   * Override order (matches ADR-0004 / uma-pet):
   *   fileHitBoxes[file] > hitBoxes.sleeping (if file ∈ sleepingHitboxFiles)
   *                    > hitBoxes.wide (if file ∈ wideHitboxFiles)
   *                    > hitBoxes.default
   *
   * viewBox: fileViewBoxes[file] || theme.viewBox
   *
   * Returns null when state is unknown OR hitBoxes.default is missing (uma-pet
   * semantics — no fallback to full viewBox; caller treats null as no drag area).
   */
  getHitBoxDataForState(state) {
    if (!this.currentTheme) return null;
    const manifest = this.currentTheme.manifest;
    if (!manifest || !manifest.states) return null;
    const stateDef = manifest.states[state];
    if (!stateDef) return null;
    const file = stateDef.file;

    const fileViewBoxes = manifest.fileViewBoxes || {};
    const fileHitBoxes = manifest.fileHitBoxes || {};
    const wideFiles = new Set(manifest.wideHitboxFiles || []);
    const sleepingFiles = new Set(manifest.sleepingHitboxFiles || []);
    const hitBoxes = manifest.hitBoxes || {};

    const viewBox = fileViewBoxes[file] || manifest.viewBox || null;

    let hitBox = null;
    if (fileHitBoxes[file]) {
      hitBox = fileHitBoxes[file];
    } else if (sleepingFiles.has(file) && hitBoxes.sleeping) {
      hitBox = hitBoxes.sleeping;
    } else if (wideFiles.has(file) && hitBoxes.wide) {
      hitBox = hitBoxes.wide;
    } else if (hitBoxes.default) {
      hitBox = hitBoxes.default;
    }

    return { file, viewBox, hitBox };
  }

  /**
   * Compute the screen-space drag rectangle for a state, by mapping the
   * viewBox hit-box through the asset's actual rendered DOM rect.
   *
   * `renderedRect` is the sprite element's bounding rect (e.g.
   * `#pet-sprite.getBoundingClientRect()`); the caller is responsible for
   * reading it because this class is DOM-agnostic.
   *
   * Returns null when hit-box data is incomplete or renderedRect is missing.
   */
  computeScreenHitRect(state, renderedRect) {
    const data = this.getHitBoxDataForState(state);
    if (!data || !data.viewBox || !data.hitBox || !renderedRect) return null;
    const { viewBox, hitBox } = data;
    const scaleX = renderedRect.width / viewBox.width;
    const scaleY = renderedRect.height / viewBox.height;
    return {
      x: renderedRect.x + (hitBox.x - viewBox.x) * scaleX,
      y: renderedRect.y + (hitBox.y - viewBox.y) * scaleY,
      width: hitBox.width * scaleX,
      height: hitBox.height * scaleY,
    };
  }

  /**
   * Resolve objectScale config for the current theme. The renderer uses
   * this to size + position the sprite (uma-pet semantics — see
   * uma-pet/src/renderer.js applyObjectScaleStyle and uma-pet/src/styles.css
   * #clawd). Returns null when the theme has no objectScale block.
   */
  getObjectScale() {
    if (!this.currentTheme || !this.currentTheme.manifest) return null;
    return this.currentTheme.manifest.objectScale || null;
  }

  /**
   * Subscribe to theme changes
   */
  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(payload) {
    for (const listener of this.listeners) {
      try {
        listener(payload);
      } catch (err) {
        console.error('[theme] listener error:', err);
      }
    }
  }
}

export { ThemeManager, DEFAULT_STATES };
