/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** Printer font path for label text slot 1 (^CW1), e.g. E:TT0003M_.TTF. */
  readonly VITE_ZEBRA_LABEL_FONT?: string;
  /** Fallback font linked to the label font via ^FL, e.g. E:SWISS271.TTF. Empty disables it. */
  readonly VITE_ZEBRA_LABEL_FALLBACK_FONT?: string;
}
