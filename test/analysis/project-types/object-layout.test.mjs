import assert from "node:assert/strict";
import test from "node:test";
import { rustProjectObjectLayout } from "../../../dist/analysis/project-types/object-layout.js";
import { analyzeRustAnalysisProgram } from "../../../dist/analysis/program/index.js";
import { compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustCheckedContext } from "../../helpers/rust-session-analysis-context.mjs";

test("project layouts read only admitted leaf names and never partial computed fields", () => {
  const field = (kind, value, optional = false) => ({ kind: "KindPropertySignature", name: { kind, value }, optional });
  const members = [field("KindIdentifier", "count"), field("KindStringLiteral", "label", true), field("KindNumericLiteral", "0")];
  const declaration = { kind: "KindInterfaceDeclaration", members };
  const ast = {
    kindName(node) { return node.kind; },
    members(node) { return node.members; },
    name(node) { return node.name; },
    questionToken(node) { return node.optional ? {} : undefined; },
    text(node) {
      assert.notEqual(node.kind, "KindComputedPropertyName", "composite AST node text must not be queried");
      return node.value;
    },
  };
  const names = new WeakMap([[members[2].name, Object.freeze({ kind: "resolved", name: "0" })]]);
  const semanticsFor = () => ({ propertyNames: { get: node => names.get(node) } });
  const layout = rustProjectObjectLayout(declaration, ast, semanticsFor);
  assert.deepEqual(layout.fields.map(({ sourceName, storageIndex }) => [sourceName, storageIndex]), [["count", 0], ["label", 1], ["0", 2]]);
  assert.deepEqual(layout.fields.map(({ declaration }) => declaration), members);
  assert.deepEqual(layout.fields.map(({ presence }) => presence), ["required", "optional", "required"]);
  assert.equal(Object.isFrozen(layout), true);
  assert.equal(Object.isFrozen(layout.fields), true);
  assert.equal(layout.fields.every(Object.isFrozen), true);
  assert.throws(() => { layout.fields[0].storageIndex = 4; }, TypeError);
  assert.equal(rustProjectObjectLayout({ ...declaration, members: [...members, field("KindComputedPropertyName", undefined)] }, ast, semanticsFor), undefined);
  assert.equal(rustProjectObjectLayout({ ...declaration, members: [...members, field("KindIdentifier", "count")] }, ast, semanticsFor), undefined);
  const computed = field("KindComputedPropertyName", undefined);
  names.set(computed.name, Object.freeze({ kind: "resolved", name: "computed" }));
  const admitted = rustProjectObjectLayout({ ...declaration, members: [...members, computed] }, ast, semanticsFor);
  assert.equal(admitted.fields[3].sourceName, "computed", "admitted computed field uses its exact shared key");
  assert.equal(admitted.fields[3].declaration === computed, true, "admitted field preserves its original declaration identity");
});

test("project index layouts freeze exact key declarations and reject malformed signatures", () => {
  const parameter = { kind: "KindParameter" };
  const index = { kind: "KindIndexSignature", parameters: [parameter] };
  const declaration = { kind: "KindInterfaceDeclaration", members: [index] };
  const ast = {
    kindName: node => node.kind,
    members: node => node.members,
    parameters: node => node.parameters,
  };
  const semanticsFor = () => ({ propertyNames: { get: () => undefined } });
  const layout = rustProjectObjectLayout(declaration, ast, semanticsFor);
  assert.equal(layout.indexSignatures[0].declaration === index, true);
  assert.equal(layout.indexSignatures[0].keyParameter === parameter, true);
  assert.equal(Object.isFrozen(layout.indexSignatures), true);
  assert.equal(Object.isFrozen(layout.indexSignatures[0]), true);
  assert.throws(() => { layout.indexSignatures[0].keyParameter = {}; }, TypeError);
  for (const parameters of [[], [parameter, parameter]]) {
    assert.equal(rustProjectObjectLayout({ ...declaration,
      members: [{ ...index, parameters }] }, ast, semanticsFor), undefined);
  }
});

const checkedLayoutSource = `
export class Base<T> {
  static counter: number = 0;
  declare typeOnly: T;
  optional?: T;
  constructor(public current: T) {}
}
export class Child extends Base<number> {
  extra: number = 2;
  constructor() { super(1); }
}
export interface Fields {
  name: string;
  optional?: number;
  [key: string]: string | number | undefined;
}
`;

test("checked project definitions publish one immutable exact layout without post-analysis syntax reads", () => {
  let allowSyntax = true;
  const checkedPolicy = () => {
    let policy;
    const compilation = compileRust({ surfaces: ["js"], files: { "index.ts": checkedLayoutSource },
    compileTarget(request) {
      const ast = new Proxy({ ...request.input.source.ast }, {
        get(reader, key) {
          assert.equal(allowSyntax, true, "sealed project layout lookup cannot inspect source syntax");
          const value = Reflect.get(reader, key);
          return typeof value === "function" ? value.bind(reader) : value;
        },
      });
      const context = analyzeRustCheckedContext({ ...request, input: { ...request.input,
        source: { ...request.input.source, ast } } });
      policy = context.projectTypes.seal();
      if (context.diagnostics.length !== 0) return { kind: "rejected", diagnostics: context.diagnostics };
      return { kind: "resolved", value: { artifacts: [] }, diagnostics: [] };
    },
  });
    assert.equal(compilation.result.diagnostics.length, 1, "the existing mixed native layout refusal has one owner");
    assert.deepEqual(compilation.result.diagnostics.map(({ code, message }) => ({ code, message })), [{
      code: "RUST_INTERFACE_INDEX_LAYOUT_NOT_SUPPORTED",
      message: "Rust index-backed interfaces require exactly one index signature and no separately stored property signatures.",
    }]);
    assert.equal(policy !== undefined, true, "the exact checked layout owner seals before native declaration admission");
    return policy;
  };
  const policy = checkedPolicy();
  const foreign = checkedPolicy();
  allowSyntax = false;
  assert.equal(Object.isFrozen(policy), true);
  for (const [name, expected] of [["Base", [["optional", 0, "optional"], ["current", 1, "required"]]],
    ["Child", [["extra", 0, "required"]]], ["Fields", [["name", 0, "required"], ["optional", 1, "optional"]]]]) {
    const definition = policy.definitions.find(candidate => candidate.sourceName === name);
    assert.equal(definition !== undefined, true, name + " exact checked definition");
    const layout = policy.objectLayoutForDefinition(definition);
    assert.equal(layout !== undefined, true, name + " published layout");
    assert.equal(layout.declaration === definition.declaration, true, name + " owner identity");
    assert.equal(policy.objectLayoutForDefinition(definition) === layout, true, name + " one sealed value");
    assert.deepEqual(layout.fields.map(({ sourceName, storageIndex, presence }) =>
      [sourceName, storageIndex, presence]), expected);
    assert.equal(Object.isFrozen(layout), true);
    assert.equal(layout.fields.every(Object.isFrozen), true);
    assert.equal(policy.objectLayoutForDefinition({ ...definition }) === undefined, true, name + " forged definition");
    const foreignDefinition = foreign.definitions.find(candidate => candidate.sourceName === name);
    assert.equal(foreignDefinition !== undefined, true, name + " independent checker definition");
    assert.equal(policy.objectLayoutForDefinition(foreignDefinition) === undefined, true, name + " foreign identity");
    if (name === "Fields") {
      assert.equal(layout.indexSignatures.length, 1);
      assert.equal(Object.isFrozen(layout.indexSignatures[0]), true);
    }
  }
  const child = policy.definitions.find(candidate => candidate.sourceName === "Child");
  assert.deepEqual(policy.classLineage(child).map(definition => definition.sourceName), ["Base", "Child"]);
});

test("the same mixed checked layout is refused before native declaration publication", () => {
  let published = false;
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": checkedLayoutSource },
    compileTarget(request) {
      const selected = analyzeRustAnalysisProgram(request);
      if (selected.kind === "resolved") published = true;
      return selected.kind === "rejected" ? selected
        : { kind: "resolved", value: { artifacts: [] }, diagnostics: [] };
    },
  });
  assert.equal(result.diagnostics.length, 1, "the existing mixed index/native-storage refusal has one owner");
  assert.equal(result.diagnostics[0].code, "RUST_INTERFACE_INDEX_LAYOUT_NOT_SUPPORTED");
  assert.equal(result.diagnostics[0].message,
    "Rust index-backed interfaces require exactly one index signature and no separately stored property signatures.");
  assert.equal(published, false, "the unsupported native declaration never reaches program publication");
  assert.equal(result.program === undefined && result.plan === undefined, true, "no native program or plan is published");
  assert.equal(result.artifacts.length, 0, "the original mixed form has no native output");
});
