<script setup lang="ts">
// src/App.vue — Settings window. v1.2.1: Reka UI primitive
// refactor. The hand-rolled `.toggle-row` / `.theme-grid` /
// `.position-card` markup is replaced by Reka UI Switch,
// RadioGroup, and Tooltip primitives (with local Catppuccin
// Mocha styling). Per-agent installation state is NOT here —
// read it from `list_agents` (ADR-0002).

import { ref, reactive, onMounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import Switch from "./components/ui/switch/Switch.vue";
import RadioGroup from "./components/ui/radio-group/RadioGroup.vue";
import Tooltip from "./components/ui/tooltip/Tooltip.vue";

// ── Types ──────────────────────────────────────────────────────

interface Settings {
  theme: string;
  dnd: boolean;
  mini_mode: boolean;
  sound_enabled: boolean;
  auto_start: boolean;
  bubble_position: string;
  language: string;
}

interface AgentInfo {
  id: string;
  display_name: string;
  config_path: string;
  is_installed: boolean;
}

// ── Reactive state ──────────────────────────────────────────────

const settings = ref<Settings>({
  theme: "uma",
  dnd: false,
  mini_mode: false,
  sound_enabled: true,
  auto_start: false,
  bubble_position: "bottom-right",
  language: "en",
});

const themes = [
  { id: "uma", label: "Uma", hint: "🦀" },
  { id: "calico", label: "Calico", hint: "🐱" },
];

const bubblePositions = [
  { id: "top-left", label: "Top Left" },
  { id: "top-right", label: "Top Right" },
  { id: "bottom-left", label: "Bottom Left" },
  { id: "bottom-right", label: "Bottom Right" },
];

const LANGUAGES = [
  { id: "en", label: "English", hint: "Default" },
  { id: "zh", label: "中文", hint: "简体中文" },
] as const;

const isLoading = ref(true);
const status = ref("");
const bubblePosition = ref("bottom-right");

const agents = ref<AgentInfo[]>([]);
const agentBusy = reactive<Record<string, boolean>>({});

// ── Loaders ─────────────────────────────────────────────────────

async function loadSettings() {
  try {
    const store = await load("settings.json", { autoSave: false, defaults: {} });
    const theme = (await store.get<string>("theme")) || "uma";
    const dnd = (await store.get<boolean>("dnd")) ?? false;
    const mini_mode = (await store.get<boolean>("mini_mode")) ?? false;
    const sound_enabled = (await store.get<boolean>("sound_enabled")) ?? true;
    const auto_start = (await store.get<boolean>("auto_start")) ?? false;
    const storedPos = (await store.get<string>("bubble_position")) || "bottom-right";
    const storedLang = (await store.get<string>("language")) || "en";
    bubblePosition.value = storedPos;

    settings.value = {
      theme,
      dnd,
      mini_mode,
      sound_enabled,
      auto_start,
      bubble_position: storedPos,
      language: storedLang,
    };

    try {
      const rustSettings = await invoke<Settings>("get_settings");
      settings.value = { ...settings.value, ...rustSettings };
    } catch {
      /* ignore */
    }
  } catch (err) {
    status.value = "Failed to load settings: " + err;
  } finally {
    isLoading.value = false;
  }
}

async function loadAgents() {
  try {
    agents.value = await invoke<AgentInfo[]>("list_agents");
  } catch (err) {
    console.warn("list_agents failed:", err);
    status.value = "Failed to list agents: " + err;
  }
}

async function refreshAgent(agentId: string) {
  try {
    const installed = await invoke<boolean>("check_agent_installed", { agentId });
    const idx = agents.value.findIndex((a) => a.id === agentId);
    if (idx >= 0) {
      agents.value[idx] = { ...agents.value[idx], is_installed: installed };
    }
  } catch (err) {
    console.warn(`check_agent_installed(${agentId}) failed:`, err);
  }
}

// ── Settings mutators ───────────────────────────────────────────

async function setTheme(theme: string) {
  try {
    await invoke("set_theme", { theme });
    settings.value.theme = theme;
    status.value = `Theme: ${theme}`;
    setTimeout(() => {
      status.value = "";
    }, 1500);
  } catch (err) {
    status.value = "Failed: " + err;
  }
}

async function toggleDnd(v: boolean) {
  try {
    await invoke("set_dnd", { enabled: v });
    settings.value.dnd = v;
    status.value = `DND: ${v ? "on" : "off"}`;
    setTimeout(() => {
      status.value = "";
    }, 1500);
  } catch (err) {
    status.value = "Failed: " + err;
  }
}

async function toggleSound(v: boolean) {
  settings.value.sound_enabled = v;
  try {
    const store = await load("settings.json", { autoSave: true, defaults: {} });
    await store.set("sound_enabled", v);
    await store.save();
  } catch (err) {
    console.warn("Failed to persist sound_enabled:", err);
  }
}

async function toggleAutoStart(v: boolean) {
  settings.value.auto_start = v;
  try {
    const store = await load("settings.json", { autoSave: true, defaults: {} });
    await store.set("auto_start", v);
    await store.save();
  } catch (err) {
    console.warn("Failed to persist auto_start:", err);
  }
}

async function setBubblePosition(position: string) {
  try {
    await invoke("set_bubble_position", { position });
    const store = await load("settings.json", { autoSave: true, defaults: {} });
    await store.set("bubble_position", position);
    await store.save();
    bubblePosition.value = position;
    status.value = `Bubble position: ${position}`;
    setTimeout(() => {
      status.value = "";
    }, 1500);
  } catch (err) {
    status.value = "Failed: " + err;
  }
}

async function setLanguage(language: string) {
  try {
    await invoke("set_language", { language });
    settings.value.language = language;
    const store = await load("settings.json", { autoSave: true, defaults: {} });
    await store.set("language", language);
    await store.save();
    status.value = `Language: ${language}`;
    setTimeout(() => {
      status.value = "";
    }, 1500);
  } catch (err) {
    status.value = "Failed: " + err;
  }
}

// ── Agent install / uninstall ───────────────────────────────────

async function installAgent(agentId: string) {
  agentBusy[agentId] = true;
  try {
    await invoke("install_agent_hook", { agentId });
    await refreshAgent(agentId);
    const agent = agents.value.find((a) => a.id === agentId);
    status.value = `${agent?.display_name ?? agentId}: hook installed`;
    setTimeout(() => {
      status.value = "";
    }, 2000);
  } catch (err) {
    status.value = `Install failed: ${err}`;
  } finally {
    agentBusy[agentId] = false;
  }
}

async function uninstallAgent(agentId: string) {
  agentBusy[agentId] = true;
  try {
    await invoke("uninstall_agent_hook", { agentId });
    await refreshAgent(agentId);
    const agent = agents.value.find((a) => a.id === agentId);
    status.value = `${agent?.display_name ?? agentId}: hook uninstalled`;
    setTimeout(() => {
      status.value = "";
    }, 2000);
  } catch (err) {
    status.value = `Uninstall failed: ${err}`;
  } finally {
    agentBusy[agentId] = false;
  }
}

onMounted(async () => {
  await loadSettings();
  await loadAgents();
});
</script>

<template>
  <div class="settings">
    <header>
      <h1>🦀 Uma on Desk</h1>
      <p class="subtitle">Desktop robot for AI coding agents</p>
    </header>

    <section>
      <h2>Theme</h2>
      <RadioGroup
        :model-value="settings.theme"
        :options="themes"
        @update:model-value="(v: string) => setTheme(v)"
      />
    </section>

    <section>
      <h2>Permission Bubble Position</h2>
      <RadioGroup
        :model-value="bubblePosition"
        :options="bubblePositions"
        @update:model-value="(v: string) => setBubblePosition(v)"
      />
    </section>

    <section>
      <h2>Language</h2>
      <RadioGroup
        :model-value="settings.language"
        :options="LANGUAGES.map((l) => ({ id: l.id, label: l.label, hint: l.hint }))"
        @update:model-value="(v: string) => setLanguage(v)"
      />
    </section>

    <section>
      <h2>Agent 集成</h2>
      <div v-if="agents.length === 0" class="empty-hint">
        No agents registered. (Rust side: check KNOWN_AGENTS.)
      </div>
      <div
        v-for="agent in agents"
        :key="agent.id"
        class="agent-card"
      >
        <div class="agent-info">
          <div class="agent-name">{{ agent.display_name }}</div>
          <div class="agent-config">{{ agent.config_path }}</div>
          <div class="agent-status" :class="{ installed: agent.is_installed }">
            {{ agent.is_installed ? "✅ 已安装" : "❌ 未安装" }}
          </div>
        </div>
        <div class="agent-actions">
          <button
            v-if="!agent.is_installed"
            class="btn-primary"
            :disabled="agentBusy[agent.id]"
            @click="installAgent(agent.id)"
          >
            {{ agentBusy[agent.id] ? "安装中..." : "安装" }}
          </button>
          <button
            v-else
            class="btn-secondary"
            :disabled="agentBusy[agent.id]"
            @click="uninstallAgent(agent.id)"
          >
            {{ agentBusy[agent.id] ? "卸载中..." : "卸载" }}
          </button>
        </div>
      </div>
      <p class="agent-hint">
        安装后，agent 的事件将通过 HTTP hook 转发到本地 17373 端口。<br />
        卸载会从该 agent 的配置文件中移除本应用添加的条目，保留其他 hooks。
      </p>
    </section>

    <section>
      <h2>Behavior</h2>
      <div class="toggle-row">
        <Tooltip text="Suppress permission bubbles; CC falls back to its terminal prompt.">
          <span>Do Not Disturb</span>
        </Tooltip>
        <Switch
          :model-value="settings.dnd"
          @update:model-value="(v: boolean) => toggleDnd(v)"
        />
      </div>
      <div class="toggle-row">
        <Tooltip text="Play a chime when a permission request arrives.">
          <span>Sound Effects</span>
        </Tooltip>
        <Switch
          :model-value="settings.sound_enabled"
          @update:model-value="(v: boolean) => toggleSound(v)"
        />
      </div>
      <div class="toggle-row">
        <Tooltip text="Start the robot + hook server automatically when you log in.">
          <span>Auto-start at login</span>
        </Tooltip>
        <Switch
          :model-value="settings.auto_start"
          @update:model-value="(v: boolean) => toggleAutoStart(v)"
        />
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
  padding: 24px;
  max-width: 720px;
  margin: 0 auto;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #cdd6f4;
}

header {
  margin-bottom: 24px;
}

h1 {
  font-size: 24px;
  margin: 0;
}

.subtitle {
  font-size: 13px;
  color: #a6adc8;
  margin: 4px 0 0;
}

section {
  background: #181825;
  border: 1px solid #313244;
  border-radius: 8px;
  padding: 16px 20px;
  margin-bottom: 16px;
}

h2 {
  font-size: 11px;
  font-weight: 600;
  color: #a6adc8;
  margin: 0 0 12px;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

/* ── Behavior section (Switches in toggle rows) ────────────── */

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  font-size: 13px;
}

.toggle-row + .toggle-row {
  border-top: 1px solid #313244;
}

.toggle-row span {
  color: #cdd6f4;
}

/* ── Agent section (cards) ──────────────────────────────────── */

.empty-hint {
  color: #6c7086;
  font-style: italic;
  font-size: 12px;
}

.agent-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #1e1e2e;
  border: 1px solid #313244;
  border-radius: 6px;
  padding: 12px;
  margin-bottom: 8px;
}

.agent-info {
  flex: 1;
  min-width: 0;
}

.agent-name {
  font-weight: 500;
  font-size: 13px;
  color: #cdd6f4;
}

.agent-config {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 11px;
  color: #6c7086;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agent-status {
  font-size: 11px;
  margin-top: 4px;
  color: #f38ba8;
}

.agent-status.installed {
  color: #a6e3a1;
}

.agent-actions {
  margin-left: 12px;
}

.btn-primary,
.btn-secondary {
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
}

.btn-primary {
  background: #a6e3a1;
  color: #1e1e2e;
}

.btn-secondary {
  background: #f38ba8;
  color: #1e1e2e;
}

.btn-primary:disabled,
.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.agent-hint {
  font-size: 11px;
  color: #a6adc8;
  margin: 8px 0 0;
  line-height: 1.5;
}

/* ── Status section ─────────────────────────────────────────── */

.status-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 12px;
}

.status-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.status-item .label {
  font-size: 10px;
  color: #a6adc8;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.status-item .value {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 12px;
  color: #cdd6f4;
}

footer {
  margin-top: 16px;
}

.status-msg {
  background: #313244;
  color: #cdd6f4;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  margin: 0;
}
</style>