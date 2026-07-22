#!/usr/bin/env node
/**
 * Upload all git-tracked files to GitHub (creates/replaces branch tree).
 *
 * Usage:
 *   gh auth login
 *   node scripts/push-to-github.mjs
 *
 * Or with a token:
 *   GH_TOKEN=ghp_xxx node scripts/push-to-github.mjs
 */
import { execSync } from "node:child_process";
import fs from "node:fs";

const owner = "dikeramidas";
const repo = "horizon-ontario-retirement-planner";
const branch = "main";

function token() {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) {
    return process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  }
  try {
    return execSync("gh auth token", { encoding: "utf8" }).trim();
  } catch {
    throw new Error(
      "No GH_TOKEN/GITHUB_TOKEN and `gh auth token` failed. Run: gh auth login"
    );
  }
}

async function gh(pathname, init = {}) {
  const t = token();
  const res = await fetch("https://api.github.com" + pathname, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + t,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(
      res.status + " " + pathname + " " + JSON.stringify(body).slice(0, 500)
    );
  }
  return body;
}

async function main() {
  const files = execSync("git ls-files", { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
  console.log("Uploading", files.length, "files to", `${owner}/${repo}`);

  let baseCommitSha = null;
  let baseTreeSha = null;
  try {
    const ref = await gh(`/repos/${owner}/${repo}/git/ref/heads/${branch}`);
    baseCommitSha = ref.object.sha;
    const commit = await gh(
      `/repos/${owner}/${repo}/git/commits/${baseCommitSha}`
    );
    baseTreeSha = commit.tree.sha;
  } catch {
    console.log("No existing branch tip found; creating fresh history");
  }

  const tree = [];
  for (let i = 0; i < files.length; i++) {
    const p = files[i];
    const content = fs.readFileSync(p);
    process.stdout.write(`  blob ${i + 1}/${files.length} ${p}\r`);
    const blob = await gh(`/repos/${owner}/${repo}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({
        content: content.toString("utf8"),
        encoding: "utf-8",
      }),
    });
    tree.push({ path: p, mode: "100644", type: "blob", sha: blob.sha });
  }
  console.log("\nCreating tree…");
  const newTree = await gh(`/repos/${owner}/${repo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      tree,
      ...(baseTreeSha ? { base_tree: baseTreeSha } : {}),
    }),
  });

  console.log("Creating commit…");
  const commit = await gh(`/repos/${owner}/${repo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: "Initial commit: Horizon Ontario couple retirement planner",
      tree: newTree.sha,
      parents: baseCommitSha ? [baseCommitSha] : [],
    }),
  });

  console.log("Updating ref", branch, "→", commit.sha);
  if (baseCommitSha) {
    await gh(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha, force: true }),
    });
  } else {
    await gh(`/repos/${owner}/${repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({
        ref: `refs/heads/${branch}`,
        sha: commit.sha,
      }),
    });
  }

  console.log("Done:", `https://github.com/${owner}/${repo}`);
  console.log(
    "Tip: git remote add origin https://github.com/" +
      owner +
      "/" +
      repo +
      ".git  # if needed"
  );
  console.log(
    "Then: git fetch origin && git branch -u origin/main main"
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
