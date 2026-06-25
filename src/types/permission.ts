// src/types/permission.ts — TypeScript mirror of the Rust canonical
// `PermissionRequest` discriminated union and its decision shape
// (ADR-0011). Shared by:
//   - src/bubble/* — frontend permission bubble
//   - src/devtools/* — dev-tools panel (PendingStore view)
//
// Wire-format field names use camelCase, matching the Rust
// `#[serde(rename_all = "camelCase")]` on `PermissionBase` and the
// per-field `#[serde(rename = "...")]` overrides on the 3 variant
// structs. The `kind` discriminator is PascalCase (`SideEffect` /
// `Elicitation` / `PlanReview`) per `#[serde(rename_all =
// "PascalCase")]` on the `PermissionKind` enum.

export type Destination =
  | "session"
  | "localSettings"
  | "projectSettings"
  | "userSettings";

export type RuleBehavior = "allow" | "deny" | "ask";

export type PermissionMode =
  | "default"
  | "auto"
  | "acceptEdits"
  | "dontAsk"
  | "bypassPermissions"
  | "plan";

export type RuleSpec = {
  toolName: string;
  ruleContent?: string;
};

export type PermissionUpdateEntry =
  | {
      type: "addRules";
      rules: RuleSpec[];
      behavior: RuleBehavior;
      destination: Destination;
    }
  | {
      type: "replaceRules";
      rules: RuleSpec[];
      behavior: RuleBehavior;
      destination: Destination;
    }
  | {
      type: "removeRules";
      rules: RuleSpec[];
      behavior: RuleBehavior;
      destination: Destination;
    }
  | {
      type: "setMode";
      mode: PermissionMode;
      destination: Destination;
    }
  | {
      type: "addDirectories";
      directories: string[];
      destination: Destination;
    }
  | {
      type: "removeDirectories";
      directories: string[];
      destination: Destination;
    };

export type ElicitationOption = {
  label: string;
  description?: string;
  preview?: string;
};

export type ElicitationQuestion = {
  question: string;
  header: string;
  multiSelect: boolean;
  options: ElicitationOption[];
};

interface Base {
  requestId: string;
  sessionId: string;
  agent: string;
  agentDisplayName: string;
  cwd?: string;
}

export type SideEffectRequest = Base & {
  kind: "SideEffect";
  toolName?: string;
  toolInput?: unknown;
  permissionSuggestions: PermissionUpdateEntry[];
};

export type ElicitationRequest = Base & {
  kind: "Elicitation";
  toolName: string;
  toolInput?: unknown;
  questions: ElicitationQuestion[];
};

export type PlanReviewRequest = Base & {
  kind: "PlanReview";
  toolName: string;
  toolInput?: unknown;
  planContent?: string;
};

export type PermissionRequest =
  | SideEffectRequest
  | ElicitationRequest
  | PlanReviewRequest;

export type DecisionBehavior = "allow" | "deny";

/** Decision the bubble sends back to the canonical `respond_permission`
 * Tauri command. Field names use camelCase to match
 * `PermissionDecision`'s `#[serde(rename_all = "camelCase")]`. */
export type PermissionDecision = {
  requestId: string;
  behavior: DecisionBehavior;
  message?: string;
  interrupt?: boolean;
  updatedInput?: unknown;
  updatedPermissions?: PermissionUpdateEntry[];
};
