import { decrypt } from "./encryption";
import type { Config } from "@/types/config";

/**
 * Decrypts tokens in a config object for use in API calls
 * @param config The config object with potentially encrypted tokens
 * @returns Config object with decrypted tokens
 */
export function decryptConfigTokens(config: Config): Config {
  const decryptedConfig = { ...config };

  // Deep clone the config objects
  if (config.sourceConfig) {
    decryptedConfig.sourceConfig = { ...config.sourceConfig };
    if (config.sourceConfig.token) {
      decryptedConfig.sourceConfig.token = decrypt(config.sourceConfig.token);
    }
  }

  if (config.giteaConfig) {
    decryptedConfig.giteaConfig = { ...config.giteaConfig };
    if (config.giteaConfig.token) {
      decryptedConfig.giteaConfig.token = decrypt(config.giteaConfig.token);
    }
  }

  return decryptedConfig;
}

export function getDecryptedSourceToken(config: Config): string {
  if (!config.sourceConfig?.token) {
    throw new Error("HF token not found in config");
  }
  return decrypt(config.sourceConfig.token);
}

/**
 * Gets a decrypted Gitea token from config
 * @param config The config object
 * @returns Decrypted Gitea token
 */
export function getDecryptedGiteaToken(config: Config): string {
  if (!config.giteaConfig?.token) {
    throw new Error("Gitea token not found in config");
  }
  return decrypt(config.giteaConfig.token);
}
