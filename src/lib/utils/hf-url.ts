export interface RepoReferenceParts { host: string | null; segments: string[] }

export function parseRepoReferenceParts(input: string): RepoReferenceParts | null {
  let value = input.trim().replace(/^<|>$/g, "");
  if (!value) return null;
  let host: string | null = null;
  if (/^https?:\/\//i.test(value) || /^[^/\s]+\.[^/\s]+\//.test(value)) {
    try {
      const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
      if (url.username || url.password) return null;
      host = url.host.toLowerCase(); value = url.pathname;
    } catch { return null; }
  } else if (value.includes(":") || value.includes("@")) return null;
  const segments = value.split("/").filter(Boolean);
  return segments.length ? { host, segments } : null;
}

export function parseHFRepositoryReference(input: string): { owner: string; repo: string } | null {
  const reference = parseRepoReferenceParts(input);
  if (!reference) return null;
  const segments = [...reference.segments];
  if (["models", "datasets", "spaces"].includes(segments[0])) segments.shift();
  const [owner, rawName] = segments;
  const repo = rawName?.replace(/\.git$/i, "");
  if (!owner || !repo || ![owner, repo].every(part => /^[\w.-]+$/.test(part) && part !== "." && part !== "..")) return null;
  return { owner, repo };
}

export function parseHFOwnerReference(input: string): string | null {
  const reference = parseRepoReferenceParts(input);
  if (!reference || reference.segments.length !== 1) return null;
  const name = reference.segments[0];
  return /^[\w.-]+$/.test(name) && name !== "." && name !== ".." ? name : null;
}
