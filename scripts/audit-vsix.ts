import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const vsixPath = process.argv[2];
if (!vsixPath || !existsSync(vsixPath)) {
  throw new Error("Usage: bun scripts/audit-vsix.ts <path-to-vsix>");
}

const listed = spawnSync("unzip", ["-Z1", vsixPath], { encoding: "utf8" });
if (listed.status !== 0)
  throw new Error(listed.stderr || "Unable to list VSIX contents");

const entries = listed.stdout.split("\n").filter(Boolean);
const forbiddenEntries = entries.filter((entry) =>
  /(?:^|\/)(?:supabase|node_modules|\.git|\.env|BACKEND\.md|AUTH_FLOW\.md|brand)(?:\/|$)|\.(?:map|pem|key|p12|pfx)$/i.test(
    entry,
  ),
);
if (forbiddenEntries.length > 0) {
  throw new Error(`Forbidden VSIX entries:\n${forbiddenEntries.join("\n")}`);
}

const requiredEntries = [
  "extension/package.json",
  "extension/dist/extension.cjs",
  "extension/readme.md",
  "extension/LICENSE.txt",
  "extension/COPYRIGHT",
  "extension/LICENSE-ASSETS",
  "extension/THIRD_PARTY_NOTICES.md",
  "extension/THIRD_PARTY_DEPENDENCIES.tsv",
  "extension/TRADEMARKS.md",
  "extension/BRAND_ASSET_LICENSE.md",
  "extension/REBRANDING.md",
];
for (const required of requiredEntries) {
  if (!entries.includes(required))
    throw new Error(`VSIX is missing ${required}`);
}

const bundle = spawnSync(
  "unzip",
  ["-p", vsixPath, "extension/dist/extension.cjs"],
  {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  },
);
if (bundle.status !== 0)
  throw new Error(bundle.stderr || "Unable to inspect extension bundle");

const genericPrivatePatterns = [
  /(?:sb_secret_[A-Za-z0-9_-]{12,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/i,
  /(?:voice[_-]?id|voiceId|voice_name|voiceName|tts[_-]?voice|tts[_-]?provider|text[._ -]?to[._ -]?speech)/i,
];
if (genericPrivatePatterns.some((pattern) => pattern.test(bundle.stdout))) {
  throw new Error(
    "Compiled extension contains a private key or provider-voice configuration indicator",
  );
}

console.log(`VSIX audit passed for ${entries.length} archive entries`);
