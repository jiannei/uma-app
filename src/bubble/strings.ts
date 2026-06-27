// src/bubble/strings.ts — i18n table for the permission bubble UI.
//
// ADR-0017 收敛版：删了 ADR-0015 阶段加入的 `permissionTimeout` (5min alarm
// banner 已撤回，Q6 改静默 deny) + 各种 rejectWithFeedback/previousQuestion/
// questionProgress 等 ask 底部按钮文案 (Q4 砍底部 Next/Submit，只剩 Back)。
//
// Strings use `{name}` placeholders for runtime substitution.
// `bubbleText(lang, key, vars?)` does the lookup + replacement.

export type Lang = "en" | "zh";

type Strings = Record<string, string>;

export const BUBBLE_STRINGS: Record<Lang, Strings> = {
  en: {
    // Generic / chrome
    permissionRequest: "Permission Request",

    // SideEffect buttons (pill)
    allow: "Allow",
    deny: "Deny",

    // Suggestion labels (CC permission_suggestions[])
    autoAcceptEdits: "Auto-accept edits",
    switchToPlanMode: "Switch to plan mode",
    setMode: "Set mode: {mode}",
    alwaysAllow: "Always allow",
    alwaysAllowRule: "Always allow `{rule}`",
    allowInDir: "Always allow {tool} in {dir}/",
    alwaysAllowDeny: "Always deny {tool}",
    alwaysAllowDenyInDir: "Always deny {tool} in {dir}/",
    addAllowedDirectories: "Add allowed directories",
    removeAllowedDirs: "Remove allowed dirs",
    applySuggestion: "Apply suggestion",

    // Elicitation (AskUserQuestion)
    questionCount: "Q{current}/{total}",
    chooseOneOption: "Choose one option",
    chooseAtLeastOneOption: "Multi-select, choose at least one",
    other: "Other",
    otherPlaceholder: "Type your answer…",

    // PlanReview (ExitPlanMode)
    approve: "Approve",
    reject: "Reject",
    feedbackLabel: "Tell Claude what to change (optional)",
    feedbackPlaceholder:
      "e.g. use a migration tool, not a hand-rolled schema",
    noPlanContent: "(no plan content)",
  },
  zh: {
    // Generic / chrome
    permissionRequest: "权限请求",

    // SideEffect buttons (pill)
    allow: "批准",
    deny: "拒绝",

    // Suggestion labels
    autoAcceptEdits: "自动接受编辑",
    switchToPlanMode: "切换到 Plan 模式",
    setMode: "设置模式: {mode}",
    alwaysAllow: "始终允许",
    alwaysAllowRule: "始终允许 `{rule}`",
    allowInDir: "始终允许 {tool} 在 {dir}/",
    alwaysAllowDeny: "始终拒绝 {tool}",
    alwaysAllowDenyInDir: "始终拒绝 {tool} 在 {dir}/",
    addAllowedDirectories: "添加允许的目录",
    removeAllowedDirs: "移除允许的目录",
    applySuggestion: "应用建议",

    // Elicitation
    questionCount: "Q{current}/{total}",
    chooseOneOption: "请选择一项",
    chooseAtLeastOneOption: "可多选，至少选择一项",
    other: "其他",
    otherPlaceholder: "输入你的回答…",

    // PlanReview
    approve: "批准",
    reject: "拒绝",
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
