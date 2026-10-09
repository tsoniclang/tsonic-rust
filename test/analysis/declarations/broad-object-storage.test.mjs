import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../helpers/rust-session.mjs";
import { rustRuntimeCarrierKey } from "../../../dist/target-model/facts/selections.js";
import { rustBroadSourceValueTargetType } from "../../../dist/policy/types/resolution/broad-values.js";
import { rustEmptyObjectTargetType, rustJsArrayTargetType, rustTupleTargetType, rustVecTargetType } from "../../../dist/target-model/types/index.js";
import { rustStructuralObjectCarrierValue } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

for (const surfaces of [[], ["js"]]) {
  test(`declared broad objects retain their producer storage through containers on ${surfaces[0] ?? "native"}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
export function run(): boolean {
  const first: object = {};
  const values: object[] = [first];
  const pair: [object, object] = [first, {}];
  const holder: { value: object } = { value: first };
  const direct = {};
  const precise = [direct];
  return first === values[0] && first === pair[0] && first === holder.value && direct === precise[0];
}
` } });
    const { ast } = program.source;
    const carriers = new Map();
    const visit = node => {
      if (ast.is.IsVariableDeclaration(node)) {
        carriers.set(ast.text(ast.name(node)), program.facts.getFact(node, rustRuntimeCarrierKey)?.carrier);
      }
      ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
    };
    for (const sourceFile of program.sourceFiles) visit(sourceFile);
    const broad = rustBroadSourceValueTargetType(surfaces.length !== 0);
    const array = surfaces.length === 0 ? rustVecTargetType : rustJsArrayTargetType;
    for (const [name, expected] of [
      ["first", broad], ["values", array(broad)],
      ["pair", rustTupleTargetType([broad, broad])],
      ["direct", rustEmptyObjectTargetType()], ["precise", array(rustEmptyObjectTargetType())],
    ]) {
      assert.equal(rustTargetTypeRefEquals(carriers.get(name), expected), true, `${name} keeps its declared native storage`);
    }
    const holder = rustStructuralObjectCarrierValue(carriers.get("holder"));
    assert.equal(holder?.fields.length, 1);
    assert.equal(rustTargetTypeRefEquals(holder.fields[0].type, broad), true, "the record field agrees with its broad producer");
  });
}
