// src/bubble/strings.ts — i18n table for the permission bubble UI.
//
// v1.1 ships en + zh only (per ADR-0011 v1 scope). Three further
// languages (zh-TW / ko / ja) live in uma-pet upstream and can be
// ported when needed; the BUBBLE_STRINGS structure preserves the
// key names so the port is mechanical.
//
// Strings use `{name}` placeholders for runtime substitution.
// `bubbleText(lang, key, vars?)` does the lookup + replacement.

export type Lang = "en" | "zh";

type Strings = Record<string, string>;

export const BUBBLE_STRINGS: Record<Lang, Strings> = {
  en: {
    // ── Generic / chrome ─────────────────────────────────
    waiting: "Waiting for permission request…",
    permissionRequest: "Permission Request",
    // ADR-0013 决策 8: 5min 超时反馈（橙色"⏰ 已超时"）
    permissionTimeout: "Timed out (5 min)",

    // ── SideEffect buttons ──────────────────────────────
    allow: "Allow",
    deny: "Deny",
    toolPill: "ExitPlanMode",

    // ── Suggestion labels (CC permission_suggestions[]) ─
    autoAcceptEdits: "Auto-accept edits",
    switchToPlanMode: "Switch to plan mode",
    setMode: "Set mode: {mode}",
    alwaysAllow: "Always allow",
    alwaysAllowBlanket: "Always Allow (blanket)",
    alwaysAllowRule: "Always allow `{rule}`",
    allowInDir: "Always allow {tool} in {dir}/",
    alwaysAllowDeny: "Always deny {tool}",
    alwaysAllowDenyInDir: "Always deny {tool} in {dir}/",
    addAllowedDirectories: "Add allowed directories",
    removeAllowedDirs: "Remove allowed dirs",
    replacePermissionRules: "Replace permission rules",
    removePermissionRules: "Remove permission rules",
    applySuggestion: "Apply suggestion",

    // ── Elicitation (AskUserQuestion) ──────────────────
    needsInput: "{agent} needs input",
    previousQuestion: "Back",
    nextQuestion: "Next",
    submitAnswer: "Submit",
    questionProgress: "{current} / {total}",
    chooseOneOption: "Choose one option",
    chooseAtLeastOneOption: "Multi-select, choose at least one",
    questionLabel: "Question {index}",
    other: "Other",
    otherPlaceholder: "Type your answer…",

    // ── PlanReview (ExitPlanMode) ────────────────────────
    planReview: "Plan Review",
    approve: "Approve",
    reject: "Reject",
    rejectWithFeedback: "Reject with feedback",
    feedbackLabel: "Tell Claude what to change (optional)",
    feedbackPlaceholder:
      "e.g. use a migration tool, not a hand-rolled schema",
    noPlanContent: "(no plan content)",
  },
  zh: {
    // ── Generic / chrome ─────────────────────────────────
    waiting: "等待权限请求…",
    permissionRequest: "权限请求",
    // ADR-0013 决策 8: 5min 超时反馈
    permissionTimeout: "已超时（5 分钟）",

    // ── SideEffect buttons ──────────────────────────────
    allow: "批准",
    deny: "拒绝",
    toolPill: "退出 Plan 模式",

    // ── Suggestion labels ────────────────────────────────
    autoAcceptEdits: "自动接受编辑",
    switchToPlanMode: "切换到 Plan 模式",
    setMode: "设置模式: {mode}",
    alwaysAllow: "始终允许",
    alwaysAllowBlanket: "始终允许（通配）",
    alwaysAllowRule: "始终允许 `{rule}`",
    allowInDir: "始终允许 {tool} 在 {dir}/",
    alwaysAllowDeny: "始终拒绝 {tool}",
    alwaysAllowDenyInDir: "始终拒绝 {tool} 在 {dir}/",
    addAllowedDirectories: "添加允许的目录",
    removeAllowedDirs: "移除允许的目录",
    replacePermissionRules: "替换权限规则",
    removePermissionRules: "移除权限规则",
    applySuggestion: "应用建议",

    // ── Elicitation ──────────────────────────────────────
    needsInput: "{agent} 需要输入",
    previousQuestion: "上一步",
    nextQuestion: "下一步",
    submitAnswer: "提交回答",
    questionProgress: "{current} / {total}",
    chooseOneOption: "请选择一项",
    chooseAtLeastOneOption: "可多选，至少选择一项",
    questionLabel: "问题 {index}",
    other: "其他",
    otherPlaceholder: "输入你的回答…",

    // ── PlanReview ───────────────────────────────────────
    planReview: "计划审查",
    approve: "批准",
    reject: "拒绝",
    rejectWithFeedback: "带反馈拒绝",
    feedbackLabel: "告诉 Claude 哪里需要改（可选）",
    feedbackPlaceholder: "例如：使用 migration 工具",
    noPlanContent: "（无计划内容）",
  },
};

/** Look up a string for the given language, substituting `{name}`
 * placeholders with values from `vars`. Falls back to English if
 * the key is missing in the requested language. */
export function bubbleText(
  lang: Lang,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const dict = BUBBLE_STRINGS[lang] ?? BUBBLE_STRINGS.en;
  let template = dict[key] ?? BUBBLE_STRINGS.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      template = template.split(`{${k}}`).join(String(v));
    }
  }
  return template;
}