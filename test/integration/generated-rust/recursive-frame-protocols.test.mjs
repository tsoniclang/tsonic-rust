import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

const cases = [
  {
    name: "same-activation-alias",
    source: `
function create(): (count: number) => number {
  let selected = (count: number): number => count === 0 ? 1 : selected(count - 1);
  const original = selected;
  const alias = original;
  selected = (count: number): number => count === 0 ? 2 : selected(count - 1);
  selected = alias;
  return original;
}
export function main(): void {
  const callback = create();
  if (callback(0) !== 1 || callback(1) !== 1 || callback(8) !== 1)
    throw new Error("same-activation alias entry rebinding");
}
`,
  },
  {
    name: "generic-seed",
    source: `
function create<T>(seed: T): (count: number) => T {
  let selected = (count: number): T => count === 0 ? seed : selected(count - 1);
  const before = selected;
  selected = (count: number): T => count === 0 ? seed : selected(count - 1);
  return before;
}
export function main(): void {
  const first = create("seed");
  const alias = first;
  const other = create("other");
  if (first !== alias || first === other || first(4) !== "seed" || other(2) !== "other")
    throw new Error("generic frame seed and identity");
}
`,
  },
  {
    name: "hygienic-parameters",
    source: `
function create(): (frame_owner: number, frame_state: number) => number {
  let selected = (frame_owner: number, frame_state: number): number =>
    frame_owner === 0 ? frame_state : selected(frame_owner - 1, frame_state);
  const before = selected;
  selected = (frame_owner: number, frame_state: number): number =>
    frame_owner === 0 ? frame_state : selected(frame_owner - 1, frame_state);
  return before;
}
export function main(): void {
  const callback = create();
  if (callback(4, 7) !== 7) throw new Error("frame helper parameter hygiene");
}
`,
  },
  {
    name: "per-evaluation-captures",
    source: `
function create(): (count: number) => number {
  let selected = (count: number): number => count === 0 ? 1 : selected(count - 1);
  const before = selected;
  for (let index = 0; index < 2; index++) {
    const captured = index + 3;
    selected = (count: number): number => count === 0 ? captured : selected(count - 1);
  }
  return before;
}
export function main(): void {
  const callback = create();
  if (callback(0) !== 1 || callback(1) !== 4 || callback(8) !== 4)
    throw new Error("per-evaluation frame capture");
}
`,
  },
];

for (const current of cases) for (const profile of ["native", "js"]) {
  test(`${current.name} closed frame protocol compiles and executes in ${profile}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: profile === "native" ? [] : ["js"],
      target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": current.source } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.slice(0, 4).map(row => row.message.slice(0, 256)).join("\n"));
    validateGeneratedProject(`recursive-frame-${current.name}-${profile}`, result.artifacts, { run: true });
  });
}
