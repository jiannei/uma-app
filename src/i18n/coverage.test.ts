import { describe, it, expect } from "vitest";
import en from "./locales/en.json";
import zh from "./locales/zh.json";

function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out.push(key);
    else if (v && typeof v === "object") out.push(...flatten(v as Record<string, unknown>, key));
  }
  return out;
}

describe("i18n coverage", () => {
  const enKeys = flatten(en).sort();
  const zhKeys = flatten(zh).sort();

  it("zh has every key that en has", () => {
    const missing = enKeys.filter((k) => !zhKeys.includes(k));
    expect(missing, `zh.json is missing keys: ${missing.join(", ")}`).toEqual([]);
  });

  it("en has every key that zh has", () => {
    const extra = zhKeys.filter((k) => !enKeys.includes(k));
    expect(extra, `en.json has no entry for: ${extra.join(", ")}`).toEqual([]);
  });

  it("has at least 10 keys in the bubble namespace", () => {
    const bubbleKeys = enKeys.filter((k) => k.startsWith("bubble."));
    expect(bubbleKeys.length).toBeGreaterThanOrEqual(10);
  });
});