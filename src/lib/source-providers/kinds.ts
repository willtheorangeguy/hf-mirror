/**
 * The source hosts HF-mirror can pull repositories from.
 *
 * Kept free of imports so both server code and client components can use it.
 */
export const SOURCE_PROVIDER_KINDS = ["huggingface"] as const;

export type SourceProviderKind = (typeof SOURCE_PROVIDER_KINDS)[number];

export const DEFAULT_SOURCE_PROVIDER: SourceProviderKind = "huggingface";

export function isBetaSourceProvider(kind: SourceProviderKind): boolean {
  return kind !== DEFAULT_SOURCE_PROVIDER;
}

export const RELEASE_CAPABLE_SOURCE_KINDS: readonly SourceProviderKind[] = [];

export function sourceKindSupportsReleases(kind: unknown): boolean {
  return (RELEASE_CAPABLE_SOURCE_KINDS as readonly string[]).includes(
    normalizeSourceProviderKind(kind)
  );
}

/** Base URL used when the config has no instance URL for the provider. */
export const SOURCE_PROVIDER_DEFAULT_URLS: Record<SourceProviderKind, string> = {
  huggingface: "https://huggingface.co",
};

export const SOURCE_PROVIDER_LABELS: Record<SourceProviderKind, string> = {
  huggingface: "Hugging Face",
};

/** What the host calls a group of repositories owned by a team. */
export const SOURCE_PROVIDER_ORG_NOUNS: Record<SourceProviderKind, string> = {
  huggingface: "organization",
};

export function isSourceProviderKind(value: unknown): value is SourceProviderKind {
  return (
    typeof value === "string" &&
    (SOURCE_PROVIDER_KINDS as readonly string[]).includes(value)
  );
}

export function isValidSourceOrgName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && !trimmed.includes("/");
}

export function normalizeSourceProviderKind(value: unknown): SourceProviderKind {
  if (isSourceProviderKind(value)) return value;
  return DEFAULT_SOURCE_PROVIDER;
}

/**
 * Normalize an instance URL: trim, add https:// when the scheme is missing,
 * lowercase the host, drop trailing slashes. Falls back to the provider's
 * default when the value is empty or unparseable.
 */
export function normalizeSourceUrl(
  raw: string | null | undefined,
  provider: SourceProviderKind
): string {
  const fallback = SOURCE_PROVIDER_DEFAULT_URLS[provider];
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return fallback;

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return fallback;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return fallback;
  }

  const path = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.host}${path}`;
}

/** True when the URL parses as an http(s) URL. Used by config validation. */
export function isValidSourceUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Hostname of a normalized source URL, for comparing pasted repository URLs. */
export function sourceHostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

/** The two columns a stored repository carries about its origin. */
export interface RepositorySourceFields {
  sourceProvider?: string | null;
  sourceUrl?: string | null;
}

export interface RepositorySource {
  provider: SourceProviderKind;
  url: string;
}

export function getRepositorySource(repo: RepositorySourceFields): RepositorySource {
  const provider = normalizeSourceProviderKind(repo.sourceProvider);
  return { provider, url: normalizeSourceUrl(repo.sourceUrl, provider) };
}

export function isRepositoryFromConfiguredSource(
  repo: RepositorySourceFields,
  connection: RepositorySource
): boolean {
  const source = getRepositorySource(repo);
  return source.provider === connection.provider && source.url === connection.url;
}

export function describeSource(source: RepositorySource): string {
  return `${SOURCE_PROVIDER_LABELS[source.provider]} (${source.url})`;
}
