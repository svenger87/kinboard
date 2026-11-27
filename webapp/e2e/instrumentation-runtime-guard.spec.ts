import { test, expect } from "@playwright/test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

/**
 * src/instrumentation.ts must not pull the scheduler into the edge bundle.
 *
 * `next dev --webpack` compiles instrumentation.ts for the edge runtime too,
 * with process.env.NEXT_RUNTIME replaced by "edge". webpack drops a dynamic
 * import only when it sits in a branch that is dead; an early
 * `if (NEXT_RUNTIME !== "nodejs") return;` in front of it does not count.
 * After #550 the import survived, the edge compiler met `node:child_process`
 * in src/lib/schedule/start.ts ("UnhandledSchemeError"), and every request to
 * `next dev --webpack` answered 500. Turbopack and `next build` were fine, so
 * nothing in CI noticed.
 *
 * This compiles the real instrumentation.ts with Next's own webpack, the way
 * its edge and node compilers see it, against a stand-in for the scheduler
 * that imports `node:child_process` like the real one. Edge: no errors, and
 * the scheduler is not in the bundle. Node: the scheduler is in the bundle,
 * so the check cannot pass merely because the import went away.
 */

type Runtime = "edge" | "nodejs";

interface Compiled {
  errors: string[];
  modules: string[];
}

const nextWebpack = require("next/dist/compiled/webpack/webpack");

function compile(dir: string, runtime: Runtime): Promise<Compiled> {
  nextWebpack.init?.();
  const webpack = nextWebpack.webpack;
  const compiler = webpack({
    mode: "development",
    devtool: false,
    context: dir,
    entry: "./instrumentation.js",
    target: runtime === "edge" ? "webworker" : "node",
    output: { path: join(dir, `out-${runtime}`) },
    plugins: [new webpack.DefinePlugin({ "process.env.NEXT_RUNTIME": JSON.stringify(runtime) })],
  });
  return new Promise((resolve, reject) => {
    compiler.run((err: Error | null, stats: { toJson: (o: object) => { errors?: { message: string }[]; modules?: { name?: string }[] } }) => {
      compiler.close(() => {});
      if (err) return reject(err);
      const json = stats.toJson({ all: false, errors: true, modules: true });
      resolve({
        errors: (json.errors ?? []).map((e) => e.message),
        // webpack lists its runtime as a module without a name.
        modules: (json.modules ?? []).flatMap((m) => (m.name ? [m.name] : [])),
      });
    });
  });
}

let dir: string;

test.beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "kb-instrumentation-"));
  const source = readFileSync(join(__dirname, "..", "src", "instrumentation.ts"), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  writeFileSync(join(dir, "instrumentation.js"), js);
  mkdirSync(join(dir, "lib", "schedule"), { recursive: true });
  writeFileSync(
    join(dir, "lib", "schedule", "start.js"),
    'import { execFile } from "node:child_process";\nexport function startInternalScheduler() { return execFile; }\n',
  );
});

test.afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("the edge build of instrumentation.ts leaves the scheduler out", async () => {
  const { errors, modules } = await compile(dir, "edge");
  expect(errors).toEqual([]);
  expect(modules.filter((m) => m.includes("schedule/start"))).toEqual([]);
});

test("the node build of instrumentation.ts still loads the scheduler", async () => {
  const { errors, modules } = await compile(dir, "nodejs");
  expect(errors).toEqual([]);
  expect(modules.some((m) => m.includes("schedule/start"))).toBe(true);
});
