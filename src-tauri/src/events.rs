// src-tauri/src/events.rs — Tauri event channel wire-string constants.
//
// Single source of truth lives at docs/events.manifest.json. This
// module mirrors it for Rust use; the sibling src/types/events.ts
// mirrors it for TS use. The anti-drift test in this file (and the
// vitest under src/types/events.test.ts) loads the manifest and
// asserts equality with the constants below.
//
// ADR-0019: scope = 7 prod + 2 deprecated (dead emit, pending remove)
// + 4 dev-only (cfg-gated). The half-dead constants live in prod so
// the existing emit sites in lib.rs / tray.rs continue to type-check
// during Stage B migration.

/// Prod channels — always present in both build profiles. Half-dead
/// channels (no TS listener) live here too; Stage B final PR removes
/// them along with their dead emit sites.
///
/// `allow(dead_code)` because Stage A is intentionally a "dead module"
/// — no consumer site references these constants yet. Stage B will
/// replace emit/listen string literals with `events::prod::*` calls,
/// at which point each constant becomes used and the warning lifts.
#[allow(dead_code)]
pub mod prod {
    pub const AGENT_HOOK: &str = "agent-hook-event";
    pub const PERMISSION_REQUEST: &str = "permission-request";
    pub const PERMISSION_TIMEOUT: &str = "permission-timeout";
    pub const THEME_CHANGE: &str = "theme-change";
    pub const THEME_UPDATED: &str = "theme-updated";
    pub const DND_CHANGE: &str = "dnd-change";
    pub const SOUND_CHANGE: &str = "sound-change";

    /// Half-dead: Rust emits, TS has no listener. Pending remove.
    #[deprecated(note = "no listener in TS; pending remove")]
    pub const LANGUAGE_CHANGE: &str = "language-change";

    /// Half-dead: Rust emits (tray mini menu), TS has no listener.
    /// Pending remove.
    #[deprecated(note = "no listener in TS; pending remove")]
    pub const TOGGLE_MINI: &str = "toggle-mini";
}

/// Dev-only channels — cfg-gated. In a release build (cargo build
/// --release), this module does not exist at all; prod-side code
/// cannot reference these constants even by accident because the
/// symbol is absent, not merely unused.
///
/// `allow(dead_code)` because Stage A is intentionally dead — no
/// consumer imports from `events::dev` yet. The dev paths only fire
/// during actual dev mode (when consumers exist). Once Stage B
/// migrates dev listeners and emit sites, the warning lifts.
#[cfg(debug_assertions)]
#[allow(dead_code)]
pub mod dev {
    pub const PENDING_CHANGED: &str = "devtools-pending-changed";
    pub const SYNTHETIC_EVENT: &str = "devtools-synthetic-event";
    pub const RESET: &str = "devtools-reset";
    pub const ROBOT_DEBUG_STYLE: &str = "devtools-robot-debug-style";
}

/// Sorted list of all prod wire strings. The anti-drift test below
/// asserts that the manifest's prod section has exactly this set.
///
/// `allow(deprecated)` because `LANGUAGE_CHANGE` and `TOGGLE_MINI`
/// are intentionally half-dead during Stage B migration — they will
/// be removed in the final Stage B cleanup PR. The slice retains
/// them so the anti-drift test catches any drift on them too.
///
/// `allow(dead_code)` because the slice is only consumed by tests
/// today; Stage B will reference it from anti-drift assertions on
/// consumer-side code (planned V2 follow-up in ADR-0019).
#[allow(deprecated, dead_code)]
pub const PROD_WIRE_STRINGS: &[&str] = &[
    prod::AGENT_HOOK,
    prod::PERMISSION_REQUEST,
    prod::PERMISSION_TIMEOUT,
    prod::THEME_CHANGE,
    prod::THEME_UPDATED,
    prod::DND_CHANGE,
    prod::SOUND_CHANGE,
    prod::LANGUAGE_CHANGE,
    prod::TOGGLE_MINI,
];

/// Sorted list of dev-only wire strings. Only available in dev builds.
#[cfg(debug_assertions)]
#[allow(dead_code)]
pub const DEV_WIRE_STRINGS: &[&str] = &[
    dev::PENDING_CHANGED,
    dev::SYNTHETIC_EVENT,
    dev::RESET,
    dev::ROBOT_DEBUG_STYLE,
];

// Anti-drift tests. Load the manifest at compile time and assert the
// local constants match. If a wire string is renamed, this test fails
// immediately so the developer knows to update the manifest + TS +
// Rust in lockstep rather than letting them drift silently across
// language boundaries.

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn manifest_wire_strings(section_name: &str) -> Vec<String> {
        let raw = include_str!("../../docs/events.manifest.json");
        let v: Value = serde_json::from_str(raw).expect("manifest is valid JSON");
        let mut wires: Vec<String> = v
            .get(section_name)
            .expect("manifest has section")
            .as_object()
            .expect("section is an object")
            .values()
            .filter_map(|e| {
                e.get("wire")
                    .and_then(|w| w.as_str())
                    .map(|s| s.to_string())
            })
            .collect();
        wires.sort();
        wires
    }

    fn local_wire_strings(arr: &[&str]) -> Vec<String> {
        let mut out: Vec<String> = arr.iter().map(|s| s.to_string()).collect();
        out.sort();
        out
    }

    fn manifest_count(section: &str) -> usize {
        let raw = include_str!("../../docs/events.manifest.json");
        let v: Value = serde_json::from_str(raw).expect("manifest is valid JSON");
        v.get(section)
            .and_then(|s| s.as_object())
            .map(|o| o.len())
            .unwrap_or(0)
    }

    #[test]
    fn prod_channels_match_manifest() {
        let from_manifest = manifest_wire_strings("prod");
        let from_rust = local_wire_strings(PROD_WIRE_STRINGS);
        assert_eq!(
            from_rust, from_manifest,
            "Rust prod wire strings disagree with docs/events.manifest.json"
        );
    }

    #[test]
    fn prod_count_matches_manifest() {
        assert_eq!(PROD_WIRE_STRINGS.len(), manifest_count("prod"));
    }

    #[cfg(debug_assertions)]
    #[test]
    fn dev_channels_match_manifest() {
        let from_manifest = manifest_wire_strings("dev");
        let from_rust = local_wire_strings(DEV_WIRE_STRINGS);
        assert_eq!(
            from_rust, from_manifest,
            "Rust dev wire strings disagree with docs/events.manifest.json"
        );
    }

    #[cfg(debug_assertions)]
    #[test]
    fn dev_count_matches_manifest() {
        assert_eq!(DEV_WIRE_STRINGS.len(), manifest_count("dev"));
    }
}
