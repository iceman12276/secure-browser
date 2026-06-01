/**
 * Address-bar (omnibox) resolution: turn whatever the user typed into the URL
 * to navigate to. Mirrors a real browser — a bare word like "github" becomes a
 * web search, while "github.com", "localhost:5173", or "https://x" navigate
 * directly. Returns '' for empty input so the caller can safely no-op.
 *
 * Searching sends the query to a search engine; that is normal web browsing the
 * user explicitly asked for, not telemetry or sync. We default to DuckDuckGo to
 * match this browser's privacy-first posture.
 */
const SEARCH_PREFIX = 'https://duckduckgo.com/?q=';

function search(text: string): string {
  return `${SEARCH_PREFIX}${encodeURIComponent(text)}`;
}

export function resolveOmnibox(raw: string): string {
  const text = raw.trim();
  if (!text) return '';

  // 1. Explicit, safe schemes the user typed → navigate verbatim.
  if (/^(https?|file|view-source|blob):\/\//i.test(text)) return text;
  if (/^(about|data):/i.test(text)) return text;

  // 2. localhost and raw IPv4 (optionally host:port/path) → local http.
  if (/^localhost(:\d+)?(\/.*)?$/i.test(text)) return `http://${text}`;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(text)) return `http://${text}`;

  // 3. Hostname-looking: no whitespace and a dot with non-empty labels on each
  //    side ("example.com", "a.co/x" → navigate; "github", "what is x" → no).
  if (!/\s/.test(text) && /^[^\s/:?#.]+(\.[^\s/:?#.]+)+/.test(text)) {
    return `https://${text}`;
  }

  // 4. Everything else (bare word, phrase, question, javascript:, mailto:) → search.
  return search(text);
}
