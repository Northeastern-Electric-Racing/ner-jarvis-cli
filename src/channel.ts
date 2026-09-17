// Distribution channel. Overridden at build time via `bun build --define:NERJ_CHANNEL='"binary"|"npm"'`.
// In dev/tests NERJ_CHANNEL is undefined, so we default to "npm" (no release-check network call).
declare const NERJ_CHANNEL: string | undefined;
export const CHANNEL: "binary" | "npm" =
  (typeof NERJ_CHANNEL !== "undefined" ? NERJ_CHANNEL : "npm") as "binary" | "npm";
