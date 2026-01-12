import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mode = process.argv[2];
if (mode !== "apply" && mode !== "restore") {
  console.error("Usage: node scripts/set-readme-version.mjs <apply|restore>");
  process.exit(2);
}

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const readmePath = path.join(repoRoot, "README.md");
const backupPath = path.join(repoRoot, ".README.md.bak");

const DOCS_LATEST = "https://seclai.github.io/seclai-javascript/latest/";

if (mode === "apply") {
  const version = process.env.VERSION;
  if (!version) {
    console.error("Missing VERSION env var.");
    process.exit(2);
  }

  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(readmePath, backupPath);
  }

  const original = fs.readFileSync(readmePath, "utf8");
  const versioned = `https://seclai.github.io/seclai-javascript/${version}/`;

  // Replace only the canonical docs link. Keep other "latest" mentions untouched.
  const updated = original.includes(DOCS_LATEST)
    ? original.replaceAll(DOCS_LATEST, versioned)
    : original;

  fs.writeFileSync(readmePath, updated);
}

if (mode === "restore") {
  if (fs.existsSync(backupPath)) {
    fs.copyFileSync(backupPath, readmePath);
    fs.rmSync(backupPath);
  }
}
