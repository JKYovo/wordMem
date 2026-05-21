const fs = require("fs");
const path = require("path");

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return undefined;
  }

  const equalIndex = trimmed.indexOf("=");
  if (equalIndex <= 0) {
    return undefined;
  }

  const key = trimmed.slice(0, equalIndex).trim();
  let value = trimmed.slice(equalIndex + 1).trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

function loadLocalEnv() {
  const root = path.resolve(__dirname, "..");
  const candidates = [".env.local", ".env"];

  candidates.forEach((filename) => {
    const filepath = path.join(root, filename);
    if (!fs.existsSync(filepath)) {
      return;
    }

    fs.readFileSync(filepath, "utf8")
      .split(/\r?\n/)
      .forEach((line) => {
        const parsed = parseEnvLine(line);
        if (!parsed || process.env[parsed.key]) {
          return;
        }
        process.env[parsed.key] = parsed.value;
      });
  });
}

module.exports = { loadLocalEnv };
