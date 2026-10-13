import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

const cases = [
  ["wide", `
    import type { int64 } from "@tsonic/core/types.js";
    const wide: int64 = 9007199254740993n;
    function fail(): never { throw new Error("absent"); }
    function call(read: ((value: int64) => int64) | null | undefined): int64 { return (read ?? fail())(wide); }
    function relay(read: ((value: int64) => int64) | null | undefined): int64 { return call(read); }
    export function main(): void {
      if (relay(value => value) !== wide) throw new Error("wide result changed");
      let caught = 0;
      try { relay(null); } catch { caught++; }
      try { relay(undefined); } catch { caught++; }
      if (caught !== 2) throw new Error("native absence changed");
    }
    main();
  `],
  ["generic", `
    import type { int64 } from "@tsonic/core/types.js";
    function fail(): never { throw new Error("absent"); }
    function call<Value>(value: Value, read: ((value: Value) => Value) | undefined): Value { return (read ?? fail())(value); }
    export function main(): void {
      const wide: int64 = 9007199254740993n;
      if (call(wide, value => value) !== wide) throw new Error("generic result changed");
      let caught = false;
      try { call(wide, undefined); } catch { caught = true; }
      if (!caught) throw new Error("generic absence changed");
    }
    main();
  `],
  ["future", `
    function fail(): never { throw new Error("absent"); }
    async function read(): Promise<number> { return 7; }
    async function call(callback: (() => Promise<number>) | undefined): Promise<number> { return await (callback ?? fail())(); }
    export async function main(): Promise<void> {
      if (await call(read) !== 7) throw new Error("future result changed");
      let caught = false;
      try { await call(undefined); } catch { caught = true; }
      if (!caught) throw new Error("future absence changed");
    }
    await main();
  `],
];

for (const surfaces of [[], ["js"]]) {
  for (const [name, source] of cases) {
    test(`native ${name} callable absence retains its type, errors and observations (${surfaces[0] ?? "native"})`, { timeout: 300_000 }, () => {
      const { result } = compileRust({ surfaces,
        target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": source } });
      assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => `${row.code}: ${row.message}`).join("\n"));
      const code = artifactText(result, "src/index.rs");
      assert.doesNotMatch(code, /transmute|Box::leak|9007199254740992|i64_to_f64/u);
      validateGeneratedProject(`native-absence-${name}-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
    });
  }
}
