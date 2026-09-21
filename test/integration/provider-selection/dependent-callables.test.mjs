import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

function compileAndRun(name, source) {
  const { result } = compileRust({
    surfaces: ["js"],
    packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: name } },
    files: { "index.ts": `import { check } from "@acme/testing";\n${source}` },
  });
  assert.deepEqual(result.diagnostics, []);
  const native = validateGeneratedProject(name, result.artifacts, { run: true });
  assert.equal(native.status, 0, native.stdout + native.stderr);
  return result.artifacts;
}

test("checker-selected computed members retain receiver/key/value order and aliasing", { timeout: 300_000 }, () => {
  compileAndRun("computed_member_order", `
let events = "";
const original = { count: 1, label: "original" };
const replacement = { count: 40, label: "replacement" };
let selected = original;
function receiver(): { count: number; label: string } {
  events += "r";
  return selected;
}
function key(): "count" {
  events += "k";
  selected = replacement;
  return "count";
}
function value(): number { events += "v"; return 7; }
function missing(): { count: number } | undefined { return undefined; }
export function main(): void {
  receiver()[key()] = value();
  check(events === "rkv" && original.count === 7 && replacement.count === 40);
  selected = original;
  events = "";
  const previous = receiver()[key()]++;
  check(events === "rk" && previous === 7 && original.count === 8);
  selected = original;
  events = "";
  receiver()[key()] += value();
  check(events === "rkv" && original.count === 15 && replacement.count === 40);
  events = "";
  check(missing()?.[key()] === undefined && events === "");
  original["label"] = "changed";
  check(original["label"] === "changed" && original["count"] === 15);
}
`);
});

test("computed accessors retain get/set order and exception behavior", { timeout: 300_000 }, () => {
  compileAndRun("computed_accessor_order", `
let events = "";
class Box {
  private stored: number = 3;
  get count(): number { events += "g"; return this.stored; }
  set count(value: number) { events += "s"; this.stored = value; }
}
function key(): "count" { events += "k"; return "count"; }
function operand(): number { events += "v"; return 4; }
function failingKey(): "count" { throw new Error("key"); }
export function main(): void {
  const box = new Box();
  box[key()] = operand();
  check(events === "kvs");
  events = "";
  box[key()] += operand();
  check(events === "kgvs");
  events = "";
  const before = box[key()]++;
  check(before === 8 && events === "kgs");
  events = "";
  let caught = false;
  try { box[failingKey()] = operand(); } catch { caught = true; }
  check(caught && events === "" && box["count"] === 9);
}
`);
});

test("dependent indexed callbacks retain distinct field types and writes", { timeout: 300_000 }, () => {
  compileAndRun("dependent_indexed_callbacks", `
function change<Source, Key extends keyof Source>(source: Source, key: Key,
  copy: (value: Source[Key]) => Source[Key]): void {
  source[key] = copy(source[key]);
}
export function main(): void {
  const first = { count: 3, label: "old" };
  const second = { count: 20, label: "second" };
  const alias = first;
  change(first, "count", value => value + 4);
  change(first, "label", value => value + "!");
  change(second, "count", value => value - 2);
  check(alias.count === 7 && alias.label === "old!");
  check(second.count === 18 && second.label === "second");
}
`);
});

test("generic callable fields preserve independent captures and shared aliases", { timeout: 300_000 }, () => {
  compileAndRun("captured_generic_fields", `
interface Builder { readonly copy: <Value>(value: Value) => Value; }
function create(onCall: () => void): Builder {
  const copy = <Value>(value: Value): Value => { onCall(); return value; };
  return { copy };
}
export function main(): void {
  let firstCalls = 0;
  let secondCalls = 0;
  const first = create(() => { firstCalls++; });
  const second = create(() => { secondCalls++; });
  const alias = first;
  check(first.copy(7) === 7);
  check(alias.copy("first") === "first");
  check(second.copy(false) === false);
  const data = { count: 4 };
  const copied = second.copy(data);
  copied.count = 9;
  check(data.count === 9 && firstCalls === 2 && secondCalls === 2);
}
`);
});
