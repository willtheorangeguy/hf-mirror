import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { db } from "./db";
import { giteaConfigSchema, repositorySchema, sourceConfigSchema } from "./db/schema";
import { getGiteaRepoOwner, getGiteaRepoOwnerAsync } from "./destination-api";
import { mapDbToUiConfig, mapUiToDbConfig } from "./utils/config-mapper";

const config = {
  userId: "user-1",
  sourceConfig: sourceConfigSchema.parse({ owner: "alice", type: "personal", token: "" }),
  giteaConfig: giteaConfigSchema.parse({ url: "https://forge.example", token: "", defaultOwner: "me", hfReposOrg: "hf-backups" }),
};
const repository = repositorySchema.parse({
  id: "repo-1", userId: "user-1", configId: "config-1", name: "model", fullName: "alice/model",
  normalizedFullName: "alice/model", owner: "alice", sourceProvider: "huggingface", repoType: "model",
  url: "https://huggingface.co/alice/model", cloneUrl: "https://huggingface.co/alice/model.git",
  defaultBranch: "main", importedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
});

describe("HF destination organization", () => {
  test("routes every repository type and likes to the configured organization on either forge", () => {
    for (const provider of ["gitea", "forgejo"] as const) {
      for (const repoType of ["model", "dataset", "space"] as const) {
        for (const isStarred of [true, false]) {
          expect(getGiteaRepoOwner({
            config: { ...config, giteaConfig: { ...config.giteaConfig, provider } },
            repository: { ...repository, repoType, isStarred, organization: "source-org" },
          })).toBe("hf-backups");
        }
      }
    }
  });

  test("explicit repository overrides take priority, including liked repositories", () => {
    expect(getGiteaRepoOwner({ config, repository: { ...repository, isStarred: true, destinationOrg: "special" } })).toBe("special");
  });

  test("clearing the organization restores the existing strategy and liked destination", () => {
    const cleared = { ...config, giteaConfig: { ...config.giteaConfig, hfReposOrg: "  " } };
    expect(getGiteaRepoOwner({ config: cleared, repository })).toBe("me");
    expect(getGiteaRepoOwner({ config: cleared, repository: { ...repository, organization: "source-org" } })).toBe("source-org");
    expect(getGiteaRepoOwner({ config: cleared, repository: { ...repository, isStarred: true } })).toBe("liked");
  });

  test("round trips the setting through config saves and preserves it for older clients", () => {
    const ui = mapDbToUiConfig(config);
    const save = (hfReposOrg: string | undefined) => mapUiToDbConfig(
      ui.sourceConfig, { ...ui.giteaConfig, hfReposOrg }, ui.mirrorOptions, ui.advancedOptions, config,
    );
    expect(ui.giteaConfig.hfReposOrg).toBe("hf-backups");
    expect(save("  my-models  ").giteaConfig.hfReposOrg).toBe("my-models");
    expect(save(undefined).giteaConfig.hfReposOrg).toBe("hf-backups");
    expect(save("").giteaConfig.hfReposOrg).toBe("");
    expect(mapDbToUiConfig(save("")).giteaConfig.hfReposOrg).toBe("");
  });

  test("accepts organization names and normalizes whitespace", () => {
    const schema = giteaConfigSchema.shape.hfReposOrg;
    expect(schema.parse("  HF-models_1.0  ")).toBe("HF-models_1.0");
    expect(schema.parse("   ")).toBe("");
    expect(schema.parse(undefined)).toBeUndefined();
  });
});

describe("source organization override", () => {
  afterEach(() => { selectSpy?.mockRestore(); });
  let selectSpy: ReturnType<typeof spyOn> | undefined;

  test("an organization's explicit destination wins over the HF default", async () => {
    selectSpy = spyOn(db, "select").mockReturnValue({
      from: () => ({ where: () => ({ limit: async () => [{ destinationOrg: "pinned-org" }] }) }),
    } as any);
    expect(await getGiteaRepoOwnerAsync({ config, repository: { ...repository, organization: "source-org" } })).toBe("pinned-org");
  });

  test("an organization without an override inherits the HF default", async () => {
    expect(await getGiteaRepoOwnerAsync({ config, repository: { ...repository, organization: "source-org" } })).toBe("hf-backups");
  });
});
