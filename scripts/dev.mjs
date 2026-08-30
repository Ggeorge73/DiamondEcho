import { spawn } from "node:child_process";

const child = spawn("npm", ["--prefix", "frontend", "run", "start"], {
  stdio: "inherit",
  env: {
    ...process.env,
    BROWSER: "none",
    HOST: "0.0.0.0",
    PORT: process.env.PORT || "4173",
  },
});

child.on("exit", (code) => process.exit(code ?? 0));
