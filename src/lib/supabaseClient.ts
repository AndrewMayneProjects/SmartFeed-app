import { createClient } from "@supabase/supabase-js";

type RuntimeConfig = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

declare global {
  interface Window {
    __APP_CONFIG__?: RuntimeConfig;
  }
}

const globalConfig: RuntimeConfig | undefined =
  typeof globalThis !== "undefined" && "__APP_CONFIG__" in globalThis
    ? (globalThis as typeof globalThis & { __APP_CONFIG__?: RuntimeConfig }).__APP_CONFIG__
    : typeof window !== "undefined"
      ? window.__APP_CONFIG__
      : undefined;

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || globalConfig?.supabaseUrl || "").trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || globalConfig?.supabaseAnonKey || "").trim();

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Supabase configuration missing. Ensure build-time environment variables or public/app-config.js provide VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true
  }
});

