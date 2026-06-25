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

import { ref, reactive, onMounted, defineAsyncComponent, markRaw } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
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
} from "@/components/ui/sidebar";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import RadioGroupWithOptions from "@/components/ui/radio-group/RadioGroupWithOptions.vue";
import { TooltipProvider } from "@/components/ui/tooltip";
import TooltipWrapper from "@/components/ui/tooltip/TooltipWrapper.vue";
import ModeToggle from "@/components/ModeToggle.vue";
import {
  Settings as SettingsIcon,
  Zap,
  Palette,
  Keyboard,
  Info,
  Wrench,
  Languages,
  Volume2,
  BellOff,
  Power,
  MessageSquare,
  Bot,
  Clock,
  Download,
  Trash2,
} from "@lucide/vue";

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
  bubble_position: string;
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
  { id: "general", label: "通用", icon: markRaw(SettingsIcon) },
  { id: "agents", label: "Agent 管理", icon: markRaw(Zap) },
  { id: "theme", label: "主题", icon: markRaw(Palette) },
  { id: "shortcuts", label: "快捷键", icon: markRaw(Keyboard) },
  { id: "about", label: "关于", icon: markRaw(Info) },
  ...(import.meta.env.DEV
    ? [{ id: "devtools" as const, label: "DevTools", icon: markRaw(Wrench) }]
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
  bubble_position: "bottom-right",
  language: "zh",
});

const themes = [
  { id: "uma", label: "Uma" },
  { id: "calico", label: "Calico" },
];

const bubblePositions = [
  { id: "top-left", label: "左上" },
  { id: "top-right", label: "右上" },
  { id: "bottom-left", label: "左下" },
  { id: "bottom-right", label: "右下" },
];

const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "zh", label: "中文" },
] as const;

const isLoading = ref(true);
const status = ref("");
const bubblePosition = ref("bottom-right");

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
    const storedPos = (await store.get<string>("bubble_position")) || "bottom-right";
    const storedLang = (await store.get<string>("language")) || "zh";
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
    setTimeout(() => { status.value = ""; }, 1500);
  } catch (err) {
    status.value = "Failed: " + err;
  }
}

async function toggleDnd(v: boolean) {
  try {
    await invoke("set_dnd", { enabled: v });
    settings.value.dnd = v;
    status.value = `DND: ${v ? "on" : "off"}`;
    setTimeout(() => { status.value = ""; }, 1500);
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
    status.value = `Bubble: ${position}`;
    setTimeout(() => { status.value = ""; }, 1500);
  } catch (err) {
    status.value = "Failed: " + err;
  }
}

async function setLanguage(language: string) {
  settings.value.language = language;
  try {
    const store = await load("settings.json", { autoSave: true, defaults: {} });
    await store.set("language", language);
    await store.save();
    status.value = `Language: ${language}`;
    setTimeout(() => { status.value = ""; }, 1500);
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
    setTimeout(() => { status.value = ""; }, 2000);
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
    setTimeout(() => { status.value = ""; }, 2000);
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
  <TooltipProvider>
    <SidebarProvider class="h-screen overflow-hidden">
      <Sidebar side="left" variant="sidebar" collapsible="none" class="border-r border-border bg-sidebar overscroll-y-none">
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
                    <component :is="item.icon" :width="16" :height="16" />
                    <span>{{ item.label }}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <SidebarInset class="flex flex-col min-h-0 overscroll-y-none">
        <Tabs :model-value="activeNav" @update:model-value="(v: any) => (activeNav = v)" class="flex flex-col flex-1 min-h-0 overscroll-y-none">
          <div class="flex-1 overflow-y-auto px-8 pt-6 pb-10 scrollbar-thin min-h-0 overscroll-y-none">
            <!-- General -->
            <TabsContent value="general" class="flex-1 max-w-[560px] mt-0">
              <div class="mb-6">
                <h1 class="text-[22px] font-bold m-0 mb-1 tracking-[-0.02em] text-foreground">设置</h1>
                <p class="text-[13px] m-0 text-muted-foreground">配置 Clawd 在桌面上的行为。</p>
              </div>

              <!-- Appearance group -->
              <div class="mb-5">
                <div class="text-[11px] font-medium text-muted-foreground mb-2 pl-0.5">外观</div>
                <Card class="backdrop-blur-md shadow-sm shadow-black/20">
                  <CardContent class="p-0">
                    <!-- Appearance -->
                    <div class="flex items-center justify-between gap-4 py-3 px-4">
                      <div class="flex-1 min-w-0 flex items-start gap-2.5">
                        <Palette class="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" :width="16" :height="16" />
                        <div>
                          <Label class="text-[13px] font-medium text-foreground tracking-[-0.005em]">外观</Label>
                          <div class="text-[12px] text-muted-foreground mt-px leading-snug">Light / Dark / System。</div>
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
                        <Languages class="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" :width="16" :height="16" />
                        <div>
                          <Label class="text-[13px] font-medium text-foreground tracking-[-0.005em]">语言</Label>
                          <div class="text-[12px] text-muted-foreground mt-px leading-snug">菜单和气泡的界面语言。</div>
                        </div>
                      </div>
                      <div class="shrink-0">
                        <Select
                          :model-value="settings.language"
                          @update:model-value="(v) => setLanguage(v as string)"
                        >
                          <SelectTrigger
                            size="sm"
                            class="bg-secondary border-border text-foreground font-sans text-[12.5px] hover:border-ring focus:border-ring"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem v-for="l in LANGUAGES" :key="l.id" :value="l.id">
                              {{ l.label }}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <Separator />
                    <!-- Sound -->
                    <div class="flex items-center justify-between gap-4 py-3 px-4">
                      <div class="flex-1 min-w-0 flex items-start gap-2.5">
                        <Volume2 class="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" :width="16" :height="16" />
                        <div>
                          <Label class="text-[13px] font-medium text-foreground tracking-[-0.005em]">音效</Label>
                          <div class="text-[12px] text-muted-foreground mt-px leading-snug">Clawd 完成任务或需要输入时播放提示音。</div>
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
                <div class="text-[11px] font-medium text-muted-foreground mb-2 pl-0.5">行为</div>
                <Card class="backdrop-blur-md shadow-sm shadow-black/20">
                  <CardContent class="p-0">
                    <!-- DND -->
                    <div class="flex items-center justify-between gap-4 py-3 px-4">
                      <div class="flex-1 min-w-0 flex items-start gap-2.5">
                        <BellOff class="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" :width="16" :height="16" />
                        <div>
                          <TooltipWrapper text="Suppress permission bubbles; CC falls back to its terminal prompt.">
                            <Label class="text-[13px] font-medium text-foreground tracking-[-0.005em] cursor-help">Do Not Disturb</Label>
                          </TooltipWrapper>
                          <div class="text-[12px] text-muted-foreground mt-px leading-snug">静音权限气泡。</div>
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
                        <Power class="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" :width="16" :height="16" />
                        <div>
                          <TooltipWrapper text="Start the robot + hook server automatically when you log in.">
                            <Label class="text-[13px] font-medium text-foreground tracking-[-0.005em] cursor-help">开机自启</Label>
                          </TooltipWrapper>
                          <div class="text-[12px] text-muted-foreground mt-px leading-snug">登录时自动启动 Uma。</div>
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
                <h1 class="text-[22px] font-bold m-0 mb-1 tracking-[-0.02em] text-foreground">Agent 管理</h1>
                <p class="text-[13px] m-0 text-muted-foreground">安装或移除 AI agent 的 hook 集成。</p>
              </div>

              <div class="mb-5">
                <Card class="backdrop-blur-md shadow-sm shadow-black/20">
                  <CardContent class="p-0">
                    <template v-if="agents.length === 0">
                      <div class="flex items-center justify-between gap-4 py-3 px-4">
                        <div class="flex-1 min-w-0">
                          <div class="text-[13px] font-medium text-foreground tracking-[-0.005em]">No agents registered</div>
                          <div class="text-[12px] text-muted-foreground mt-px leading-snug">Check KNOWN_AGENTS on the Rust side.</div>
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
                            <div class="text-[13px] font-medium text-foreground tracking-[-0.005em] inline-flex items-center gap-1.5">
                              {{ agent.display_name }}
                              <Badge :variant="agent.is_installed ? 'default' : 'secondary'">
                                {{ agent.is_installed ? "Installed" : "Not installed" }}
                              </Badge>
                            </div>
                            <div class="text-[11px] text-muted-foreground mt-px leading-snug font-mono">{{ agent.config_path }}</div>
                          </div>
                          <div class="shrink-0 flex items-center gap-2">
                            <Button
                              v-if="!agent.is_installed"
                              size="sm"
                              :disabled="agentBusy[agent.id]"
                              @click="installAgent(agent.id)"
                            >
                              <Download class="w-3.5 h-3.5 mr-1" :width="14" :height="14" />
                              {{ agentBusy[agent.id] ? "Installing…" : "Install" }}
                            </Button>
                            <Button
                              v-else
                              variant="outline"
                              size="sm"
                              :disabled="agentBusy[agent.id]"
                              @click="uninstallAgent(agent.id)"
                            >
                              <Trash2 class="w-3.5 h-3.5 mr-1" :width="14" :height="14" />
                              {{ agentBusy[agent.id] ? "Removing…" : "Uninstall" }}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </template>
                  </CardContent>
                </Card>
              </div>

              <p class="text-[11.5px] text-muted-foreground leading-relaxed mt-2.5 pl-0.5">
                Installed agents forward events to the local hook server at 127.0.0.1:17373.
                Uninstalling only removes this app's entries.
              </p>
            </TabsContent>

            <!-- Theme -->
            <TabsContent value="theme" class="flex-1 max-w-[560px] mt-0">
              <div class="mb-6">
                <h1 class="text-[22px] font-bold m-0 mb-1 tracking-[-0.02em] text-foreground">主题</h1>
                <p class="text-[13px] m-0 text-muted-foreground">选择你的桌面机器人外观。</p>
              </div>

              <div class="mb-5">
                <Card class="backdrop-blur-md shadow-sm shadow-black/20">
                  <CardContent class="p-0">
                    <!-- Theme -->
                    <div class="flex items-center justify-between gap-4 py-3 px-4">
                      <div class="flex-1 min-w-0 flex items-start gap-2.5">
                        <Palette class="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" :width="16" :height="16" />
                        <div>
                          <Label class="text-[13px] font-medium text-foreground tracking-[-0.005em]">Theme</Label>
                          <div class="text-[12px] text-muted-foreground mt-px leading-snug">Choose your desktop robot character.</div>
                        </div>
                      </div>
                      <div class="shrink-0">
                        <RadioGroupWithOptions
                          :model-value="settings.theme"
                          :options="themes"
                          @update:model-value="(v: string) => setTheme(v)"
                        />
                      </div>
                    </div>
                    <Separator />
                    <!-- Bubble position -->
                    <div class="flex items-center justify-between gap-4 py-3 px-4">
                      <div class="flex-1 min-w-0 flex items-start gap-2.5">
                        <MessageSquare class="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" :width="16" :height="16" />
                        <div>
                          <Label class="text-[13px] font-medium text-foreground tracking-[-0.005em]">Bubble position</Label>
                          <div class="text-[12px] text-muted-foreground mt-px leading-snug">Where the permission bubble appears.</div>
                        </div>
                      </div>
                      <div class="shrink-0">
                        <RadioGroupWithOptions
                          :model-value="bubblePosition"
                          :options="bubblePositions"
                          @update:model-value="(v: string) => setBubblePosition(v)"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <!-- Shortcuts -->
            <TabsContent value="shortcuts" class="flex-1 max-w-[560px] mt-0">
              <div class="mb-6">
                <h1 class="text-[22px] font-bold m-0 mb-1 tracking-[-0.02em] text-foreground">快捷键</h1>
                <p class="text-[13px] m-0 text-muted-foreground">自定义键盘快捷键。</p>
              </div>

              <div class="mb-5">
                <Card class="backdrop-blur-md shadow-sm shadow-black/20">
                  <CardContent class="flex flex-col items-center justify-center py-8 px-4">
                    <div class="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-muted mb-3">
                      <Clock class="w-7 h-7 text-muted-foreground" :width="28" :height="28" />
                    </div>
                    <div class="text-[14px] font-semibold text-muted-foreground mb-1">Coming soon</div>
                    <div class="text-[12px] text-muted-foreground">Keyboard shortcuts customization will be available in a future update.</div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <!-- About -->
            <TabsContent value="about" class="flex-1 max-w-[560px] mt-0">
              <div class="mb-6">
                <h1 class="text-[22px] font-bold m-0 mb-1 tracking-[-0.02em] text-foreground">关于</h1>
                <p class="text-[13px] m-0 text-muted-foreground">Uma on Desk — Desktop robot for AI coding agents.</p>
              </div>

              <div class="mb-5">
                <Card class="backdrop-blur-md shadow-sm shadow-black/20">
                  <CardContent class="flex flex-col items-center justify-center py-7 px-4">
                    <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-3">
                      <Bot class="w-9 h-9 text-primary" :width="36" :height="36" />
                    </div>
                    <div class="text-[16px] font-bold text-foreground mb-0.5">Uma on Desk</div>
                    <div class="text-[12px] text-muted-foreground mb-3">v1.5.0</div>
                    <Separator class="w-[60%]" />
                    <div class="text-[12.5px] text-muted-foreground leading-relaxed max-w-[400px] mx-auto mt-3">A transparent, always-on-top animated robot that lives on your desktop and reacts to events from AI coding agents via HTTP webhooks.</div>
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
        </Tabs>
      </SidebarInset>
    </SidebarProvider>

    <!-- Sonner toast portal — renders feedback toasts at top-center -->
    <!-- Footer status toast -->
    <footer v-if="status" class="fixed left-1/2 bottom-6 -translate-x-1/2 inline-flex items-center gap-2 py-2 px-4 text-[12px] text-foreground bg-card/90 border border-border rounded-full shadow-xl shadow-black/40 backdrop-blur-xl z-50 animate-toast-in">
      <span class="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_6px_var(--primary)]" />
      {{ status }}
    </footer>
  </TooltipProvider>
</template>
