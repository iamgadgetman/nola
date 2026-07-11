// Wraps fetch().json() with useful error messages when the server returns HTML
// instead of JSON (Traefik 502, Authentik login redirect, etc.)
export async function safeJson(res) {
  const text = await res.text();
  if (text.trimStart().startsWith('<')) {
    const hint = res.redirected
      ? 'Auth redirect — Traefik nola-api router may be missing or misconfigured'
      : `Server returned HTML (status ${res.status}) — check if nola-dashboard is running`;
    throw new Error(hint);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON from server: ${text.slice(0, 80)}`);
  }
}
