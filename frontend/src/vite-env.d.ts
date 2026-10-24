/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  /** Machine Resale portal project (MR-1C). Optional: the module says it is not set up without them. */
  readonly VITE_MR_SUPABASE_URL?: string;
  readonly VITE_MR_SUPABASE_PUBLISHABLE_KEY?: string;
  /** DEV ONLY: send Fund Flow to a local database (see lib/fundFlow.ts). Never set in Vercel. */
  readonly VITE_FUND_FLOW_LOCAL_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
