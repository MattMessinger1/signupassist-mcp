/**
 * ChatGPT Apps SDK Hook Layer
 * Provides React hooks to interact with window.openai API
 */

import { useSyncExternalStore, useCallback } from 'react';
import type { ToolOutput, OpenAIWidgetState } from '../types/openai';

// ============================================================================
// Global State Store
// ============================================================================

type Listener = () => void;
const listeners = new Set<Listener>();

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyListeners() {
  listeners.forEach(listener => listener());
}

// Listen for global openai state changes
if (typeof window !== 'undefined') {
  window.addEventListener('openai:set_globals', notifyListeners);
  window.addEventListener('openai:widget_state_changed', notifyListeners);
}

// ============================================================================
// Hooks for reading window.openai properties
// ============================================================================

/**
 * Hook to read toolOutput from ChatGPT host
 */
export function useToolOutput(): ToolOutput | null {
  return useSyncExternalStore(
    subscribe,
    () => window.openai?.toolOutput ?? null,
    () => null // Server-side fallback
  );
}

/**
 * Hook to read toolInput from ChatGPT host
 */
export function useToolInput(): any {
  return useSyncExternalStore(
    subscribe,
    () => window.openai?.toolInput ?? null,
    () => null
  );
}

/**
 * Hook for widget state management
 * Persists between tool calls via window.openai.setWidgetState
 */
export function useWidgetState<T = OpenAIWidgetState>(): [T, (updates: Partial<T>) => void] {
  const state = useSyncExternalStore(
    subscribe,
    () => window.openai?.getWidgetState?.() as T ?? getDefaultWidgetState() as T,
    () => getDefaultWidgetState() as T
  );

  const setState = useCallback((updates: Partial<T>) => {
    if (window.openai?.setWidgetState) {
      window.openai.setWidgetState(updates);
      notifyListeners(); // Trigger re-render
    }
  }, []);

  return [state, setState];
}

/**
 * Default widget state for fallback
 */
function getDefaultWidgetState(): OpenAIWidgetState {
  return {
    step: 'browse',
    guardianData: {},
    participantData: [{}],
    selectedProgram: null,
    numParticipants: 1,
  };
}

// ============================================================================
// Action Hooks
// ============================================================================

/**
 * Hook for calling MCP tools via ChatGPT
 */
export function useCallTool() {
  return useCallback(async (toolName: string, args: Record<string, any>) => {
    if (window.openai?.callTool) {
      return window.openai.callTool(toolName, args);
    }
    console.warn('[Widget] window.openai.callTool not available');
    return null;
  }, []);
}

/**
 * Hook for sending follow-up messages
 */
export function useSendMessage() {
  return useCallback((message: string) => {
    if (window.openai?.sendFollowUpMessage) {
      window.openai.sendFollowUpMessage(message);
    } else {
      console.warn('[Widget] window.openai.sendFollowUpMessage not available');
    }
  }, []);
}

/**
 * Hook for fullscreen control
 */
export function useFullscreen() {
  const requestFullscreen = useCallback(() => {
    window.openai?.requestFullscreen?.();
  }, []);

  const exitFullscreen = useCallback(() => {
    window.openai?.exitFullscreen?.();
  }, []);

  return { requestFullscreen, exitFullscreen };
}
