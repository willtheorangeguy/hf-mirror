
export const DESTINATION_PROVIDER_KINDS = ["gitea", "forgejo"] as const;

export type DestinationProviderKind = (typeof DESTINATION_PROVIDER_KINDS)[number];

/** Destinations that receive mirrors through the push engine. */
export const PUSH_DESTINATION_KINDS = ["gitea", "forgejo"] as const;

export type PushDestinationKind = (typeof PUSH_DESTINATION_KINDS)[number];

export const DEFAULT_DESTINATION_PROVIDER: DestinationProviderKind = "gitea";

/** Destinations other than Gitea are beta: they work end to end but have had less time in the field. */
export function isBetaDestinationProvider(kind: DestinationProviderKind): boolean {
  return kind !== DEFAULT_DESTINATION_PROVIDER;
}

export const DESTINATION_PROVIDER_LABELS: Record<DestinationProviderKind, string> = {
  gitea: "Gitea",
  forgejo: "Forgejo",
};

/** Base URL used when the config has no URL for a hosted destination. */
export const DESTINATION_PROVIDER_DEFAULT_URLS: Partial<Record<DestinationProviderKind, string>> = {
};

/** What the host calls a group of repositories owned by a team. */
export const DESTINATION_PROVIDER_ORG_NOUNS: Record<DestinationProviderKind, string> = {
  gitea: "organization",
  forgejo: "organization",
};

/** Token scopes a push target needs, for the settings hint. */
export const PUSH_DESTINATION_TOKEN_SCOPES: Record<PushDestinationKind, string[]> = {
  gitea: ["write:repository", "write:organization"],
  forgejo: ["write:repository", "write:organization"],
};

export function isDestinationProviderKind(value: unknown): value is DestinationProviderKind {
  return (
    typeof value === "string" &&
    (DESTINATION_PROVIDER_KINDS as readonly string[]).includes(value)
  );
}

export function isPushDestinationKind(value: unknown): value is PushDestinationKind {
  return (
    typeof value === "string" && (PUSH_DESTINATION_KINDS as readonly string[]).includes(value)
  );
}

/** Coerce an untrusted value to a destination kind, defaulting to Gitea. Codeberg is Forgejo. */
export function normalizeDestinationProviderKind(value: unknown): DestinationProviderKind {
  if (isDestinationProviderKind(value)) return value;
  if (value === "codeberg") return "forgejo";
  return DEFAULT_DESTINATION_PROVIDER;
}

/**
 * Normalize a destination URL: trim, add https:// when the scheme is
 * missing, lowercase the host, drop trailing slashes. A hosted push target
 * with an empty URL falls back to its public instance; Gitea and Forgejo
 * have no default and stay empty.
 */
export function normalizeDestinationBaseUrl(
  raw: string | null | undefined,
  provider: DestinationProviderKind
): string {
  const fallback = DESTINATION_PROVIDER_DEFAULT_URLS[provider] ?? "";
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return fallback;

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

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

/** The two columns a stored repository carries about where its mirror lives. */
export interface RepositoryDestinationFields {
  destinationProvider?: string | null;
  destinationUrl?: string | null;
}

export interface RepositoryDestination {
  provider: DestinationProviderKind;
  url: string;
}

/** Where a stored repository's mirror lives. Rows from before the column default to Gitea. */
export function getRepositoryDestination(repo: RepositoryDestinationFields): RepositoryDestination {
  const provider = normalizeDestinationProviderKind(repo.destinationProvider);
  return { provider, url: normalizeDestinationBaseUrl(repo.destinationUrl, provider) };
}

/**
 * True when the row's mirror lives on the configured destination. A row
 * without a recorded URL predates the column (or was never mirrored) and is
 * accepted: the Gitea path then finds or creates the mirror as before.
 */
export function isRepositoryOnConfiguredDestination(
  repo: RepositoryDestinationFields,
  destination: RepositoryDestination
): boolean {
  const recordedUrl = typeof repo.destinationUrl === "string" ? repo.destinationUrl.trim() : "";
  if (!recordedUrl) return true;
  const recorded = getRepositoryDestination(repo);
  return (
    isPushDestinationKind(recorded.provider) === isPushDestinationKind(destination.provider) &&
    recorded.url.toLowerCase() === destination.url.toLowerCase()
  );
}

export function describeDestination(destination: RepositoryDestination): string {
  return `${DESTINATION_PROVIDER_LABELS[destination.provider]} (${destination.url || "no URL"})`;
}

/** Host name of a destination URL, for display and for the clone directory layout. */
export function destinationHostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}
