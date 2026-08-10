import { lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";

const root = resolve(".");
const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  "dist",
  ".svelte-kit",
  "release",
]);
const ignoredFiles = new Set(["PUBLIC_FILE_MANIFEST.json"]);
const forbiddenRoots = new Set([
  "supabase",
  "brand",
  "BACKEND.md",
  "AUTH_FLOW.md",
  "BLENDER_WORKFLOW.md",
  "BRAND.md",
  "DESIGN_SYSTEM.md",
  "DESIGN_ETHOS.MD",
  "Binural.MD",
]);
const sourceExtensions = new Set([".ts", ".js", ".svelte", ".json", ".jsonc"]);
const forbiddenSourcePatterns: Array<[string, RegExp]> = [
  [
    "private or service-role key",
    /(?:sb_secret_[A-Za-z0-9_-]{12,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/i,
  ],
  [
    "provider voice configuration",
    /(?:voice[_-]?id|voiceId|voice_name|voiceName|tts[_-]?voice|tts[_-]?provider|text[._ -]?to[._ -]?speech)/i,
  ],
  [
    "high-risk production credential",
    /(?:ghp_|github_pat_|sk_live_)[A-Za-z0-9_-]{12,}/,
  ],
];

const files: string[] = [];
function walk(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = resolve(directory, entry.name);
    const path = relative(root, absolute).replaceAll("\\", "/");
    if (ignoredFiles.has(path)) continue;
    if (entry.isDirectory()) walk(absolute);
    else if (entry.isFile() || lstatSync(absolute).isSymbolicLink())
      files.push(path);
  }
}

walk(root);
files.sort();
const failures: string[] = [];

for (const path of files) {
  const firstSegment = path.split("/")[0]!;
  if (forbiddenRoots.has(firstSegment) || forbiddenRoots.has(path)) {
    failures.push(`${path}: forbidden private path`);
  }
  if (/^\.env(?:\.|$)|\.(?:pem|key|p12|pfx)$/i.test(path.split("/").at(-1)!)) {
    failures.push(`${path}: environment or private-key file`);
  }

  const isAuditedSource =
    sourceExtensions.has(extname(path)) &&
    (path.startsWith("src/") ||
      path.startsWith("webview/src/") ||
      path.startsWith("tests/") ||
      path === "package.json" ||
      path === "webview/package.json");
  if (!isAuditedSource) continue;

  const contents = readFileSync(resolve(root, path), "utf8");
  for (const [label, pattern] of forbiddenSourcePatterns) {
    if (pattern.test(contents)) failures.push(`${path}: ${label}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

const manifestFlag = process.argv.indexOf("--manifest");
if (manifestFlag >= 0) {
  const destination = process.argv[manifestFlag + 1];
  if (!destination) throw new Error("--manifest requires a destination path");
  writeFileSync(
    destination,
    `${JSON.stringify({ scope: "Fresh-history public source snapshot; generated artifacts excluded", files }, null, 2)}\n`,
  );
}

console.log(`Public-tree audit passed for ${files.length} files`);
console.log(
  "Exact private identifiers must also pass the private pre-release audit.",
);
