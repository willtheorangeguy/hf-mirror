import { describe, expect, test } from "bun:test";
import {
  computeConfigLocks,
  evaluateConfigChange,
  hasDestinationChanged,
  hasSourceChanged,
  loadConfigLocks,
  normalizeDestinationUrl,
  sourceIdentity,
} from "./config-locks";

describe("computeConfigLocks", () => {
  test("locks the source once anything is imported and the destination once anything is mirrored", () => {
    expect(computeConfigLocks({ repositoryCount: 0, mirroredCount: 0 })).toEqual({
      source: { locked: false, repositoryCount: 0 },
      destination: { locked: false, mirroredCount: 0 },
    });
    expect(computeConfigLocks({ repositoryCount: 3, mirroredCount: 0 })).toMatchObject({
      source: { locked: true },
      destination: { locked: false },
    });
    expect(computeConfigLocks({ repositoryCount: 3, mirroredCount: 1 }).destination.locked).toBe(true);
  });
});

describe("hasSourceChanged", () => {
  test("missing provider and URL use the public Hugging Face endpoint", () => {
    expect(hasSourceChanged({}, { provider: "huggingface", url: "https://huggingface.co" })).toBe(false);
    expect(hasSourceChanged({ provider: "huggingface" }, { provider: "huggingface", url: "" })).toBe(false);
  });

  test("cosmetic URL edits are not a change, another host is", () => {
    expect(
      hasSourceChanged(
        { provider: "huggingface", url: "https://hf.example.com" },
        { provider: "huggingface", url: "HF.example.com/" }
      )
    ).toBe(false);
    expect(hasSourceChanged({ provider: "huggingface" }, { provider: "huggingface", url: "https://hf.example.com" })).toBe(true);
    expect(hasSourceChanged({ provider: "huggingface" }, { provider: "huggingface", url: "https://hf.example.com" })).toBe(true);
  });

  test("sourceIdentity defaults to huggingface.co and preserves a custom endpoint", () => {
    expect(sourceIdentity({ provider: "huggingface", url: "https://hf.example.com" })).toEqual({
      provider: "huggingface",
      url: "https://hf.example.com",
    });
    expect(sourceIdentity({ provider: "huggingface" })).toEqual({
      provider: "huggingface",
      url: "https://huggingface.co",
    });
    expect(hasSourceChanged(
      { provider: "huggingface", url: "https://hf1.example.com" },
      { provider: "huggingface", url: "https://hf2.example.com" }
    )).toBe(true);
  });
});

describe("hasDestinationChanged", () => {
  test("ignores trailing slashes and host case, and never fires while a side is empty", () => {
    expect(hasDestinationChanged("https://Gitea.example.com/", "https://gitea.example.com")).toBe(false);
    expect(hasDestinationChanged("https://gitea.example.com", "https://other.example.com")).toBe(true);
    expect(hasDestinationChanged("", "https://gitea.example.com")).toBe(false);
    expect(hasDestinationChanged("https://gitea.example.com", "")).toBe(false);
    expect(normalizeDestinationUrl(" https://gitea.example.com/gitea// ")).toBe("https://gitea.example.com/gitea");
  });
});

describe("evaluateConfigChange", () => {
  const locked = computeConfigLocks({ repositoryCount: 12, mirroredCount: 4 });
  const unlocked = computeConfigLocks({ repositoryCount: 0, mirroredCount: 0 });
  const base = {
    existingSource: { provider: "huggingface" },
    incomingSource: { provider: "huggingface", url: "" },
    existingDestinationUrl: "https://gitea.example.com",
    incomingDestinationUrl: "https://gitea.example.com",
  };

  test("an unchanged save always passes", () => {
    expect(evaluateConfigChange({ locks: locked, ...base })).toEqual({ ok: true });
  });

  test("everything passes while nothing is imported", () => {
    expect(
      evaluateConfigChange({
        locks: unlocked,
        ...base,
        incomingSource: { provider: "huggingface", url: "https://hf.example.com" },
        incomingDestinationUrl: "https://other.example.com",
      })
    ).toEqual({ ok: true });
  });

  test("a locked source refuses an endpoint change without confirmation and names both hosts", () => {
    const verdict = evaluateConfigChange({
      locks: locked,
      ...base,
      incomingSource: { provider: "huggingface", url: "https://hf.example.com" },
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.lock).toBe("source");
    expect(verdict.message).toContain("12 repositories were imported from Hugging Face (https://huggingface.co)");
    expect(verdict.message).toContain("Hugging Face (https://hf.example.com)");
  });

  test("the confirm flag lets a locked source change through", () => {
    expect(
      evaluateConfigChange({
        locks: locked,
        ...base,
        incomingSource: { provider: "huggingface", url: "https://hf.example.com" },
        confirmSourceChange: true,
      })
    ).toEqual({ ok: true });
  });

  test("a locked destination refuses a server URL change without confirmation", () => {
    const verdict = evaluateConfigChange({
      locks: locked,
      ...base,
      incomingDestinationUrl: "https://other.example.com/",
    });
    expect(verdict).toMatchObject({ ok: false, lock: "destination" });
    if (verdict.ok) return;
    expect(verdict.message).toContain("4 repositories are mirrored to https://gitea.example.com");

    expect(
      evaluateConfigChange({
        locks: locked,
        ...base,
        incomingDestinationUrl: "https://other.example.com/",
        confirmDestinationChange: true,
      })
    ).toEqual({ ok: true });
  });

  test("the source is reported before the destination when both change", () => {
    const verdict = evaluateConfigChange({
      locks: locked,
      ...base,
      incomingSource: { provider: "huggingface", url: "https://hf.example.com" },
      incomingDestinationUrl: "https://other.example.com",
    });
    expect(verdict).toMatchObject({ ok: false, lock: "source" });
  });
});

describe("loadConfigLocks", () => {
  test("resolves to unlocked when the database layer misbehaves", async () => {
    // The global test setup stubs @/lib/db with a select chain that never
    // yields rows, so the count cannot be read. That must not throw.
    expect(await loadConfigLocks("user-1")).toEqual({
      source: { locked: false, repositoryCount: 0 },
      destination: { locked: false, mirroredCount: 0 },
    });
  });
});
