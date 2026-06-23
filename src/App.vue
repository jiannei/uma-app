<script setup lang="ts">
import { ref, onMounted } from "vue";
import { invoke } from "@tauri-apps/api/core";

interface Settings {
  theme: string;
  dnd: boolean;
  mini_mode: boolean;
  sound_enabled: boolean;
  auto_start: boolean;
}

const settings = ref<Settings>({
  theme: 'clawd',
  dnd: false,
  mini_mode: false,
  sound_enabled: true,
  auto_start: false,
});

const themes = [
  { id: 'clawd', name: 'Clawd', emoji: '🦀' },
  { id: 'calico', name: 'Calico', emoji: '🐱' },
];

const isLoading = ref(true);
const status = ref('');

async function loadSettings() {
  try {
    settings.value = await invoke<Settings>('get_settings');
    isLoading.value = false;
  } catch (err) {
    status.value = 'Failed to load settings: ' + err;
    isLoading.value = false;
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

function toggleSound() {
  settings.value.sound_enabled = !settings.value.sound_enabled;
}

function toggleAutoStart() {
  settings.value.auto_start = !settings.value.auto_start;
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
          <span class="value">360×200 (on demand)</span>
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