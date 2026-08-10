import { readFileSync, writeFileSync } from "node:fs";

type PackageMetadata = {
  name?: string;
  version?: string;
  license?: string | { type?: string };
  licenses?: Array<string | { type?: string }>;
};

const packageFiles = new Set<string>();
for (const pattern of [
  "node_modules/.bun/*/node_modules/*/package.json",
  "node_modules/.bun/*/node_modules/@*/*/package.json",
]) {
  for await (const path of new Bun.Glob(pattern).scan({ cwd: ".", dot: true }))
    packageFiles.add(path);
}

function licenseExpression(metadata: PackageMetadata): string {
  if (typeof metadata.license === "string") return metadata.license;
  if (metadata.license?.type) return metadata.license.type;
  const expressions = metadata.licenses
    ?.map((license) => (typeof license === "string" ? license : license.type))
    .filter((license): license is string => Boolean(license));
  return expressions?.join(" OR ") || "UNKNOWN";
}

const records = [...packageFiles]
  .map((path) => JSON.parse(readFileSync(path, "utf8")) as PackageMetadata)
  .filter((metadata) => metadata.name && metadata.version)
  .map((metadata) => ({
    name: metadata.name!,
    version: metadata.version!,
    license: licenseExpression(metadata),
  }));

const unique = [
  ...new Map(
    records.map((record) => [`${record.name}@${record.version}`, record]),
  ).values(),
].sort(
  (left, right) =>
    left.name.localeCompare(right.name) ||
    left.version.localeCompare(right.version),
);
const unknown = unique.filter((record) => record.license === "UNKNOWN");
if (unknown.length > 0) {
  throw new Error(
    `Missing package license metadata: ${unknown.map((record) => `${record.name}@${record.version}`).join(", ")}`,
  );
}

const output = [
  "package\tversion\tlicense",
  ...unique.map(
    (record) => `${record.name}\t${record.version}\t${record.license}`,
  ),
].join("\n");
writeFileSync("THIRD_PARTY_DEPENDENCIES.tsv", `${output}\n`);
console.log(`Recorded ${unique.length} package licenses`);
