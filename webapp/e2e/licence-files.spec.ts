import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";

/** RFC-014 §5.5 and §8: the licences travel with the data, and OpenHolidays data does not travel at all. */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const flat = (s: string) => s.replace(/\s+/g, " ");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

test("webapp/NOTICE is the repository NOTICE, byte for byte (the image is built from webapp/)", () => {
  expect(read("NOTICE")).toBe(read("../NOTICE"));
});

test("NOTICE names both data licences and keeps PolyForm off the holiday data", () => {
  const notice = flat(read("NOTICE"));
  expect(notice).toContain("Public holiday rules: date-holidays, © commenthol.");
  expect(notice).toContain("CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/)");
  expect(notice).toContain("webapp/src/lib/holidays/data/LICENSE");
  expect(notice).toContain("The PolyForm Noncommercial License does not apply to this data.");
  expect(notice).toContain("fetched at runtime from the OpenHolidays API");
  expect(notice).toContain("Open Database License 1.0");
  expect(notice).toContain("is not distributed with Kinboard");
});

test("the data LICENSE ships beside the data", () => {
  expect(read("src/lib/holidays/data/LICENSE")).toContain("CC BY-SA 3.0");
});

test("the image copies both licences and fails its build without them", () => {
  const dockerfile = read("docker/Dockerfile");
  expect(dockerfile).toContain("COPY --from=builder /app/NOTICE ./licenses/NOTICE");
  expect(dockerfile).toContain("COPY --from=builder /app/src/lib/holidays/data/LICENSE ./licenses/date-holidays-LICENSE");
  expect(dockerfile).toContain("RUN test -f ./licenses/NOTICE && test -f ./licenses/date-holidays-LICENSE");
});

test("no OpenHolidays data ships: the fixture stays out of the build context and out of the app", () => {
  expect(read(".dockerignore").split("\n").map((l) => l.trim())).toContain("e2e");
  expect(read("e2e/fixtures/openholidays/README.md")).toContain("Open Database License");
  const ids = readdirSync(join(process.cwd(), "e2e/fixtures/openholidays"))
    .filter((f) => f.startsWith("school-"))
    .flatMap((f) => (JSON.parse(read(`e2e/fixtures/openholidays/${f}`)) as { id: string }[]).map((r) => r.id));
  expect(ids.length).toBeGreaterThan(20);
  const TEXT = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".css", ".html", ".md", ".txt"]);
  const shipped = [...walk(join(process.cwd(), "src")), ...walk(join(process.cwd(), "public"))]
    .filter((f) => TEXT.has(extname(f)))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
  for (const id of ids) expect(shipped.includes(id), id).toBe(false);
});

test("the fonts ship with their OFL, NOTICE names them, and the image carries the licences", () => {
  const dirs = readdirSync(join(process.cwd(), "src/assets/fonts"));
  expect(dirs.sort()).toEqual(["bricolage-grotesque", "hanken-grotesk", "space-mono"]);
  const notice = flat(read("NOTICE"));
  const dockerfile = read("docker/Dockerfile");
  for (const dir of dirs) {
    const files = readdirSync(join(process.cwd(), "src/assets/fonts", dir));
    expect(files.filter((f) => f.endsWith(".woff2")).length, dir).toBeGreaterThan(0);
    expect(read(`src/assets/fonts/${dir}/OFL.txt`)).toContain("SIL Open Font License, Version 1.1");
    expect(dockerfile).toContain(`COPY --from=builder /app/src/assets/fonts/${dir}/OFL.txt ./licenses/fonts/${dir}-OFL.txt`);
    expect(dockerfile).toContain(`test -f ./licenses/fonts/${dir}-OFL.txt`);
  }
  for (const name of ["Bricolage Grotesque", "Hanken Grotesk", "Space Mono"]) expect(notice).toContain(name);
  expect(notice).toContain("SIL Open Font License, Version 1.1");
});

test("no font is fetched from Google at build time", () => {
  // next/font/google downloads the files during `next build`; when Google is
  // unreachable the build dies. Every font comes from src/assets/fonts instead.
  const offenders = walk(join(process.cwd(), "src"))
    .filter((f) => [".ts", ".tsx", ".css"].includes(extname(f)))
    .filter((f) => /["']next\/font\/google["']|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(readFileSync(f, "utf8")));
  expect(offenders).toEqual([]);
});
