<script setup lang="ts">
import { ref, onMounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";

interface Settings {
  theme: string;
  dnd: boolean;
  mini_mode: boolean;
  sound_enabled: boolean;
  auto_start: boolean;
  hook_installed: boolean;
}

const settings = ref<Settings>({
  theme: 'clawd',
  dnd: false,
  mini_mode: false,
  sound_enabled: true,
  auto_start: false,
  hook_installed: false,
});

const themes = [
  { id: 'clawd', name: 'Clawd', emoji: '🦀' },
  { id: 'calico', name: 'Calico', emoji: '🐱' },
];

const isLoading = ref(true);
const status = ref('');
const isHookBusy = ref(false);
const bubblePosition = ref('bottom-right');

async function loadSettings() {
  try {
    // Load from plugin-store on the JS side
    const store = await load('settings.json', { autoSave: false, defaults: {} });
    const theme = (await store.get<string>('theme')) || 'clawd';
    const dnd = (await store.get<boolean>('dnd')) ?? false;
    const mini_mode = (await store.get<boolean>('mini_mode')) ?? false;
    const sound_enabled = (await store.get<boolean>('sound_enabled')) ?? true;
    const auto_start = (await store.get<boolean>('auto_start')) ?? false;
    const storedPos = (await store.get<string>('bubble_position')) || 'bottom-right';
    bubblePosition.value = storedPos;

    settings.value = {
      theme,
      dnd,
      mini_mode,
      sound_enabled,
      auto_start,
      hook_installed: settings.value.hook_installed,
    };

    // Also sync from Rust (in case anything diverged)
    try {
      const rustSettings = await invoke<Settings>('get_settings');
      settings.value = { ...settings.value, ...rustSettings };
    } catch {
      /* ignore */
    }

    // Check hook status
    await refreshHookStatus();
  } catch (err) {
    status.value = 'Failed to load settings: ' + err;
  } finally {
    isLoading.value = false;
  }
}

async function refreshHookStatus() {
  try {
    const installed = await invoke<boolean>('check_hook_installed');
    settings.value.hook_installed = installed;
  } catch (err) {
    console.warn('check_hook_installed failed:', err);
  }
}

async function setTheme(theme: string) {
  try {
    await invoke('set_theme', { theme });
    settings.value.theme = theme;
    status.value = `Theme: ${theme}`;
    setTimeout(() => { status.value = ''; }, 1500);
  } catch (err) {
    status.value = 'Failed: ' + err;
  }
}

async function toggleDnd() {
  const newValue = !settings.value.dnd;
  try {
    await invoke('set_dnd', { enabled: newValue });
    settings.value.dnd = newValue;
    status.value = `DND: ${newValue ? 'on' : 'off'}`;
    setTimeout(() => { status.value = ''; }, 1500);
  } catch (err) {
    status.value = 'Failed: ' + err;
  }
}

async function toggleSound() {
  const newValue = !settings.value.sound_enabled;
  settings.value.sound_enabled = newValue;
  try {
    const store = await load('settings.json', { autoSave: true, defaults: {} });
    await store.set('sound_enabled', newValue);
    await store.save();
  } catch (err) {
    console.warn('Failed to persist sound_enabled:', err);
  }
}

async function toggleAutoStart() {
  const newValue = !settings.value.auto_start;
  settings.value.auto_start = newValue;
  try {
    const store = await load('settings.json', { autoSave: true, defaults: {} });
    await store.set('auto_start', newValue);
    await store.save();
  } catch (err) {
    console.warn('Failed to persist auto_start:', err);
  }
}

const bubblePositions = [
  { id: 'top-left', label: 'Top Left' },
  { id: 'top-right', label: 'Top Right' },
  { id: 'bottom-left', label: 'Bottom Left' },
  { id: 'bottom-right', label: 'Bottom Right' },
];

async function setBubblePosition(position: string) {
  try {
    await invoke('set_bubble_position', { position });
    const store = await load('settings.json', { autoSave: true, defaults: {} });
    await store.set('bubble_position', position);
    await store.save();
    bubblePosition.value = position;  // Update reactive ref so UI highlights change
    status.value = `Bubble position: ${position}`;
    setTimeout(() => { status.value = ''; }, 1500);
  } catch (err) {
    status.value = 'Failed: ' + err;
  }
}

async function installHook() {
  isHookBusy.value = true;
  try {
    await invoke('install_claude_hook');
    await refreshHookStatus();
    status.value = 'Hook installed';
    setTimeout(() => { status.value = ''; }, 2000);
  } catch (err) {
    status.value = 'Install failed: ' + err;
  } finally {
    isHookBusy.value = false;
  }
}

async function uninstallHook() {
  isHookBusy.value = true;
  try {
    await invoke('uninstall_claude_hook');
    await refreshHookStatus();
    status.value = 'Hook uninstalled';
    setTimeout(() => { status.value = ''; }, 2000);
  } catch (err) {
    status.value = 'Uninstall failed: ' + err;
  } finally {
    isHookBusy.value = false;
  }
}

onMounted(loadSettings);
</script>

<template>
  <div class="settings">
    <header>
      <h1>🦀 Clawd on Desk</h1>
      <p class="subtitle">Desktop pet for AI coding agents</p>
    </header>

    <section>
      <h2>Theme</h2>
      <div class="theme-grid">
        <button
          v-for="t in themes"
          :key="t.id"
          :class="['theme-card', { active: settings.theme === t.id }]"
          @click="setTheme(t.id)"
        >
          <span class="emoji">{{ t.emoji }}</span>
          <span class="name">{{ t.name }}</span>
        </button>
      </div>
    </section>

    <section>
      <h2>Permission Bubble Position</h2>
      <div class="position-grid">
        <button
          v-for="p in bubblePositions"
          :key="p.id"
          :class="['position-card', { active: bubblePosition === p.id }]"
          @click="setBubblePosition(p.id)"
        >
          {{ p.label }}
        </button>
      </div>
    </section>

    <section>
      <h2>Agent 集成</h2>
      <div class="agent-card">
        <div class="agent-info">
          <div class="agent-name">Claude Code</div>
          <div class="agent-status" :class="{ installed: settings.hook_installed }">
            {{ settings.hook_installed ? '✅ 已安装' : '❌ 未安装' }}
          </div>
        </div>
        <div class="agent-actions">
          <button
            v-if="!settings.hook_installed"
            class="btn-primary"
            :disabled="isHookBusy"
            @click="installHook"
          >
            {{ isHookBusy ? '安装中...' : '安装' }}
          </button>
          <button
            v-else
            class="btn-secondary"
            :disabled="isHookBusy"
            @click="uninstallHook"
          >
            {{ isHookBusy ? '卸载中...' : '卸载' }}
          </button>
        </div>
      </div>
      <p class="agent-hint">
        安装后，Claude Code 的事件将通过 HTTP hook 转发到本地 17373 端口。<br>
        卸载会移除 ~/.claude/settings.json 中本应用添加的条目，保留其他 hooks。
      </p>
    </section>

    <section>
      <h2>Behavior</h2>
      <div class="toggle-row">
        <span>Do Not Disturb</span>
        <button :class="['toggle', { on: settings.dnd }]" @click="toggleDnd">
          {{ settings.dnd ? 'ON' : 'OFF' }}
        </button>
      </div>
      <div class="toggle-row">
        <span>Sound Effects</span>
        <button :class="['toggle', { on: settings.sound_enabled }]" @click="toggleSound">
          {{ settings.sound_enabled ? 'ON' : 'OFF' }}
        </button>
      </div>
      <div class="toggle-row">
        <span>Auto-start at login</span>
        <button :class="['toggle', { on: settings.auto_start }]" @click="toggleAutoStart">
          {{ settings.auto_start ? 'ON' : 'OFF' }}
        </button>
      </div>
    </section>

    <section>
      <h2>Status</h2>
      <div class="status-grid">
        <div class="status-item">
          <span class="label">Pet window</span>
          <span class="value">200×200 (hit-zone 144×144)</span>
        </div>
        <div class="status-item">
          <span class="label">Hook server</span>
          <span class="value">127.0.0.1:17373</span>
        </div>
        <div class="status-item">
          <span class="label">Bubble window</span>
          <span class="value">360×200 (bottom-right, on demand)</span>
        </div>
      </div>
    </section>

    <footer v-if="status">
      <p class="status-msg">{{ status }}</p>
    </footer>
  </div>
</template>

<style scoped>
.settings {
  padding: 32px;
  max-width: 640px;
  margin: 0 auto;
}

header h1 {
  margin: 0 0 4px;
  font-size: 28px;
  font-weight: 700;
}

.subtitle {
  margin: 0 0 24px;
  color: #888;
  font-size: 13px;
}

section {
  margin-bottom: 28px;
}

h2 {
  margin: 0 0 12px;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #888;
  font-weight: 600;
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 12px;
}

.theme-card {
  background: #1e1e2e;
  border: 2px solid transparent;
  border-radius: 10px;
  padding: 16px 12px;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  font-family: inherit;
  color: inherit;
}

.theme-card:hover {
  background: #313244;
  border-color: #45475a;
}

.theme-card.active {
  border-color: #89b4fa;
  background: #313244;
}

.theme-card .emoji {
  font-size: 32px;
}

.theme-card .name {
  font-size: 13px;
  font-weight: 500;
}

.toggle-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid #313244;
  font-size: 14px;
}

.toggle-row:last-child {
  border-bottom: none;
}

.toggle {
  background: #45475a;
  color: #cdd6f4;
  border: none;
  border-radius: 6px;
  padding: 6px 14px;
  cursor: pointer;
  font-weight: 600;
  font-size: 11px;
  letter-spacing: 0.5px;
  font-family: inherit;
  min-width: 60px;
}

.toggle.on {
  background: #a6e3a1;
  color: #1e1e2e;
}

.status-grid {
  background: #1e1e2e;
  border-radius: 10px;
  padding: 14px 16px;
  font-size: 13px;
}

.status-item {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
}

.status-item .label {
  color: #888;
}

.status-item .value {
  font-family: monospace;
  color: #cdd6f4;
}

footer {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  background: #89b4fa;
  color: #1e1e2e;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
}

.agent-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #1e1e2e;
  border-radius: 10px;
  padding: 14px 16px;
  margin-bottom: 8px;
}

.agent-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.agent-name {
  font-size: 14px;
  font-weight: 600;
}

.agent-status {
  font-size: 12px;
  color: #888;
}

.agent-status.installed {
  color: #a6e3a1;
}

.agent-actions button {
  min-width: 80px;
}

.btn-primary {
  background: #89b4fa;
  color: #1e1e2e;
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  cursor: pointer;
  font-weight: 600;
  font-size: 12px;
  font-family: inherit;
}

.btn-primary:hover:not(:disabled) {
  filter: brightness(0.9);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: #45475a;
  color: #cdd6f4;
  border: none;
  border-radius: 6px;
  padding: 8px 16px;
  cursor: pointer;
  font-weight: 600;
  font-size: 12px;
  font-family: inherit;
}

.btn-secondary:hover:not(:disabled) {
  filter: brightness(0.9);
}

.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.agent-hint {
  font-size: 12px;
  color: #888;
  line-height: 1.5;
  margin: 8px 0 0;
}

.position-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.position-card {
  background: #1e1e2e;
  border: 2px solid transparent;
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
  color: inherit;
  font-size: 13px;
}

.position-card:hover {
  background: #313244;
  border-color: #45475a;
}

.position-card.active {
  border-color: #89b4fa;
  background: #313244;
}
</style>

<style>
:root {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #cdd6f4;
  background-color: #11111b;
  font-synthesis: none;
  -webkit-font-smoothing: antialiased;
}

body {
  margin: 0;
  background: #11111b;
  min-height: 100vh;
}
</style>