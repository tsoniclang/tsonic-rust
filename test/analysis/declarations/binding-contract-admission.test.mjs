import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { Node_Initializer } from "@tsonic/target-api/source";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import * as bindingStorage from "../../../dist/analysis/declarations/binding-storage.js";

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
