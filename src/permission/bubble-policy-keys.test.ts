import { describe, it, expect } from "vitest";
import en from "../i18n/locales/en.json";
import zh from "../i18n/locales/zh.json";

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce((o: any, k) => (o ? o[k] : undefined), obj);
}

describe("bubble-policy i18n keys", () => {
  it("requestTimedOut is present in en + zh", () => {
    expect(get(en, "bubble.requestTimedOut")).toBeTruthy();
    expect(get(zh, "bubble.requestTimedOut")).toBeTruthy();
  });

  it("errorOccurred is present in en + zh", () => {
    expect(get(en, "bubble.errorOccurred")).toBeTruthy();
    expect(get(zh, "bubble.errorOccurred")).toBeTruthy();
  });

  it("settings.language + language options present in en + zh", () => {
    expect(get(en, "settings.language")).toBeTruthy();
    expect(get(en, "settings.languageEn")).toBeTruthy();
    expect(get(en, "settings.languageZh")).toBeTruthy();
    expect(get(zh, "settings.language")).toBeTruthy();
    expect(get(zh, "settings.languageEn")).toBeTruthy();
    expect(get(zh, "settings.languageZh")).toBeTruthy();
  });

  it("bubble-policy UI text keys (plan feedback) present in both locales", () => {
    expect(get(en, "bubble.tellClaudeToChange")).toBeTruthy();
    expect(get(zh, "bubble.tellClaudeToChange")).toBeTruthy();
    expect(get(en, "bubble.feedbackPlaceholder")).toBeTruthy();
    expect(get(zh, "bubble.feedbackPlaceholder")).toBeTruthy();
  });
});