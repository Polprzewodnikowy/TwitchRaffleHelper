interface ImportMetaEnv {
  readonly VITE_PUBLIC_URL: string;
  readonly VITE_TWITCH_CLIENT_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
