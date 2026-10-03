import assert from "node:assert/strict";
import test from "node:test";
import { lexicalGenericFunctionsSource } from "../../../../tsonic/test/fixtures/lexical-generic-functions.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`native lexical generics retain outer binders, transitive captures and shadowing in ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: `lexical_generic_${surfaces[0] ?? "native"}` } },
      files: { "index.ts": `${lexicalGenericFunctionsSource}
export function main(): void { if (run() !== 23 || readKeeper(19 as int32) !== 19) throw new Error("lexical generic result"); }
` } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(value => value.message).join("\n"));
    const executed = validateGeneratedProject(`lexical-generic-${surfaces[0] ?? "native"}`, [...result.artifacts, {
      path: "tests/capture_cost.rs",
      text: `use lexical_generic_${surfaces[0] ?? "native"}::{captureOuter, forwardOuter, shadowOuter};
use std::sync::atomic::{AtomicUsize, Ordering};

static CLONES: AtomicUsize = AtomicUsize::new(0);
static DROPS: AtomicUsize = AtomicUsize::new(0);

struct NonClone(usize);

impl Drop for NonClone {
    fn drop(&mut self) {
        DROPS.fetch_add(1, Ordering::SeqCst);
    }
}

struct Counted;

impl Clone for Counted {
    fn clone(&self) -> Self {
        CLONES.fetch_add(1, Ordering::SeqCst);
        Counted
    }
}

#[test]
fn once_only_captures_move_without_clone_bounds_or_copies() {
    let first = captureOuter(NonClone(7));
    let second = forwardOuter(NonClone(5));
    let third = shadowOuter(NonClone(11));
    assert_eq!(first.0 + second.0 + third.0, 23);
    assert_eq!(DROPS.load(Ordering::SeqCst), 0);
    drop((first, second, third));
    assert_eq!(DROPS.load(Ordering::SeqCst), 3);
    let _value = captureOuter(Counted);
    assert_eq!(CLONES.load(Ordering::SeqCst), 0);
}
`,
    }], { run: true });
    assert.equal(executed.status, 0, executed.stderr);
  });
  test(`native lexical captures retain named outer lifetimes in ${surfaces[0] ?? "native"}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces,
      target: { id: "rust", options: { outputType: "bin", crateName: `lexical_lifetime_${surfaces[0] ?? "native"}` } },
      files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref, ValidFor } from "@tsonic/rust/types.js";
import { load, ref } from "@tsonic/rust/lang.js";
function outer<Region extends Life, Value extends ValidFor<Region>>(value: Ref<Value, Region>): Ref<Value, Region> {
  function forward(inner: Ref<Value, Region>): Ref<Value, Region> { return inner; }
  function read(): Ref<Value, Region> { return value; }
  function through(): Ref<Value, Region> { return read(); }
  return forward(through());
}
export function main(): void {
  const value = 23 as int32;
  if (load(outer(ref(value))) !== 23) throw new Error("lexical lifetime result");
}
` } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(value => value.message).join("\n"));
    const executed = validateGeneratedProject(`lexical-lifetime-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
    assert.equal(executed.status, 0, executed.stderr);
  });
}
