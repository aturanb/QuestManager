// Key checks for brief §35. Keys come from the environment (never committed);
// when a key is unset the server runs open on the LAN and warns at boot.
export type AuthConfig = {
  adminApiKey?: string;
  deviceEnrollmentKey?: string;
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

/** Agent enrollment via hello.enrollmentKey (kept out of URLs so it never hits request logs). */
export function isEnrolled(auth: AuthConfig, enrollmentKey: string | undefined): boolean {
  if (!auth.deviceEnrollmentKey) return true;
  return enrollmentKey === auth.deviceEnrollmentKey;
}
