// src-tauri/src/adapters/mod.rs — Agent adapter registry
//
// Each module under `adapters/` implements the `Agent` trait for one
// AI coding assistant. Adding a new agent means adding a module here
// and appending it to `KNOWN_AGENTS` in `agent.rs`.

pub mod claude_code;
