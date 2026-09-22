import assert from "node:assert/strict";
import test from "node:test";
import { createRustGenericCallablePlan } from "../../../dist/analysis/callables/generic-values.js";
import { rustGenericCallableTargetType } from "../../../dist/target-model/types/carriers/generic-callables.js";
import { rustClosureCaptureFactKey, rustTargetOperationFactKey } from "../../../dist/analysis/facts/keys.js";

const parameter = { kind: "type-parameter", name: "Value" };
function input() {
  const files = ["first", "second"].map(name => ({ name: `/${name}.ts`, nodes: [] }));
  const closures = files.map((file, index) => {
    const node = { file, position: index + 1 };
    node.carrier = rustGenericCallableTargetType(["Value"], [parameter], parameter, {
      fileName: file.name, declarationIdentity: `${file.name}:1`,
    });
    file.nodes.push(node);
    return node;
  });
  const ast = {
    forEachChild: (node, visit) => { for (const child of node.nodes ?? []) visit(child); },
    getSourceFile: node => node.file,
    getFileName: file => file.name,
    pos: node => node.position,
    end: node => node.position + 1,
  };
  const facts = { getFact: (node, key) => {
    if (!closures.includes(node)) return undefined;
    if (key === rustTargetOperationFactKey) return { kind: "closure", resultCarrier: node.carrier };
    if (key === rustClosureCaptureFactKey) return { captures: [] };
    return undefined;
  } };
  const names = { nameForDeclaration: () => undefined, functionNameForDeclaration: () => undefined, callableValueNameForDeclaration: () => undefined };
  const navigation = { expressionValueFlow: node => ({ escapes: node === closures[1], identityCompared: false,
    hasUnclassifiedUse: false, captured: false }) };
  return { closures, create: () => createRustGenericCallablePlan(ast, files, facts, names, navigation) };
}

test("unrelated equal-signature implementations do not acquire a common owner or storage policy", () => {
  const { closures, create } = input();
  const plan = create();
  assert.deepEqual(plan.issues, []);
  assert.equal(plan.definitions.length, 2);
  const first = plan.definitionFor(closures[0].carrier);
  const second = plan.definitionFor(closures[1].carrier);
  assert.notEqual(first.identity, second.identity);
  assert.deepEqual(first.implementations.map(value => value.declaration), [closures[0]]);
  assert.deepEqual(second.implementations.map(value => value.declaration), [closures[1]]);
  assert.equal(first.ownerFileName, "/first.ts");
  assert.equal(second.ownerFileName, "/second.ts");
  assert.equal(first.storage, "value");
  assert.equal(second.storage, "shared");
  assert.equal(plan.definitionFor(structuredClone(closures[0].carrier)), first);
});

test("implementations selected for one exact contextual contract share its native representation", () => {
  const { closures, create } = input();
  closures[1].carrier = closures[0].carrier;
  const plan = create();
  assert.deepEqual(plan.issues, []);
  assert.equal(plan.definitions.length, 1);
  assert.equal(plan.definitions[0].implementations.length, 2);
  assert.equal(plan.definitions[0].storage, "shared");
});

test("contradictory signatures under one origin fail closed instead of selecting another family", () => {
  const { closures, create } = input();
  closures[1].carrier = rustGenericCallableTargetType(["Value"], [parameter], { kind: "source-primitive", name: "float64" }, closures[0].carrier.value.origin);
  const plan = create();
  assert.equal(plan.issues.length, 1);
  assert.match(plan.issues[0].message, /conflicting native signatures/u);
  assert.equal(plan.definitionFor(closures[1].carrier), undefined);
});
