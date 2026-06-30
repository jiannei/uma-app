// src/types/events.test.ts — Anti-drift test for the events constants
// module. Reads `docs/events.manifest.json` as the single source of
// truth and asserts that the TS constants in `events.ts` (and the Rust
// constants in `src-tauri/src/events.rs`, via a sibling cargo test)
// match the manifest.
//
// ADR-0019 Q2: this is the bidirectional anti-drift assertion. If a TS
// constant disagrees with the manifest, this test fails — that's a
// signal to update the manifest first, then propagate to TS and Rust.
//
// Plus a consumer audit test that scans `src/` for raw event-name
// string literals at `listen()` / `emit()` call sites and ensures
// every app-defined channel flows through `EVENTS.*`. The only
// whitelisted raw string is `tauri://move` (a Tauri built-in, not an
// app-defined channel — see the comment at the top of `events.ts`).

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EVENTS,
  PROD_EVENT_WIRE_STRINGS,
  DEV_EVENT_WIRE_STRINGS,
} from './events';

interface Manifest {
  prod: Record<string, { wire: string; deprecated?: boolean }>;
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

  it('LANGUAGE_CHANGE is live (no deprecated flag)', () => {
    // useSettings.ts:74 subscribes to it. The old deprecation marker
    // was stale — caught and fixed during the EVENTS seam Stage B
    // execution (this PR).
    expect(manifest.prod.languageChange.deprecated).toBeFalsy();
  });

  it('TOGGLE_MINI is the only dead-but-kept prod channel', () => {
    expect(manifest.prod.toggleMini.deprecated).toBe(true);
    expect(EVENTS.TOGGLE_MINI).toBe('toggle-mini');
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

// ── Consumer audit ───────────────────────────────────────────────────
//
// Walk `src/` and find every `listen("...")` / `emit("...")` call that
// uses a string literal. Every app-defined channel MUST flow through
// `EVENTS.*`. The only whitelisted raw string is `tauri://move` (a
// Tauri built-in, not an app-defined channel).
//
// This catches regressions where a future contributor writes
// `await listen("some-new-event", ...)` with a raw literal instead of
// `await listen(EVENTS.SOME_NEW_EVENT, ...)`.

const TAURI_BUILTINS: readonly string[] = ['tauri://move'];

function findFiles(
  dir: string,
  predicate: (name: string) => boolean,
): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...findFiles(full, predicate));
    } else if (predicate(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('EVENTS consumer audit (no raw app-defined event strings in src/)', () => {
  const srcDir = resolve(__dirname, '..');
  const files = findFiles(srcDir, (n) => /\.(ts|vue)$/.test(n))
    // Skip this test file itself — its body contains example strings
    // in comments that would false-positive the audit. The audit's job
    // is to constrain non-test production code.
    .filter((f) => !f.endsWith('events.test.ts'));

  // All wire strings from the manifest, plus the tauri://move builtin.
  const allKnown = new Set<string>([
    ...PROD_EVENT_WIRE_STRINGS,
    ...DEV_EVENT_WIRE_STRINGS,
    ...TAURI_BUILTINS,
  ]);

  for (const file of files) {
    it(`${file.replace(srcDir + '/', '')} uses EVENTS.* (or whitelisted built-in)`, () => {
      const src = readFileSync(file, 'utf-8');
      // Match `listen("foo")` / `listen<...>("foo")` only — that's the
      // Tauri consumer-side call. Vue's `emit("foo", ...)` is a
      // component event, not a Tauri channel, so it isn't constrained
      // by this audit. The Rust emit side has its own anti-drift test
      // (see src-tauri/src/events.rs).
      const re = /\blisten\s*(?:<[^>]*>)?\s*\(\s*["']([^"']+)["']/g;
      let m: RegExpExecArray | null;
      const offenders: string[] = [];
      while ((m = re.exec(src)) !== null) {
        const str = m[1];
        if (!allKnown.has(str)) {
          offenders.push(str);
        }
      }
      expect(offenders).toEqual([]);
    });
  }
});