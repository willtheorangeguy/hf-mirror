import { useCallback, useEffect, useState, useRef } from 'react';
import { useAuth } from './useAuth';
import { apiRequest } from '@/lib/utils';
import type { ConfigApiResponse, SourceApiRecord } from '@/types/config';
import {
  DEFAULT_SOURCE_PROVIDER,
  normalizeSourceProviderKind,
  normalizeSourceUrl,
  type SourceProviderKind,
} from '@/lib/source-providers/kinds';

interface ConfigStatus {
  isSourceConfigured: boolean;
  isGiteaConfigured: boolean;
  isFullyConfigured: boolean;
  isLoading: boolean;
  error: string | null;
  autoMirrorStarred: boolean;
  sourceOwner: string;
  sources: SourceApiRecord[];
  /** Any source row exists, including tokenless public-only sources. */
  hasAnySource: boolean;
  /** The configured (primary) source kind and its normalized instance URL. */
  sourceProvider: SourceProviderKind;
  sourceUrl: string;
}

// Cache to prevent duplicate API calls across components
let configCache: { data: ConfigApiResponse | null; timestamp: number; userId: string | null } = {
  data: null,
  timestamp: 0,
  userId: null
};

const CACHE_DURATION = 30000; // 30 seconds cache

// Mounted hooks, so invalidating the cache refreshes what is on screen
// instead of only clearing the store behind it.
const cacheSubscribers = new Set<() => void>();

// One in-flight GET shared by every mounted hook: an invalidation wakes all
// of them at once, and without this each would fire its own request.
let inFlightRequest: { userId: string; promise: Promise<ConfigApiResponse> } | null = null;

function fetchConfigOnce(userId: string): Promise<ConfigApiResponse> {
  if (inFlightRequest && inFlightRequest.userId === userId) {
    return inFlightRequest.promise;
  }
  const promise = apiRequest<ConfigApiResponse>(`/config?userId=${userId}`, { method: 'GET' });
  const tracked = promise.finally(() => {
    if (inFlightRequest?.promise === tracked) {
      inFlightRequest = null;
    }
  });
  inFlightRequest = { userId, promise: tracked };
  return tracked;
}

export function useConfigStatus(): ConfigStatus {
  const { user } = useAuth();
  const [configStatus, setConfigStatus] = useState<ConfigStatus>({
    isSourceConfigured: false,
    isGiteaConfigured: false,
    isFullyConfigured: false,
    isLoading: true,
    error: null,
    autoMirrorStarred: false,
    sourceOwner: '',
    sources: [],
    hasAnySource: false,
    sourceProvider: DEFAULT_SOURCE_PROVIDER,
    sourceUrl: normalizeSourceUrl(undefined, DEFAULT_SOURCE_PROVIDER),
  });

  // Track if this hook has already checked config to prevent multiple calls
  const hasCheckedRef = useRef(false);

  const checkConfiguration = useCallback(async () => {
    if (!user?.id) {
      setConfigStatus({
        isSourceConfigured: false,
        isGiteaConfigured: false,
        isFullyConfigured: false,
        isLoading: false,
        error: 'No user found',
        autoMirrorStarred: false,
        sourceOwner: '',
        sources: [],
        hasAnySource: false,
        sourceProvider: DEFAULT_SOURCE_PROVIDER,
    sourceUrl: normalizeSourceUrl(undefined, DEFAULT_SOURCE_PROVIDER),
      });
      return;
    }

    // Check cache first
    const now = Date.now();
    const isCacheValid = configCache.data &&
                        configCache.userId === user.id &&
                        (now - configCache.timestamp) < CACHE_DURATION;

    if (isCacheValid && hasCheckedRef.current) {
      const configResponse = configCache.data!;

      // self-authenticating for listForAuthenticatedUser, and a Gitea username
      // isn't needed under single-org / flat mirror strategies. Users who
      // configure via env vars without HF_USERNAME / GITEA_USERNAME set
      // (or who otherwise left those blank) were being locked out of the
      // dashboard even though mirroring worked fine (see issue #271).
      const isSourceConfigured = !!configResponse?.sources?.length || !!configResponse?.sourceConfig?.username;

      const isGiteaConfigured = !!(
        configResponse?.giteaConfig?.url &&
        configResponse?.giteaConfig?.token
      );

      const isFullyConfigured = isSourceConfigured && isGiteaConfigured;

      const sources = configResponse?.sources ?? [];

      setConfigStatus({
        isSourceConfigured,
        isGiteaConfigured,
        isFullyConfigured,
        isLoading: false,
        error: null,
        autoMirrorStarred: configResponse?.advancedOptions?.autoMirrorStarred ?? false,
        sourceOwner: configResponse?.sourceConfig?.username ?? '',
        sources,
        hasAnySource: sources.length > 0,
        sourceProvider: normalizeSourceProviderKind(configResponse?.sourceConfig?.provider),
        sourceUrl: normalizeSourceUrl(
          configResponse?.sourceConfig?.url,
          normalizeSourceProviderKind(configResponse?.sourceConfig?.provider)
        ),
      });
      return;
    }

    try {
      // Only show loading if we haven't checked before or cache is invalid
      if (!hasCheckedRef.current) {
        setConfigStatus(prev => ({ ...prev, isLoading: true, error: null }));
      }

      const configResponse = await fetchConfigOnce(user.id);

      // Update cache
      configCache = {
        data: configResponse,
        timestamp: now,
        userId: user.id
      };

      // self-authenticating for listForAuthenticatedUser, and a Gitea username
      // isn't needed under single-org / flat mirror strategies. Users who
      // configure via env vars without HF_USERNAME / GITEA_USERNAME set
      // (or who otherwise left those blank) were being locked out of the
      // dashboard even though mirroring worked fine (see issue #271).
      const isSourceConfigured = !!configResponse?.sources?.length || !!configResponse?.sourceConfig?.username;

      const isGiteaConfigured = !!(
        configResponse?.giteaConfig?.url &&
        configResponse?.giteaConfig?.token
      );

      const isFullyConfigured = isSourceConfigured && isGiteaConfigured;

      const sources = configResponse?.sources ?? [];

      setConfigStatus({
        isSourceConfigured,
        isGiteaConfigured,
        isFullyConfigured,
        isLoading: false,
        error: null,
        autoMirrorStarred: configResponse?.advancedOptions?.autoMirrorStarred ?? false,
        sourceOwner: configResponse?.sourceConfig?.username ?? '',
        sources,
        hasAnySource: sources.length > 0,
        sourceProvider: normalizeSourceProviderKind(configResponse?.sourceConfig?.provider),
        sourceUrl: normalizeSourceUrl(
          configResponse?.sourceConfig?.url,
          normalizeSourceProviderKind(configResponse?.sourceConfig?.provider)
        ),
      });

      hasCheckedRef.current = true;
    } catch (error) {
      setConfigStatus({
        isSourceConfigured: false,
        isGiteaConfigured: false,
        isFullyConfigured: false,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to check configuration',
        autoMirrorStarred: false,
        sourceOwner: '',
        sources: [],
        hasAnySource: false,
        sourceProvider: DEFAULT_SOURCE_PROVIDER,
    sourceUrl: normalizeSourceUrl(undefined, DEFAULT_SOURCE_PROVIDER),
      });
      hasCheckedRef.current = true;
    }
  }, [user?.id]);

  useEffect(() => {
    checkConfiguration();
  }, [checkConfiguration]);

  // Re-read after invalidateConfigCache(): saving the configuration or
  // adding a public organization (which creates its tokenless source row)
  // has to reach the components already on screen, or source-dependent UI
  // like the organization card's "Public only" badge stays stale until a
  // reload.
  useEffect(() => {
    const refresh = () => {
      void checkConfiguration();
    };
    cacheSubscribers.add(refresh);
    return () => {
      cacheSubscribers.delete(refresh);
    };
  }, [checkConfiguration]);

  return configStatus;
}

// Export function to invalidate cache when config is updated. Mounted hooks
// re-fetch (through the shared in-flight request, so this costs one call).
export function invalidateConfigCache() {
  configCache = { data: null, timestamp: 0, userId: null };
  inFlightRequest = null;
  for (const refresh of [...cacheSubscribers]) {
    refresh();
  }
}

// Export function to get cached config data for other hooks
export function getCachedConfig(): ConfigApiResponse | null {
  const now = Date.now();
  const isCacheValid = configCache.data && (now - configCache.timestamp) < CACHE_DURATION;
  return isCacheValid ? configCache.data : null;
}
