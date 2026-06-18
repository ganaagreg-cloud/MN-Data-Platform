import type { NextConfig } from "next";
import fs from "fs";
import path from "path";

// In a pnpm monorepo, .env lives at the repo root, not apps/platform.
// Next.js only looks in its own project dir, so we pre-load it here.
const rootEnv = path.resolve(process.cwd(), "../../.env");
if (fs.existsSync(rootEnv)) {
  for (const line of fs.readFileSync(rootEnv, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages (e.g. @mn-platform/db) are NodeNext/ESM and import
  // local files with a ".js" extension that resolves to the sibling ".ts"
  // source — webpack needs this alias to follow those imports.
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      ...webpackConfig.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return webpackConfig;
  },
};

export default config;
