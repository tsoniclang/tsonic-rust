import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustErrorEffects } from "../../helpers/rust-error-analysis.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";

import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustCallableProtocol } from "../../../dist/target-model/types/carriers/callables.js";
import { rustStringTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { rustTargetGenericReferences } from "../../../dist/target-model/types/carriers/generic-references.js";

function returned(context, name) {
  const declaration = context.sourceStorage.nodes.find(node => context.ast.is.IsFunctionDeclaration(node) &&
    context.ast.text(context.ast.name(node)) === name);
  assert.equal(declaration !== undefined, true, name);
  const fact = context.records.sourceCallableReturn.get(declaration);
  assert.equal(fact !== undefined, true, `${name}: exact return fact`);
  return fact.returnCarrier;
}

test("normal constructors retain their receiver storage without querying a callable return", () => {
  const context = analyzeRustErrorEffects(`
    import type { int32 } from "@tsonic/core/types.js";
    import type { Life, Ref } from "@tsonic/rust/types.js";
    class Relay<Part> { constructor(readonly value: Part) {} }
    class Derived<Part> extends Relay<Part> { constructor(value: Part) { super(value); } }
    class Bare<Part> { constructor(readonly value: Part) { return; } }
    class Same<Part> { constructor(readonly value: Part) { return this; } }
    class Alias<Part> { constructor(readonly value: Part) { const receiver = this; return receiver; } }
    class Borrowed<Region extends Life> { constructor(readonly value: Ref<int32, Region>) {} }
    class Default { value = 3 as int32; }
  `, { surfaces: [] });
  const owners = new Set(["Relay", "Derived", "Bare", "Same", "Alias", "Borrowed"]);
  const constructors = context.sourceStorage.nodes.filter(node => {
    if (!context.ast.is.IsConstructorDeclaration(node)) return false;
    const owner = context.ast.parent(node);
    const name = owner === undefined ? undefined : context.ast.name(owner);
    return name !== undefined && owners.has(context.ast.text(name));
  });
  assert.equal(constructors.length, owners.size, "every original explicit constructor is covered");
  for (const declaration of constructors) {
    const name = context.ast.text(context.ast.name(context.ast.parent(declaration)));
    const selection = context.retainedEnvironments.environmentFor(declaration);
    assert.equal(selection.kind !== "unresolved", true, `${name}: ${selection.reason ?? "the construction receiver has complete storage"}`);
  }
});

test("retained getter returns preserve the selected contextual invocation arity through aliases", () => {
  const context = analyzeRustErrorEffects(`
    import type { int32 } from "@tsonic/core/types.js";
    type View = { readonly read: () => int32 };
    class Box {
      constructor(public value: int32) {}
      read = (): int32 => 3 as int32;
    }
    function view(owner: Box): View { return owner; }
    export function direct(): (unused: int32) => int32 { return view(new Box(1 as int32)).read; }
    export function alias(): (unused: int32) => int32 {
      const adapted: (unused: int32) => int32 = view(new Box(2 as int32)).read;
      return adapted;
    }
  `, { surfaces: [] });
  for (const name of ["direct", "alias"]) {
    const protocol = rustCallableProtocol(returned(context, name));
    assert.equal(protocol !== undefined, true, `${name}: the actual retained callable contract is published`);
    assert.equal(protocol.parameters.length, 1, `${name}: the selected unused argument is retained`);
    assert.equal(protocol.parameters[0].name, "int32", `${name}: the exact argument carrier is retained`);
    assert.equal(protocol.result.name, "int32", `${name}: the exact result carrier is retained`);
    assert.equal(protocol.error.id, "rust.program.TsonicError", `${name}: the getter error contract is retained`);
  }
});

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
    assert.deepEqual(carrier.genericArguments, [{ kind: "type", type: rustStringTargetType() }],
      `${name}: the native owned JsPromise<T> preserves its exact payload without an invented lifetime argument`);
    assert.deepEqual(rustTargetGenericReferences(carrier).lifetimes, [],
      `${name}: returned owned Promise storage has no borrowed native environment`);
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
  const carrier = returned(context, "unrelated");
  assert.equal(carrier.kind, "target-named");
  assert.equal(carrier.id, "rust.js.JsPromise");
  assert.deepEqual(carrier.genericArguments, [{ kind: "type", type: rustStringTargetType() }],
    "the native owned Promise retains its exact payload rather than an unrelated source loan");
  assert.deepEqual(rustTargetGenericReferences(carrier).lifetimes, [],
    "the unrelated Region loan cannot become a native Promise lifetime");
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
