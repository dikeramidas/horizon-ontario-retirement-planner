/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * GitHub Pages project sites live at https://<user>.github.io/<repo>/.
 * CI sets GITHUB_PAGES=true and GITHUB_REPOSITORY=owner/repo.
 */
function pagesBase(): string {
  if (process.env.GITHUB_PAGES !== "true") return "/";
  const repo = process.env.GITHUB_REPOSITORY?.split("/")[1];
  return repo ? `/${repo}/` : "/";
}

export default defineConfig({
  base: pagesBase(),
  plugins: [react()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
