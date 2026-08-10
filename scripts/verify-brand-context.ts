import { existsSync, readFileSync } from "node:fs";

const officialRepository = "glow-affirmations/glow-extension";
const currentRepository = process.env.GITHUB_REPOSITORY?.toLowerCase();

if (!currentRepository || currentRepository === officialRepository) {
  console.log(
    currentRepository
      ? "Official Glow brand context verified"
      : "Local build: brand-context check deferred to GitHub CI",
  );
  process.exit(0);
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  name?: string;
  displayName?: string;
  publisher?: string;
};
const protectedFiles = [
  "media/glow-icon.png",
  "media/glow-marketplace-icon.png",
  "media/glow-sidebar.svg",
  "media/glow-tab-light.svg",
  "media/glow-tab-dark.svg",
].filter(existsSync);
const usesOfficialIdentity =
  packageJson.name === "glow-affirmations" ||
  packageJson.displayName === "Glow Affirmations" ||
  packageJson.publisher === "justglow";

if (usesOfficialIdentity || protectedFiles.length > 0) {
  console.error(
    `Fork ${currentRepository} still uses protected Glow identity or brand assets. ` +
      "Follow REBRANDING.md before distributing a fork.",
  );
  process.exit(1);
}

console.log(`Rebranded fork context verified for ${currentRepository}`);
