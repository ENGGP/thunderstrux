// The society profile editor's steps, as the address names them (?step=branding).
// Its own module so the server page can read it: a "use client" file can't share values.
export const profileSteps = ["identity", "branding", "operations", "finish"] as const;
