import { withBase } from "@/lib/base-path";
import type { SourceProvider, DestinationProvider } from "@/types/config";

// Base API URL
const API_BASE = withBase("/api");

// Helper function for API requests
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      message: "An unknown error occurred",
    }));
    throw new Error(error.message || "An unknown error occurred");
  }

  return response.json();
}

export const sourceApi = {
  /** Test the source connection. The route serves every source provider. */
  testConnection: (
    token: string,
    options: { provider?: SourceProvider; url?: string; username?: string } = {}
  ) =>
    apiRequest<{ success: boolean; message?: string }>("/source/test-connection", {
      method: "POST",
      body: JSON.stringify({ token, ...options }),
    }),
};

// Gitea API
export interface GiteaServerInfo {
  type: "forgejo" | "gitea";
  version: string;
  raw: string;
  hasMirrorCredBug: boolean;
}

export const giteaApi = {

  testConnection: (
    url: string,
    token: string,
    options: { provider?: DestinationProvider; username?: string } = {}
  ) =>
    apiRequest<{ success: boolean; serverInfo?: GiteaServerInfo; message?: string }>(
      "/gitea/test-connection",
      {
        method: "POST",
        body: JSON.stringify({ url, token, ...options }),
      }
    ),
};

// Health API
export interface HealthResponse {
  status: "ok" | "error" | "degraded";
  timestamp: string;
  version: string;
  latestVersion: string;
  updateAvailable: boolean;
  database: {
    connected: boolean;
  };
  recovery?: {
    status: string;
    jobsNeedingRecovery: number;
  };
  error?: string;
}

export const healthApi = {
  check: async (): Promise<HealthResponse> => {
    try {
      const response = await fetch(`${API_BASE}/health`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          status: "error",
          error: "Failed to parse error response",
        }));

        return {
          ...errorData,
          status: "error",
          timestamp: new Date().toISOString(),
        } as HealthResponse;
      }

      return await response.json();
    } catch (error) {
      return {
        status: "error",
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Unknown error checking health",
        version: "unknown",
        latestVersion: "unknown",
        updateAvailable: false,
        database: { connected: false, message: "Failed to connect to API" },
        system: {
          uptime: { startTime: "", uptimeMs: 0, formatted: "N/A" },
          memory: {
            rss: "N/A",
            heapTotal: "N/A",
            heapUsed: "N/A",
            external: "N/A",
            systemTotal: "N/A",
            systemFree: "N/A",
          },
          os: { platform: "", version: "", arch: "" },
          env: "",
        },
      };
    }
  },
};
