/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** Printer font path for label text slot 1 (^CW1), e.g. E:SWISS271.TTF. */
  readonly VITE_ZEBRA_LABEL_FONT?: string;
}
