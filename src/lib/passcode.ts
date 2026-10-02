// Demo lock: one shared passcode (env DEMO_PASSCODE). The cookie stores a hash
// of the passcode, never the passcode itself. Not user auth; see FAKED.md.
export const PASS_COOKIE = "revops_pass";

export async function passToken(passcode: string) {
  const bytes = new TextEncoder().encode(`devx-revops:${passcode}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
