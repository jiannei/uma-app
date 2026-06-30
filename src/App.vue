<script setup lang="ts">
// src/App.vue — Settings window. v1.6.0: shadcn-vue Sidebar + Tabs layout,
// Card-ified settings rows, Sonner for feedback toasts, dark mode toggle.
//
// Layout:
//   SidebarProvider → Sidebar (left nav) + SidebarInset (right content)
//   SidebarInset wraps a Tabs component; each nav item is a TabsTrigger.
//   Tab panels use Card → CardHeader / CardContent / Separator / CardFooter.
//
// Dark mode: handled by @/components/ModeToggle.vue (useColorMode from
// @vueuse/core). Persists to localStorage, syncs with `.dark` class on
// <html> (Tailwind's @custom-variant dark reads it).
//
// Feedback toasts: Sonner (top-center). Replaces the old `status` ref +
// `setTimeout` + `<footer class="animate-toast-in">` pattern.

import { ref, reactive, onMounted, defineAsyncComponent } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { RadioGroupRoot, RadioGroupItem, TooltipProvider, TooltipRoot, TooltipTrigger, TooltipPortal, SelectRoot, SelectPortal } from "reka-ui";
import Button from "@/components/Btn.vue";
import Badge from "@/components/Badge.vue";
import Label from "@/components/Label.vue";
import Switch from "@/components/Switch.vue";
import SelectTrigger from "@/components/SelectTrigger.vue";
import SelectContent from "@/components/SelectContent.vue";
import SelectItem from "@/components/SelectItem.vue";
import SelectViewport from "@/components/SelectViewport.vue";
import SelectScrollButton from "@/components/SelectScrollButton.vue";
import TabsRoot from "@/components/TabsRoot.vue";
import TabsContent from "@/components/TabsContent.vue";
import Card from "@/components/Card.vue";
import CardContent from "@/components/CardContent.vue";
import Separator from "@/components/Separator.vue";
import TooltipContent from "@/components/TooltipContent.vue";
import TooltipArrow from "@/components/TooltipArrow.vue";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarInset,
} from "@/components/sidebar";

import ModeToggle from "@/components/ModeToggle.vue";
import { refAutoReset } from "@vueuse/core";


// DevTools panel (dev-only). Dynamic import so release builds don't
// bundle DevToolsApp.vue + its 5 panels + XState machine.
const isDev = import.meta.env.DEV;
const DevToolsApp = isDev
  ? defineAsyncComponent(() => import("./devtools/DevToolsApp.vue"))
  : null;

// ── Types ──────────────────────────────────────────────────────

interface Settings {
  theme: string;
  dnd: boolean;
  mini_mode: boolean;
  sound_enabled: boolean;
  auto_start: boolean;
  language: string;
}

interface AgentInfo {
  id: string;
  display_name: string;
  config_path: string;
  is_installed: boolean;
}

// ── Sidebar nav items ──────────────────────────────────────────

const navItems = [
  { id: "general", label: "通用", icon: "i-lucide-settings" },
  { id: "agents", label: "Agent 管理", icon: "i-lucide-zap" },
  { id: "theme", label: "主题", icon: "i-lucide-palette" },
  { id: "shortcuts", label: "快捷键", icon: "i-lucide-keyboard" },
  { id: "about", label: "关于", icon: "i-lucide-info" },
  ...(import.meta.env.DEV
    ? [{ id: "devtools" as const, label: "DevTools", icon: "i-lucide-wrench" }]
    : []),
] as const;

type NavId = (typeof navItems)[number]["id"];

// ── Reactive state ──────────────────────────────────────────────

const activeNav = ref<NavId>("general");

const settings = ref<Settings>({
  theme: "uma",
  dnd: false,
  mini_mode: false,
  sound_enabled: true,
  auto_start: false,
  language: "zh",
});

const themes = [
  { id: "uma", label: "Uma" },
  { id: "calico", label: "Calico" },
];

const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "zh", label: "中文" },
] as const;

const isLoading = ref(true);
const status = refAutoReset('', 1500);

const agents = ref<AgentInfo[]>([]);
const agentBusy = reactive<Record<string, boolean>>({});

// ─ Loaders ─────────────────────────────────────────────────────

async function loadSettings() {
  try {
    const store = await load("settings.json", { autoSave: false, defaults: {} });
    const theme = (await store.get<string>("theme")) || "uma";
    const dnd = (await store.get<boolean>("dnd")) ?? false;
    const mini_mode = (await store.get<boolean>("mini_mode")) ?? false;
    const sound_enabled = (await store.get<boolean>("sound_enabled")) ?? true;
    const auto_start = (await store.get<boolean>("auto_start")) ?? false;
    const storedLang = (await store.get<string>("language")) || "zh";

    settings.value = {
      theme,
      dnd,
      mini_mode,
      sound_enabled,
      auto_start,
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
  } catch (err) {
    status.value = "Failed: " + err;
  }
}

async function toggleDnd(v: boolean) {
  try {
    await invoke("set_dnd", { enabled: v });
    settings.value.dnd = v;
    status.value = `DND: ${v ? "on" : "off"}`;
  } catch (err) {
    status.value = "Failed: " + err;
  }
}

async function toggleSound(v: boolean) {
  settings.value.sound_enabled = v;
  try {
    // Route through the Rust set_sound command (mirrors set_dnd's
    // pattern). Rust persists to plugin-store AND emits sound-change
    // so any future consumers (tray checkmark refresh, dev panel
    // inspector) stay in sync. Previously this function wrote
    // plugin-store directly — tray flips would silently drift until
    // next launch because no event was broadcast.
    await invoke("set_sound", { enabled: v });
  } catch (err) {
    console.warn("Failed to set sound:", err);
    status.value = "Failed: " + err;
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

async function setLanguage(language: string) {
  settings.value.language = language;
  try {
    const store = await load("settings.json", { autoSave: true, defaults: {} });
    await store.set("language", language);
    await store.save();
    status.value = `Language: ${language}`;
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
  <TooltipProvider :delay-duration="0">
    <SidebarProvider class="h-screen overflow-hidden">
      <Sidebar side="left" variant="sidebar" collapsible="none" class="border-r border-[var(--border)] bg-[var(--sidebar)] overscroll-y-none">
        <SidebarContent class="py-4 px-3" style="overscroll-behavior-y: none">
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem v-for="item in navItems" :key="item.id">
                  <SidebarMenuButton
                    :is-active="activeNav === item.id"
                    @click="activeNav = item.id"
                    class="h-9 py-2"
                  >
                    <div :class="[item.icon, 'size-4']" />
                    <span>{{ item.label }}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <SidebarInset class="flex flex-col min-h-0 overscroll-y-none">
        <TabsRoot
          :model-value="activeNav"
          @update:model-value="(v: any) => (activeNav = v)"
          :data-orientation="'horizontal'"
          class="flex flex-col flex-1 min-h-0 overscroll-y-none"
        >
          <div class="flex-1 overflow-y-auto px-8 pt-6 pb-10 scrollbar-thin min-h-0 overscroll-y-none">
            <!-- General -->
            <TabsContent value="general" class="flex-1 max-w-[560px] mt-0">
              <div class="mb-6">
                <h1 class="text-[22px] font-bold m-0 mb-1 tracking-[-0.02em] text-[var(--foreground)]">设置</h1>
                <p class="text-[13px] m-0 text-[var(--muted-foreground)]">配置 Clawd 在桌面上的行为。</p>
              </div>

              <!-- Appearance group -->
              <div class="mb-5">
                <div class="text-[11px] font-medium text-[var(--muted-foreground)] mb-2 pl-0.5">外观</div>
                <Card class="backdrop-blur-md shadow-sm shadow-black/20">
                  <CardContent class="p-0">
                    <!-- Appearance -->
                    <div class="flex items-center justify-between gap-4 py-3 px-4">
                      <div class="flex-1 min-w-0 flex items-start gap-2.5">
                        <div class="i-lucide-palette w-4 h-4 mt-0.5 text-[var(--muted-foreground)] shrink-0" />
                        <div>
                          <Label class="text-[13px] font-medium text-[var(--foreground)] tracking-[-0.005em]">外观</Label>
                          <div class="text-[12px] text-[var(--muted-foreground)] mt-px leading-snug">Light / Dark / System。</div>
                        </div>
                      </div>
                      <div class="shrink-0">
                        <ModeToggle />
                      </div>
                    </div>
                    <Separator />
                    <!-- Language -->
                    <div class="flex items-center justify-between gap-4 py-3 px-4">
                      <div class="flex-1 min-w-0 flex items-start gap-2.5">
                        <div class="i-lucide-languages w-4 h-4 mt-0.5 text-[var(--muted-foreground)] shrink-0" />
                        <div>
                          <Label class="text-[13px] font-medium text-[var(--foreground)] tracking-[-0.005em]">语言</Label>
                          <div class="text-[12px] text-[var(--muted-foreground)] mt-px leading-snug">菜单和气泡的界面语言。</div>
                        </div>
                      </div>
                      <div class="shrink-0">
                        <SelectRoot
                          :model-value="settings.language"
                          @update:model-value="(v) => setLanguage(v as string)"
                        >
                          <SelectTrigger
                            size="sm"
                            class="bg-[var(--secondary)] border-[var(--border)] text-[var(--foreground)] font-sans text-[12.5px] hover:border-[var(--ring)] focus:border-[var(--ring)]"
                          />
                          <SelectPortal>
                            <SelectContent
                              position="item-aligned"
                              align="center"
                            >
                              <SelectScrollButton direction="up" />
                              <SelectViewport>
                                <SelectItem
                                  v-for="l in LANGUAGES"
                                  :key="l.id"
                                  :value="l.id"
                                >
                                  {{ l.label }}
                                </SelectItem>
                              </SelectViewport>
                              <SelectScrollButton direction="down" />
                            </SelectContent>
                          </SelectPortal>
                        </SelectRoot>
                      </div>
                    </div>
                    <Separator />
                    <!-- Sound -->
                    <div class="flex items-center justify-between gap-4 py-3 px-4">
                      <div class="flex-1 min-w-0 flex items-start gap-2.5">
                        <div class="i-lucide-volume-2 w-4 h-4 mt-0.5 text-[var(--muted-foreground)] shrink-0" />
                        <div>
                          <Label class="text-[13px] font-medium text-[var(--foreground)] tracking-[-0.005em]">音效</Label>
                          <div class="text-[12px] text-[var(--muted-foreground)] mt-px leading-snug">Clawd 完成任务或需要输入时播放提示音。</div>
                        </div>
                      </div>
                      <div class="shrink-0">
                        <Switch
                          :model-value="settings.sound_enabled"
                          @update:model-value="(v: boolean) => toggleSound(v)"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <!-- Behavior group -->
              <div class="mb-5">
                <div class="text-[11px] font-medium text-[var(--muted-foreground)] mb-2 pl-0.5">行为</div>
                <Card class="backdrop-blur-md shadow-sm shadow-black/20">
                  <CardContent class="p-0">
                    <!-- DND -->
                    <div class="flex items-center justify-between gap-4 py-3 px-4">
                      <div class="flex-1 min-w-0 flex items-start gap-2.5">
                        <div class="i-lucide-bell-off w-4 h-4 mt-0.5 text-[var(--muted-foreground)] shrink-0" />
                        <div>
                          <TooltipRoot>
                            <TooltipTrigger as-child>
                              <Label class="text-[13px] font-medium text-[var(--foreground)] tracking-[-0.005em] cursor-help">Do Not Disturb</Label>
                            </TooltipTrigger>
                            <TooltipPortal>
                              <TooltipContent side="top">
                                Suppress permission bubbles; CC falls back to its terminal prompt.
                                <TooltipArrow />
                              </TooltipContent>
                            </TooltipPortal>
                          </TooltipRoot>
                          <div class="text-[12px] text-[var(--muted-foreground)] mt-px leading-snug">静音权限气泡。</div>
                        </div>
                      </div>
                      <div class="shrink-0">
                        <Switch
                          :model-value="settings.dnd"
                          @update:model-value="(v: boolean) => toggleDnd(v)"
                        />
                      </div>
                    </div>
                    <Separator />
                    <!-- Auto-start -->
                    <div class="flex items-center justify-between gap-4 py-3 px-4">
                      <div class="flex-1 min-w-0 flex items-start gap-2.5">
                        <div class="i-lucide-power w-4 h-4 mt-0.5 text-[var(--muted-foreground)] shrink-0" />
                        <div>
                          <TooltipRoot>
                            <TooltipTrigger as-child>
                              <Label class="text-[13px] font-medium text-[var(--foreground)] tracking-[-0.005em] cursor-help">开机自启</Label>
                            </TooltipTrigger>
                            <TooltipPortal>
                              <TooltipContent side="top">
                                Start the robot + hook server automatically when you log in.
                                <TooltipArrow />
                              </TooltipContent>
                            </TooltipPortal>
                          </TooltipRoot>
                          <div class="text-[12px] text-[var(--muted-foreground)] mt-px leading-snug">登录时自动启动 Uma。</div>
                        </div>
                      </div>
                      <div class="shrink-0">
                        <Switch
                          :model-value="settings.auto_start"
                          @update:model-value="(v: boolean) => toggleAutoStart(v)"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

            </TabsContent>

            <!-- Agents -->
            <TabsContent value="agents" class="flex-1 max-w-[560px] mt-0">
              <div class="mb-6">
                <h1 class="text-[22px] font-bold m-0 mb-1 tracking-[-0.02em] text-[var(--foreground)]">Agent 管理</h1>
                <p class="text-[13px] m-0 text-[var(--muted-foreground)]">安装或移除 AI agent 的 hook 集成。</p>
              </div>

              <div class="mb-5">
                <Card class="backdrop-blur-md shadow-sm shadow-black/20">
                  <CardContent class="p-0">
                    <template v-if="agents.length === 0">
                      <div class="flex items-center justify-between gap-4 py-3 px-4">
                        <div class="flex-1 min-w-0">
                          <div class="text-[13px] font-medium text-[var(--foreground)] tracking-[-0.005em]">No agents registered</div>
                          <div class="text-[12px] text-[var(--muted-foreground)] mt-px leading-snug">Check KNOWN_AGENTS on the Rust side.</div>
                        </div>
                      </div>
                    </template>
                    <template v-else>
                      <div
                        v-for="(agent, i) in agents"
                        :key="agent.id"
                      >
                        <Separator v-if="i > 0" />
                        <div class="flex items-center justify-between gap-4 py-3 px-4">
                          <div class="flex-1 min-w-0">
                            <div class="text-[13px] font-medium text-[var(--foreground)] tracking-[-0.005em] inline-flex items-center gap-1.5">
                              {{ agent.display_name }}
                              <Badge :variant="agent.is_installed ? 'default' : 'secondary'">
                                {{ agent.is_installed ? "Installed" : "Not installed" }}
                              </Badge>
                            </div>
                            <div class="text-[11px] text-[var(--muted-foreground)] mt-px leading-snug font-mono">{{ agent.config_path }}</div>
                          </div>
                          <div class="shrink-0 flex items-center gap-2">
                            <Button
                              v-if="!agent.is_installed"
                              size="sm"
                              :disabled="agentBusy[agent.id]"
                              @click="installAgent(agent.id)"
                            >
                              <div class="i-lucide-download w-3.5 h-3.5 mr-1" />
                              {{ agentBusy[agent.id] ? "Installing…" : "Install" }}
                            </Button>
                            <Button
                              v-else
                              variant="outline"
                              size="sm"
                              :disabled="agentBusy[agent.id]"
                              @click="uninstallAgent(agent.id)"
                            >
                              <div class="i-lucide-trash-2 w-3.5 h-3.5 mr-1" />
                              {{ agentBusy[agent.id] ? "Removing…" : "Uninstall" }}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </template>
                  </CardContent>
                </Card>
              </div>

              <p class="text-[11.5px] text-[var(--muted-foreground)] leading-relaxed mt-2.5 pl-0.5">
                Installed agents forward events to the local hook server at 127.0.0.1:17373.
                Uninstalling only removes this app's entries.
              </p>
            </TabsContent>

            <!-- Theme -->
            <TabsContent value="theme" class="flex-1 max-w-[560px] mt-0">
              <div class="mb-6">
                <h1 class="text-[22px] font-bold m-0 mb-1 tracking-[-0.02em] text-[var(--foreground)]">主题</h1>
                <p class="text-[13px] m-0 text-[var(--muted-foreground)]">选择你的桌面机器人外观。</p>
              </div>

              <div class="mb-5">
                <Card class="backdrop-blur-md shadow-sm shadow-black/20">
                  <CardContent class="p-0">
                    <!-- Theme -->
                    <div class="flex items-center justify-between gap-4 py-3 px-4">
                      <div class="flex-1 min-w-0 flex items-start gap-2.5">
                        <div class="i-lucide-palette w-4 h-4 mt-0.5 text-[var(--muted-foreground)] shrink-0" />
                        <div>
                          <Label class="text-[13px] font-medium text-[var(--foreground)] tracking-[-0.005em]">Theme</Label>
                          <div class="text-[12px] text-[var(--muted-foreground)] mt-px leading-snug">Choose your desktop robot character.</div>
                        </div>
                      </div>
                      <div class="shrink-0">
                        <RadioGroupRoot
                          :model-value="settings.theme"
                          @update:model-value="(v: any) => setTheme(String(v))"
                          class="inline-flex gap-0.5 p-0.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)]/40"
                        >
                          <label
                            v-for="opt in themes"
                            :key="opt.id"
                            :class="[
                              'relative inline-flex items-center justify-center px-3 py-1 rounded-md text-xs font-medium cursor-pointer select-none transition-colors duration-150 whitespace-nowrap',
                              settings.theme === opt.id
                                ? 'bg-[var(--background)] text-[var(--foreground)] shadow-sm'
                                : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                            ]"
                          >
                            <RadioGroupItem :value="opt.id" class="sr-only" />
                            {{ opt.label }}
                          </label>
                        </RadioGroupRoot>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <!-- Shortcuts -->
            <TabsContent value="shortcuts" class="flex-1 max-w-[560px] mt-0">
              <div class="mb-6">
                <h1 class="text-[22px] font-bold m-0 mb-1 tracking-[-0.02em] text-[var(--foreground)]">快捷键</h1>
                <p class="text-[13px] m-0 text-[var(--muted-foreground)]">自定义键盘快捷键。</p>
              </div>

              <div class="mb-5">
                <Card class="backdrop-blur-md shadow-sm shadow-black/20">
                  <CardContent class="flex flex-col items-center justify-center py-8 px-4">
                    <div class="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[var(--muted)] mb-3">
                      <div class="i-lucide-clock w-7 h-7 text-[var(--muted-foreground)]" />
                    </div>
                    <div class="text-[14px] font-semibold text-[var(--muted-foreground)] mb-1">Coming soon</div>
                    <div class="text-[12px] text-[var(--muted-foreground)]">Keyboard shortcuts customization will be available in a future update.</div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <!-- About -->
            <TabsContent value="about" class="flex-1 max-w-[560px] mt-0">
              <div class="mb-6">
                <h1 class="text-[22px] font-bold m-0 mb-1 tracking-[-0.02em] text-[var(--foreground)]">关于</h1>
                <p class="text-[13px] m-0 text-[var(--muted-foreground)]">Uma on Desk — Desktop robot for AI coding agents.</p>
              </div>

              <div class="mb-5">
                <Card class="backdrop-blur-md shadow-sm shadow-black/20">
                  <CardContent class="flex flex-col items-center justify-center py-7 px-4">
                    <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[var(--primary)]/10 mb-3">
                      <div class="i-lucide-bot w-9 h-9 text-[var(--primary)]" />
                    </div>
                    <div class="text-[16px] font-bold text-[var(--foreground)] mb-0.5">Uma on Desk</div>
                    <div class="text-[12px] text-[var(--muted-foreground)] mb-3">v1.5.0</div>
                    <Separator class="w-[60%]" />
                    <div class="text-[12.5px] text-[var(--muted-foreground)] leading-relaxed max-w-[400px] mx-auto mt-3">A transparent, always-on-top animated robot that lives on your desktop and reacts to events from AI coding agents via HTTP webhooks.</div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <!-- DevTools (dev only). `v-show` keeps the DevTools instance alive
                 across tab switches (so XState context / theme-editor dirty
                 state is preserved). -->
            <TabsContent
              v-if="isDev && DevToolsApp"
              value="devtools"
              class="flex-1 mt-0 -mx-8 -mb-10 min-h-0 overflow-hidden"
            >
              <DevToolsApp />
            </TabsContent>
          </div>
        </TabsRoot>
      </SidebarInset>
    </SidebarProvider>

    <!-- Sonner toast portal — renders feedback toasts at top-center -->
    <!-- Footer status toast -->
    <footer v-if="status" class="fixed left-1/2 bottom-6 -translate-x-1/2 inline-flex items-center gap-2 py-2 px-4 text-[12px] text-[var(--foreground)] bg-[var(--card)]/90 border border-[var(--border)] rounded-full shadow-xl shadow-black/40 backdrop-blur-xl z-50 animate-toast-in">
      <span class="w-1.5 h-1.5 rounded-full bg-[var(--primary)] shadow-[0_0_6px_var(--primary)]" />
      {{ status }}
    </footer>
  </TooltipProvider>
</template>

<style scoped>
@keyframes toast-in {
  from { opacity: 0; transform: translate(-50%, 6px); }
  to   { opacity: 1; transform: translate(-50%, 0); }
}
.animate-toast-in {
  animation: toast-in 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
</style>
