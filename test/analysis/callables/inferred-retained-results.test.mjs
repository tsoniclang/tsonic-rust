import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";

import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

function returned(context, name) {
  const declaration = context.sourceStorage.nodes.find(node => context.ast.is.IsFunctionDeclaration(node) &&
    context.ast.text(context.ast.name(node)) === name);
  assert.equal(declaration !== undefined, true, name);
  const fact = context.records.sourceCallableReturn.get(declaration);
  assert.equal(fact !== undefined, true, `${name}: exact return fact`);
  return fact.returnCarrier;
}

test("annotated returned Promise storage preserves the selected invocation lifetime through aliases and branches", () => {
  const context = analyzeRustErrorEffects(`
    export function direct(callback: () => Promise<string>): Promise<string> { return callback(); }
    export function alias(callback: () => Promise<string>): Promise<string> { const value = callback(); return value; }
    export function selected(left: () => Promise<string>, right: () => Promise<string>, choose: boolean): Promise<string> {
      return choose ? left() : right();
    }
  `);
  for (const name of ["direct", "alias", "selected"]) {
    const carrier = returned(context, name);
    assert.equal(carrier.kind, "target-named", name);
    assert.equal(carrier.id, "rust.js.JsPromise", name);
    assert.deepEqual(carrier.genericArguments[0], { kind: "lifetime", lifetime: { kind: "static" } }, name);
  }
});

test("unrelated parameter loans do not become returned owned Promise lifetimes", () => {
  const context = analyzeRustErrorEffects(`
    import type { Life, Ref } from "@tsonic/rust/types.js";
    import type { int32 } from "@tsonic/core/types.js";
    export function unrelated<Region extends Life>(callback: () => Promise<string>, value: Ref<int32, Region>): Promise<string> {
      return callback();
    }
  `);
  assert.deepEqual(returned(context, "unrelated").genericArguments[0], { kind: "lifetime", lifetime: { kind: "static" } });
});

test("return refinement preserves explicit native borrow lifetimes and declared numeric carriers", () => {
  const context = analyzeRustErrorEffects(`
    import type { Life, Ref } from "@tsonic/rust/types.js";
    import type { int32 } from "@tsonic/core/types.js";
    export function borrowed<Region extends Life>(value: Ref<int32, Region>): Ref<int32, Region> { return value; }
    export function numeric(value: int32): number { return value; }
  `, { surfaces: [] });
  const borrow = returned(context, "borrowed");
  assert.equal(borrow.kind, "reference");
  assert.equal(borrow.lifetime.kind, "parameter");
  assert.equal(borrow.lifetime.name, "Region");
  assert.equal(rustTargetTypeRefEquals(returned(context, "numeric"), { kind: "source-primitive", name: "float64" }), true);
});

test("return lifetime refinement never admits an incompatible Promise payload", () => {
  assert.throws(() => compileRust({ surfaces: ["js"], files: { "index.ts": `
    export function invalid(callback: () => Promise<string>): Promise<number> { return callback(); }
  ` } }), /TS2322: Type 'Promise<string>' is not assignable to type 'Promise<number>'/u);
});
