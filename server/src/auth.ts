// Key checks for brief §35. The admin key comes from the environment; when it is
// unset the dashboard runs open on the LAN and the server warns at boot. Agents
// need no key (enrollment key removed 2026-10-09, docs/decisions.md).
export type AuthConfig = {
  adminApiKey?: string;
};

/** Empty/whitespace-only env values count as unset. */
export function normKey(v: string | undefined): string | undefined {
  const t = (v ?? "").trim();
  return t ? t : undefined;
}

/** Dashboard REST (Authorization: Bearer) and dashboard WS (?key=). */
export function isAdminAuthorized(auth: AuthConfig, authorizationHeader: unknown): boolean {
  if (!auth.adminApiKey) return true;
  return authorizationHeader === `Bearer ${auth.adminApiKey}`;
}

export function isDashboardSocketAuthorized(auth: AuthConfig, keyParam: unknown): boolean {
  if (!auth.adminApiKey) return true;
  return keyParam === auth.adminApiKey;
}
