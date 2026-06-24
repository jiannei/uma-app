// Ambient type declarations for theme-manager.js.
// Declared as ambient so plain-JS modules get typed without
// converting to .ts (kept as JS for direct Vite consumption).

export interface ThemeStateDef {
  file: string;
  type: string;
}

export interface ThemeHitBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ThemeObjectScale {
  widthRatio?: number;
  heightRatio?: number;
  imgWidthRatio?: number;
  objBottom?: number;
  imgBottom?: number;
  offsetX?: number;
  offsetY?: number;
  fileScales?: Record<string, number>;
  fileOffsets?: Record<string, { x: number; y: number }>;
}

export interface ThemeManifestShape {
  name?: string;
  viewBox?: { x: number; y: number; width: number; height: number };
  fileViewBoxes?: Record<string, unknown>;
  hitBoxes?: {
    default?: ThemeHitBox;
    sleeping?: ThemeHitBox;
    wide?: ThemeHitBox;
    [k: string]: unknown;
  };
  fileHitBoxes?: Record<string, ThemeHitBox>;
  wideHitboxFiles?: string[];
  sleepingHitboxFiles?: string[];
  objectScale?: ThemeObjectScale;
  states?: Record<string, ThemeStateDef>;
  [k: string]: unknown;
}

export interface ThemeListenerPayload {
  themeId: string;
  theme: {
    id: string;
    name: string;
    manifest: ThemeManifestShape;
    states: Record<string, ThemeStateDef>;
    basePath: string;
  };
}

export declare class ThemeManager {
  constructor();
  registerTheme(themeId: string, manifest: ThemeManifestShape): void;
  reloadTheme(themeId: string, newManifest: ThemeManifestShape): boolean;
  setTheme(themeId: string): boolean;
  listThemes(): string[];
  getCurrentTheme(): {
    id: string;
    name: string;
    manifest: ThemeManifestShape;
    states: Record<string, ThemeStateDef>;
    basePath: string;
  } | null;
  getAssetUrl(state: string): string | null;
  getHitBoxDataForState(state: string): {
    file: string;
    viewBox: { x: number; y: number; width: number; height: number } | null;
    hitBox: ThemeHitBox | null;
  } | null;
  computeScreenHitRect(
    state: string,
    renderedRect: DOMRect,
  ): {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  getObjectScale(): ThemeObjectScale | null;
  onChange(listener: (payload: ThemeListenerPayload) => void): () => void;
}
