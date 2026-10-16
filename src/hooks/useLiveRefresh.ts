import * as React from "react";
import { useState, useEffect, createContext, useContext, useCallback, useRef } from "react";
import { usePageVisibility } from "./usePageVisibility";
import { useConfigStatus } from "./useConfigStatus";

interface LiveRefreshContextType {
  isLiveEnabled: boolean;
  toggleLive: () => void;
  registerRefreshCallback: (callback: () => void) => () => void;
}

const LiveRefreshContext = createContext<LiveRefreshContextType | undefined>(undefined);

const LIVE_REFRESH_INTERVAL = 3000; // 3 seconds
const SESSION_STORAGE_KEY = 'hf-mirror-live-refresh';

export function LiveRefreshProvider({ children }: { children: React.ReactNode }) {
  const [isLiveEnabled, setIsLiveEnabled] = useState<boolean>(false);
  const isPageVisible = usePageVisibility();
  const { isFullyConfigured } = useConfigStatus();
  const refreshCallbacksRef = useRef<Set<() => void>>(new Set());
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Load initial state from session storage
  useEffect(() => {
    const savedState = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (savedState === 'true') {
      setIsLiveEnabled(true);
    }
  }, []);

  // Save state to session storage whenever it changes
  useEffect(() => {
    sessionStorage.setItem(SESSION_STORAGE_KEY, isLiveEnabled.toString());
  }, [isLiveEnabled]);

  // Execute all registered refresh callbacks
  const executeRefreshCallbacks = useCallback(() => {
    refreshCallbacksRef.current.forEach(callback => {
      try {
        callback();
      } catch (error) {
        console.error('Error executing refresh callback:', error);
      }
    });
  }, []);

  // Setup/cleanup the refresh interval
  useEffect(() => {
    // Clear existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // Only set up interval if live is enabled, page is visible, and configuration is complete
    if (isLiveEnabled && isPageVisible && isFullyConfigured) {
      intervalRef.current = setInterval(executeRefreshCallbacks, LIVE_REFRESH_INTERVAL);
    }

    // Cleanup on unmount
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isLiveEnabled, isPageVisible, isFullyConfigured, executeRefreshCallbacks]);

  const toggleLive = useCallback(() => {
    setIsLiveEnabled(prev => !prev);
  }, []);

  const registerRefreshCallback = useCallback((callback: () => void) => {
    refreshCallbacksRef.current.add(callback);

    // Return cleanup function
    return () => {
      refreshCallbacksRef.current.delete(callback);
    };
  }, []);

  const contextValue = {
    isLiveEnabled,
    toggleLive,
    registerRefreshCallback,
  };

  return React.createElement(
    LiveRefreshContext.Provider,
    { value: contextValue },
    children
  );
}

export function useLiveRefresh() {
  const context = useContext(LiveRefreshContext);
  if (context === undefined) {
    throw new Error("useLiveRefresh must be used within a LiveRefreshProvider");
  }
  return context;
}
