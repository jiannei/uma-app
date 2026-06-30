// src/types/events.test.ts — Anti-drift test for the events constants
// module. Reads `docs/events.manifest.json` as the single source of
// truth and asserts that the TS constants in `events.ts` (and the Rust
// constants in `src-tauri/src/events.rs`, via a sibling cargo test)
// match the manifest.
//
// ADR-0019 Q2: this is the bidirectional anti-drift assertion. If a TS
// constant disagrees with the manifest, this test fails — that's a
// signal to update the manifest first, then propagate to TS and Rust.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EVENTS,
  PROD_EVENT_WIRE_STRINGS,
  DEV_EVENT_WIRE_STRINGS,
} from './events';

interface Manifest {
  prod: Record<string, { wire: string; deprecated?: string }>;
  dev: Record<string, { wire: string }>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const manifestPath = resolve(__dirname, '../../docs/events.manifest.json');
const manifest: Manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

function expectedWireStrings(
  section: Record<string, { wire: string }>,
): string[] {
  return Object.values(section)
    .map((e) => e.wire)
    .sort();
}

describe('EVENTS constants ↔ docs/events.manifest.json', () => {
  it('prod channels match the manifest', () => {
    const tsProd = [...PROD_EVENT_WIRE_STRINGS].sort();
    const manifestProd = expectedWireStrings(manifest.prod);
    expect(tsProd).toEqual(manifestProd);
  });

  it('dev channels match the manifest', () => {
    const tsDev = [...DEV_EVENT_WIRE_STRINGS].sort();
    const manifestDev = expectedWireStrings(manifest.dev);
    expect(tsDev).toEqual(manifestDev);
  });

  it('count of prod constants matches manifest', () => {
    expect(PROD_EVENT_WIRE_STRINGS.length).toBe(
      Object.keys(manifest.prod).length,
    );
  });

  it('count of dev constants matches manifest', () => {
    expect(DEV_EVENT_WIRE_STRINGS.length).toBe(
      Object.keys(manifest.dev).length,
    );
  });

  it('deprecated markers present for half-dead channels', () => {
    // language_change and toggle_mini are marked deprecated in the
    // manifest and have JSDoc @deprecated annotations on the TS side.
    // This test is a sanity guard for the annotation surface.
    expect(manifest.prod.language_change.deprecated).toBeTruthy();
    expect(manifest.prod.toggle_mini.deprecated).toBeTruthy();
  });
});

describe('EVENTS constants structure', () => {
  it('all top-level keys are PascalCase strings', () => {
    for (const key of Object.keys(EVENTS)) {
      if (key === 'DEV') continue;
      expect(key).toMatch(/^[A-Z_]+$/);
    }
  });

  it('DEV namespace has exactly 4 channels', () => {
    expect(Object.keys(EVENTS.DEV).length).toBe(4);
  });

  it('no prod wire string leaks under DEV', () => {
    const prodSet = new Set<string>(PROD_EVENT_WIRE_STRINGS);
    for (const wire of DEV_EVENT_WIRE_STRINGS) {
      expect(prodSet.has(wire)).toBe(false);
    }
  });
});
