/**
 * Source providers: where repositories come from.
 *
 * The configuration card picks one provider per user. Everything that talks
 * to the source host (discovery, existence checks, clone credentials) goes
 * through the SourceProvider built here, so the mirror pipeline does not need
 * to know which host it is dealing with.
 */
import type { Config, Repository } from "@/lib/db/schema";
import { getDecryptedSourceToken } from "@/lib/utils/config-encryption";
import {
  decryptSourceToken,
  findSourceForRepository,
  type SourceRecord,
} from "@/lib/sources";
import { HuggingFaceSourceProvider } from "./huggingface";
import {
  describeSource,
  getRepositorySource,
  isRepositoryFromConfiguredSource,
  normalizeSourceProviderKind,
  normalizeSourceUrl,
  type RepositorySourceFields,
  type SourceProviderKind,
} from "./kinds";
import type { SourceConnection, SourceProvider } from "./types";

export * from "./kinds";
export type * from "./types";
export { SourceApiError, isSourceNotFound } from "./http";

export function resolveSourceProviderKind(
  config: Partial<Config> | null | undefined
): SourceProviderKind {
  return normalizeSourceProviderKind(config?.sourceConfig?.provider);
}

/** Build the connection details for a config. The token is passed in decrypted. */
export function resolveSourceConnection(
  config: Partial<Config>,
  { token = "", userId }: { token?: string; userId?: string } = {}
): SourceConnection {
  const provider = resolveSourceProviderKind(config);
  return {
    provider,
    url: normalizeSourceUrl(config.sourceConfig?.url, provider),
    username: config.sourceConfig?.owner ?? "",
    token,
    userId: userId ?? config.userId,
  };
}

export function createSourceProvider(connection: SourceConnection): SourceProvider {
  if (connection.provider !== "huggingface") throw new Error("HF-mirror supports Hugging Face sources only");
  return new HuggingFaceSourceProvider(connection);
}

/** Build the provider for a stored config, decrypting the token. */
export function createSourceProviderFromConfig(
  config: Partial<Config>,
  { userId }: { userId?: string } = {}
): SourceProvider {
  const token = config.sourceConfig?.token ? getDecryptedSourceToken(config as Config) : "";
  return createSourceProvider(resolveSourceConnection(config, { token, userId }));
}

/** Build the connection details for a stored source row. The token is decrypted. */
export function sourceConnectionFromSource(
  source: SourceRecord,
  { userId }: { userId?: string } = {}
): SourceConnection {
  return {
    provider: source.provider,
    url: source.url,
    username: source.username,
    token: decryptSourceToken(source.token),
    userId: userId ?? source.userId,
  };
}

/** Build the provider for a stored source row, decrypting its token. */
export function createSourceProviderFromSource(
  source: SourceRecord,
  { userId }: { userId?: string } = {}
): SourceProvider {
  return createSourceProvider(sourceConnectionFromSource(source, { userId }));
}

export function assertRepositoryMatchesConfiguredSource({
  repository,
  config,
}: {
  repository: Pick<Repository, "fullName"> & RepositorySourceFields;
  config: Partial<Config>;
}): void {
  const connection = resolveSourceConnection(config);
  if (isRepositoryFromConfiguredSource(repository, connection)) return;

  throw new Error(
    `Repository ${repository.fullName} was imported from ${describeSource(
      getRepositorySource(repository)
    )} but the configured source is ${describeSource(connection)}. ` +
      "Switch the source back, or remove the repository and add it again from the current source."
  );
}

/**
 * Multi-source form of assertRepositoryMatchesConfiguredSource: refuse a
 * repository whose host matches none of the connected source rows. The
 * credentials of the matched source are the ones the pipeline must use.
 */
export function assertRepositoryMatchesConnectedSource({
  repository,
  sources,
}: {
  repository: Pick<Repository, "fullName"> & RepositorySourceFields & { sourceId?: string | null };
  sources: SourceRecord[];
}): void {
  const matched = findSourceForRepository(repository, sources);
  if (matched && matched.enabled !== false) return;

  const connected = sources.length
    ? sources.map((source) => describeSource(source)).join(", ")
    : "no source";
  throw new Error(
    `Repository ${repository.fullName} was imported from ${describeSource(
      getRepositorySource(repository)
    )} but the connected sources are ${connected}. ` +
      "Add a source for that host, or remove the repository and add it again from a connected source."
  );
}
