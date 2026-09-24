/**
 * Avalaunch Type Definitions
 * IPC interfaces and Shield Engine data structures matching Rust backend.
 */

export interface CosmeticResources {
  hide_selectors: string[];
  injected_script: string;
  generics: boolean;
}

export interface BlockResult {
  matched: boolean;
  filter?: string | null;
  redirect_url?: string | null;
}

export interface ShieldStats {
  blocked_requests: number;
  total_requests: number;
  hidden_elements: number;
}

export interface FilterUpdateReport {
  updated: boolean;
  rules_count: number;
  last_updated?: string | null;
}

export interface CosmeticRule {
  selector: string;
  action: "hide" | "style";
}

export interface TauriCore {
  invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

export interface TauriGlobal {
  core: TauriCore;
  invoke?: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
}

declare global {
  interface Window {
    __TAURI__?: TauriGlobal;
    __TAURI_INTERNALS__?: {
      invoke?: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    };
    __AVALAUNCH_INJECTOR__?: unknown;
  }
}
