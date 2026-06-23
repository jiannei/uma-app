// src/pet/theme-manager.js — Minimal theme manager for PoC
// Loads theme.json + assets, provides state → asset URL mapping

const DEFAULT_STATES = {
  idle: { file: 'idle.svg', type: 'svg' },
  thinking: { file: 'idle.svg', type: 'svg' },
  typing: { file: 'idle.svg', type: 'svg' },
  building: { file: 'idle.svg', type: 'svg' },
  happy: { file: 'idle.svg', type: 'svg' },
  error: { file: 'idle.svg', type: 'svg' },
  notification: { file: 'idle.svg', type: 'svg' },
  sleeping: { file: 'idle.svg', type: 'svg' },
  waking: { file: 'idle.svg', type: 'svg' },
  sweeping: { file: 'idle.svg', type: 'svg' },
  carrying: { file: 'idle.svg', type: 'svg' },
  'subagent-groove': { file: 'idle.svg', type: 'svg' },
  'multi-subagent': { file: 'idle.svg', type: 'svg' },
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
