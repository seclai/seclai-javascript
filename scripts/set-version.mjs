import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd());
const PACKAGE_JSON = path.join(ROOT, "package.json");
const BACKUP = path.join(ROOT, ".version-backup.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function normalizeVersion(v) {
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
}

const command = process.argv[2];

if (command === "apply") {
  const envVersion = normalizeVersion(process.env.VERSION);
  if (!envVersion) process.exit(0);

  const pkg = readJson(PACKAGE_JSON);

  if (!fs.existsSync(BACKUP)) {
    writeJson(BACKUP, { version: pkg.version });
  }

  pkg.version = envVersion;
  writeJson(PACKAGE_JSON, pkg);
  process.exit(0);
}

if (command === "restore") {
  if (!fs.existsSync(BACKUP)) process.exit(0);

  const backup = readJson(BACKUP);
  const pkg = readJson(PACKAGE_JSON);

  if (typeof backup.version === "string") {
    pkg.version = backup.version;
    writeJson(PACKAGE_JSON, pkg);
  }

  fs.unlinkSync(BACKUP);
  process.exit(0);
}

console.error('Usage: node scripts/set-version.mjs <apply|restore>');
process.exit(2);
