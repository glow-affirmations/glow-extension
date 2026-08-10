export function completePairingCode(value: string): string | null {
  const normalized = value.trim().replace(/[ -]/g, "");
  return /^\d{6}$/.test(normalized) ? normalized : null;
}
