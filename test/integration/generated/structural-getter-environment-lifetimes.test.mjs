import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  const surface = surfaces[0] ?? "native";
  test(`independent structural callable getters outlive a shorter capture and the view in ${surface}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: `independent_getter_lifetimes_${surface}` } },
      files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load, ref } from "@tsonic/rust/lang.js";
type Pair<Long extends Life, Short extends Life> = {
  readonly first: () => Ref<int32, Long>;
  readonly second: () => Ref<int32, Short>;
};
function pair<Long extends Life, Short extends Life>(left: Ref<int32, Long>, right: Ref<int32, Short>): Pair<Long, Short> {
  return { first: () => left, second: () => right };
}
function keepLong<Long extends Life>(left: Ref<int32, Long>): () => Ref<int32, Long> {
  const short = 7 as int32;
  const view = pair(left, ref(short));
  if (load(view.second()) !== 7) throw new Error("short capture");
  return view.first;
}
export function main(): void {
  const long = 31 as int32;
  const first = keepLong(ref(long));
  if (load(first()) !== 31) throw new Error("long capture after short and view end");
}
main();
` } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join("\n"));
    const executed = validateGeneratedProject(`independent-getter-lifetimes-${surface}`, result.artifacts, { run: true });
    assert.equal(executed.status, 0, executed.stderr);
  });

  test(`capture-free structural callable getters outlive their view temporary in ${surface}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: `capture_free_getter_${surface}` } },
      files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
type View<Value> = {
  readonly identity: (value: Value) => Value;
  readonly adapted: (value: Value, ignored: number) => Value;
  read(): Value;
};
class Box<Value> {
  constructor(public value: Value) {}
  identity = (value: Value): Value => value;
  adapted = (value: Value): Value => value;
  read(): Value { return this.value; }
}
function view<Value>(owner: Box<Value>): View<Value> { return owner; }
function detached(): (value: int32) => int32 { return view(new Box<int32>(3 as int32)).identity; }
function detachedAlias(): (value: int32) => int32 {
  const selected = view(new Box<int32>(5 as int32)).identity;
  return selected;
}
export function main(): void {
  const identity = detached();
  if (identity(17 as int32) !== 17) throw new Error("capture-free getter escaped temporary");
  const alias = detachedAlias();
  if (alias(23 as int32) !== 23) throw new Error("aliased capture-free getter escaped temporary");
}
main();
` } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join("\n"));
    const executed = validateGeneratedProject(`capture-free-getter-${surface}`, result.artifacts, { run: true });
    assert.equal(executed.status, 0, executed.stderr);
  });
}
