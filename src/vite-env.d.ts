/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LEGISCAN_API_KEY: string;
  readonly VITE_OPENAI_API_KEY?: string;
  readonly VITE_OPENAI_MODEL?: string;
  readonly VITE_OPENAI_BASE_URL?: string;
  readonly VITE_APP_ID?: string;
  readonly VITE_APP_BASE_URL?: string;
  readonly VITE_FUNCTIONS_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
