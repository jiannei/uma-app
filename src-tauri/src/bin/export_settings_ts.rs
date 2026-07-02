// src/bin/export_settings_ts.rs — Regenerate the TypeScript `Settings`
// interface from the Rust `Settings` struct (ts-rs).
//
// Usage: `cargo run --bin export-settings-ts`
//
// Output path is controlled by `#[ts(export_to = "...")]` on the
// `Settings` struct. The output file is committed; the frontend build
// reads it as a normal source file, so the JS dev loop doesn't need
// a Rust toolchain.

use ts_rs::TS;
use uma_app_lib::Settings;

fn main() -> Result<(), String> {
    Settings::export_all(&ts_rs::Config::default())
        .map_err(|e| format!("ts-rs export failed: {e}"))
}
