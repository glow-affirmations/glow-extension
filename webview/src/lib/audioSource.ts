export type AudioSourceKind =
  | "none"
  | "custom-blob"
  | "webview-resource"
  | "remote-https"
  | "local-file"
  | "other";

export function audioSourceKind(source: string | null | undefined): AudioSourceKind {
  if (!source) return "none";

  try {
    const url = new URL(source);
    if (url.protocol === "file:") return "local-file";
    if (url.protocol === "blob:") return "custom-blob";
    if (url.protocol !== "https:") return "other";
    if (url.hostname.endsWith(".vscode-cdn.net")) return "webview-resource";
    return "remote-https";
  } catch {
    return "other";
  }
}
