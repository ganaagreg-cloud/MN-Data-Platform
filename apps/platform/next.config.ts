import type { NextConfig } from "next";

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
