import type { SourceProviderKind } from "@/lib/source-providers/kinds";

interface SourceAuthPayload { auth_username: string; auth_password: string; auth_token: string }
export function buildSourceAuthPayload({ provider, token, username }: {
  provider: SourceProviderKind; token?: string | null; username?: string | null; repositoryOwner?: string | null;
}): SourceAuthPayload | Record<string, never> {
  if (provider !== "huggingface") throw new Error("Only Hugging Face sources are supported");
  const secret = token?.trim();
  return secret ? { auth_username: username?.trim() || "hf_user", auth_password: secret, auth_token: secret } : {};
}
