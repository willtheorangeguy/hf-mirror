import { expect, test } from "bun:test";
import { hfMarker, isHFDestinationRepository } from "./hf-identity";
import { findSourceForRepository, type SourceRecord } from "./sources";
import { clonePathForRepository } from "./push-engine/paths";

const model = { sourceUrl: "https://huggingface.co", repoType: "model", fullName: "alice/same" };
const source = (id: string, url: string): SourceRecord => ({ id, userId: "u", name: "HF", provider: "huggingface", url, username: "alice", token: null, enabled: true, createdAt: new Date(), updatedAt: new Date() });

test("destination ownership includes host and repository type", () => {
  const candidate = { description: `${hfMarker(model)} https://huggingface.co/alice/same`, mirror: false };
  expect(isHFDestinationRepository(candidate, model)).toBe(true);
  expect(isHFDestinationRepository(candidate, { ...model, repoType: "dataset" })).toBe(false);
  expect(isHFDestinationRepository(candidate, { ...model, sourceUrl: "https://private.example" })).toBe(false);
  expect(isHFDestinationRepository({ ...candidate, mirror: true }, model)).toBe(false);
});

test("a source id moved to another host cannot supply credentials for the old host", () => {
  const repository = { sourceId: "moved", sourceProvider: "huggingface", sourceUrl: "https://huggingface.co" };
  expect(findSourceForRepository(repository, [source("moved", "https://private.example")])).toBeNull();
  const correct = source("correct", "https://huggingface.co");
  expect(findSourceForRepository(repository, [source("moved", "https://private.example"), correct])?.id).toBe("correct");
});

test("working clone paths isolate repository types and source connections", () => {
  const repository = { owner: "alice", name: "same", repoType: "model", sourceId: "source-1", sourceUrl: "https://huggingface.co", sourceProvider: "huggingface" };
  expect(clonePathForRepository(repository)).not.toBe(clonePathForRepository({ ...repository, repoType: "dataset" }));
  expect(clonePathForRepository(repository)).not.toBe(clonePathForRepository({ ...repository, sourceId: "source-2" }));
});
