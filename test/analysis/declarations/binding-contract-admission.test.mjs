import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { Node_Initializer } from "@tsonic/target-api/source";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import * as bindingStorage from "../../../dist/analysis/declarations/binding-storage.js";
import { rustCallableProtocol } from "../../../dist/target-model/types/carriers/callables.js";

function declaration(program, name) {
  const nodes = [];
  const ast = program.source.ast;
  const visit = node => {
    if (ast.is.IsVariableDeclaration(node) && ast.text(ast.name(node)) === name) nodes.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(nodes.length, 1, `${name}: one original checked binding`);
  return nodes[0];
}

test("authored callable contracts publish the admitted initializer destination rather than signature storage", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": `
    import type { int32 } from "@tsonic/core/types.js";
    export function adapt(callback: () => int32): (value: int32) => int32 {
      const selected: (value: int32) => int32 = callback;
      return selected;
    }
  ` } });
  const selected = declaration(program, "selected");
  const initializer = Node_Initializer(program.source.ast, selected);
  const conversion = program.records.contextualValueConversion.get(initializer);
  assert.equal(conversion?.conversion.kind, "callable-adapter", "the actual annotation requires an argument adapter");
  const carrier = program.records.runtimeCarrier.get(selected)?.carrier;
  assert.equal(carrier !== undefined, true, "the declaration publishes physical storage only after initializer admission");
  assert.equal(rustTargetTypeRefEquals(carrier, conversion.targetCarrier), true,
    "the one declaration owner publishes exactly the contextual adapter's selected native destination");
  assert.equal(bindingStorage.resolveRustDeclaredBindingStorage, undefined,
    "the superseded annotation-as-storage API has no compatibility route");
});

test("closed native scalar contracts and initializer-less later writes retain exact binding storage", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": `
    import type { int32, int64 } from "@tsonic/core/types.js";
    export function read(value: int32): int64 {
      const wide: int64 = value;
      let later: int32;
      later = value;
      return wide + later;
    }
  ` } });
  for (const [name, expected] of [["wide", "int64"], ["later", "int32"]]) {
    const selected = declaration(program, name);
    const carrier = program.records.runtimeCarrier.get(selected)?.carrier;
    assert.equal(carrier?.kind, "source-primitive", `${name}: no erased callable or boxed carrier is introduced`);
    assert.equal(carrier.name, expected, `${name}: the exact native width remains authoritative`);
    if (name === "later") assert.equal(Node_Initializer(program.source.ast, selected), undefined,
      "a legitimate later write does not acquire a fabricated initialization requirement");
  }
});

test("authored binding aliases retain nested native tuple and callable component evidence", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": `
    import type { int32, int64 } from "@tsonic/core/types.js";
    type Wide = int64;
    type NativeRow = [int32, Wide];
    type Callback = (value: int32) => Wide;
    export function copy(value: NativeRow): NativeRow {
      const row: NativeRow = value;
      return row;
    }
    export function retain(callback: Callback): Callback {
      const selected: Callback = callback;
      return selected;
    }
  ` } });
  const row = program.records.runtimeCarrier.get(declaration(program, "row"))?.carrier;
  assert.equal(row?.kind, "tuple", "the authored alias retains its native tuple representation");
  for (const [index, expected] of [[0, "int32"], [1, "int64"]]) {
    assert.equal(row.elements[index].kind, "source-primitive", `element ${index}: exact native scalar representation`);
    assert.equal(row.elements[index].name, expected, `element ${index}: the authored native width survives alias resolution`);
  }
  const callable = rustCallableProtocol(program.records.runtimeCarrier.get(declaration(program, "selected"))?.carrier);
  assert.equal(callable !== undefined, true, "the checked callable alias has its actual admitted physical signature");
  assert.equal(callable.parameters[0].kind, "source-primitive", "the native callable input retains its scalar representation");
  assert.equal(callable.parameters[0].name, "int32", "the callable argument does not inherit the erased checker number");
  assert.equal(callable.result.kind, "source-primitive", "the native callable output retains its scalar representation");
  assert.equal(callable.result.name, "int64", "the aliased return component retains its exact native width");
});
