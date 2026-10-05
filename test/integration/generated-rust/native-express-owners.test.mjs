import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

const cases = [
  ["async-object-unit", `
async function fail(): Promise<void> { throw new Error("selected rejection"); }
const api = { async dispatch(): Promise<void> { await fail(); } };
export async function main(): Promise<void> {
  let caught = false;
  try { await api.dispatch(); } catch { caught = true; }
  if (!caught) throw new Error("async object method lost its rejection");
}
`],
  ["caught-record-contribution", `
interface Envelope { value: unknown; }
const failure = new Error("selected rejection");
function fail(): never { throw failure; }
function capture(): Envelope {
  try { fail(); } catch (error) { return { value: error }; }
}
export function main(): void {
  const result = capture();
  if (!(result.value instanceof Error) || result.value !== failure) {
    throw new Error("record contribution lost its error");
  }
}
`],
  ["try-definite-initialization", `
function value(fail: boolean): string {
  if (fail) throw new Error("selected rejection");
  return "initialized";
}
async function select(fail: boolean): Promise<string> {
  let selected: string;
  try { selected = value(fail); } catch { return "caught"; }
  return selected;
}
export async function main(): Promise<void> {
  if (await select(false) !== "initialized" || await select(true) !== "caught") {
    throw new Error("definite initialization or catch completion changed");
  }
}
`],
];

for (const surfaces of [[], ["js"]]) {
  for (const [name, source] of cases) {
    test(`native owner ${name} (${surfaces.length === 0 ? "native" : "js"})`, { timeout: 300_000 }, () => {
      const { result } = compileRust({
        surfaces,
        target: { id: "rust", options: { outputType: "bin", crateName: name.replaceAll("-", "_") } },
        files: { "index.ts": source },
      });
      assert.equal(result.diagnostics.length, 0,
        result.diagnostics.slice(0, 6).map(row => row.message.slice(0, 256)).join("\n"));
      validateGeneratedProject(name, result.artifacts, { run: true });
    });
  }
}
