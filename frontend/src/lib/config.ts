// ── Runtime configuration ───────────────────────────────────────────────────
// Vite injects VITE_* env vars at build time.
// In dev, the Vite proxy handles /api → localhost:3000.
// In production (Firebase), VITE_API_URL points to the VPS.

export const API_BASE = import.meta.env.VITE_API_URL ?? "";
