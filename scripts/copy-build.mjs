import { cpSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const source = resolve("frontend/build");
const target = resolve("build");

if (!existsSync(source)) {
  throw new Error(`Missing frontend build output: ${source}`);
}

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
