import { readFileSync } from "node:fs";

type PackageMetadata = { version?: unknown };

function readJson(path: string): PackageMetadata {
  return JSON.parse(readFileSync(path, "utf8")) as PackageMetadata;
}

const rootVersion = readJson("package.json").version;
const webviewVersion = readJson("webview/package.json").version;

if (typeof rootVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(rootVersion)) {
  throw new Error("package.json must contain a stable semantic version");
}
if (webviewVersion !== rootVersion) {
  throw new Error(
    `Version mismatch: root=${rootVersion}, webview=${String(webviewVersion)}`,
  );
}

const changelog = readFileSync("CHANGELOG.md", "utf8");
if (
  !new RegExp(`^## ${rootVersion.replaceAll(".", "\\.")}$`, "m").test(changelog)
) {
  throw new Error(`CHANGELOG.md is missing a ${rootVersion} release heading`);
}

const suppliedTag =
  process.argv[2] ??
  (process.env.GITHUB_REF_TYPE === "tag"
    ? process.env.GITHUB_REF_NAME
    : undefined);
if (suppliedTag && suppliedTag !== `v${rootVersion}`) {
  throw new Error(
    `Tag mismatch: expected v${rootVersion}, received ${suppliedTag}`,
  );
}

console.log(`Release metadata is consistent for ${rootVersion}`);
