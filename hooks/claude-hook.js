#!/usr/bin/env node
// hooks/claude-hook.js — Claude Code hook that posts state to local Rust server
// Called by Claude Code on various events (UserPromptSubmit, PreToolUse, etc.)
// Forwards the event to the Tauri app's HTTP server.

const HOOK_PORT = process.env.UMA_PET_PORT || 17373;
const HOOK_URL = `http://127.0.0.1:${HOOK_PORT}/hook/event`;

// Read event JSON from stdin (Claude Code convention)
async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    console.error('[hook] no input on stdin');
    process.exit(0);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    console.error('[hook] failed to parse JSON:', err.message);
    process.exit(1);
  }

  // Claude Code payload structure:
  // { session_id, hook_event_name, tool_name, cwd, ... }
  const event = {
    session_id: payload.session_id || 'unknown',
    event_type: payload.hook_event_name || 'Unknown',
    tool_name: payload.tool_name || null,
    agent: 'claude',
    cwd: payload.cwd || null,
  };

  try {
    const res = await fetch(HOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) {
      console.error('[hook] server returned', res.status);
    }
  } catch (err) {
    // Don't block Claude Code if our server is down
    console.error('[hook] failed to reach pet server:', err.message);
  }

  // Always exit 0 so Claude Code doesn't block
  process.exit(0);
}

main();
