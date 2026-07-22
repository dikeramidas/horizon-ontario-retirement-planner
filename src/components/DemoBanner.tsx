import { APP_RELEASE_LABEL } from "../lib/appMeta";

/** True on GitHub Pages project demo (or when forced via query ?demo=1). */
export function isDemoHost(hostname = typeof window !== "undefined" ? window.location.hostname : ""): boolean {
  if (typeof window !== "undefined") {
    try {
      if (new URLSearchParams(window.location.search).get("demo") === "1") return true;
    } catch {
      /* ignore */
    }
  }
  return hostname.endsWith("github.io");
}

export function DemoBanner() {
  if (typeof window === "undefined" || !isDemoHost()) return null;

  return (
    <div className="demo-banner" data-testid="demo-banner" role="status">
      <strong>{APP_RELEASE_LABEL}</strong>
      <span className="demo-banner-sep">·</span>
      <span>Live demo</span>
      <span className="demo-banner-sep">·</span>
      <span>Estimates, not advice</span>
      <span className="demo-banner-sep">·</span>
      <span>Data stays in this browser</span>
    </div>
  );
}
