// Runs the e2e path against a throwaway database, never the shared demo one.
//   npm run e2e:isolated [-- <playwright args>]
// 1. Rebuilds .pipeline/e2e/e2e.db (alembic upgrade head, recoup ingest, recoup run) from backend/ via uv.
// 2. Runs Playwright with playwright.isolated.config.ts, which starts an API on :8002 over that file
//    (RECOUP_DEMO_MODE=true) and a Vite on :5175 pointed at it.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(frontend, "..");
const backend = path.join(repo, "backend");
const dir = path.join(repo, ".pipeline", "e2e");
const db = path.join(dir, "e2e.db");

// The only file this script ever removes is its own throwaway database, under .pipeline/e2e.
if (path.dirname(db) !== dir || path.basename(db) !== "e2e.db") throw new Error(`refusing to touch ${db}`);
mkdirSync(dir, { recursive: true });
for (const suffix of ["", "-journal", "-wal", "-shm"]) rmSync(db + suffix, { force: true });

const env = { ...process.env, RECOUP_DATABASE_URL: `sqlite:///${db}`, RECOUP_LLM: "off", PYTHONPATH: path.join(backend, "src") };
const run = (cmd, args, cwd) => {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, { cwd, env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run("uv", ["run", "alembic", "upgrade", "head"], backend);
run("uv", ["run", "recoup", "ingest"], backend);
run("uv", ["run", "recoup", "run"], backend);

const test = spawnSync("npx", ["playwright", "test", "--config", "playwright.isolated.config.ts", ...process.argv.slice(2)], {
  cwd: frontend,
  env: process.env,
  stdio: "inherit",
});
process.exit(test.status ?? 1);
