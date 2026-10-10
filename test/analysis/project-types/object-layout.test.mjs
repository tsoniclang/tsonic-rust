import assert from "node:assert/strict";
import test from "node:test";
import { rustProjectObjectLayout } from "../../../dist/analysis/project-types/object-layout.js";
import { analyzeRustTargetProgram } from "../../../dist/analysis/program/index.js";
import { analyzeRust, compileRust } from "../../helpers/rust-session.mjs";

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
  const layout = rustProjectObjectLayout(declaration, ast);
  assert.deepEqual(layout.fields.map(({ sourceName, storageIndex }) => [sourceName, storageIndex]), [["count", 0], ["label", 1], ["0", 2]]);
  assert.deepEqual(layout.fields.map(({ declaration }) => declaration), members);
  assert.deepEqual(layout.fields.map(({ presence }) => presence), ["required", "optional", "required"]);
  assert.equal(Object.isFrozen(layout), true);
  assert.equal(Object.isFrozen(layout.fields), true);
  assert.equal(layout.fields.every(Object.isFrozen), true);
  assert.throws(() => { layout.fields[0].storageIndex = 4; }, TypeError);
  assert.equal(rustProjectObjectLayout({ ...declaration, members: [...members, field("KindComputedPropertyName", undefined)] }, ast), undefined);
  assert.equal(rustProjectObjectLayout({ ...declaration, members: [...members, field("KindIdentifier", "count")] }, ast), undefined);
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
  const layout = rustProjectObjectLayout(declaration, ast);
  assert.equal(layout.indexSignatures[0].declaration === index, true);
  assert.equal(layout.indexSignatures[0].keyParameter === parameter, true);
  assert.equal(Object.isFrozen(layout.indexSignatures), true);
  assert.equal(Object.isFrozen(layout.indexSignatures[0]), true);
  assert.throws(() => { layout.indexSignatures[0].keyParameter = {}; }, TypeError);
  for (const parameters of [[], [parameter, parameter]]) {
    assert.equal(rustProjectObjectLayout({ ...declaration,
      members: [{ ...index, parameters }] }, ast), undefined);
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
  let program;
  const compilation = compileRust({ surfaces: ["js"], files: { "index.ts": checkedLayoutSource },
    compileTarget(request) {
      const ast = new Proxy({ ...request.input.source.ast }, {
        get(reader, key) {
          assert.equal(allowSyntax, true, "sealed project layout lookup cannot inspect source syntax");
          const value = Reflect.get(reader, key);
          return typeof value === "function" ? value.bind(reader) : value;
        },
      });
      const result = analyzeRustTargetProgram({ ...request, input: { ...request.input,
        source: { ...request.input.source, ast } } });
      if (result.kind === "rejected") return result;
      program = result.value;
      return { kind: "resolved", value: { artifacts: [] }, diagnostics: [] };
    },
  });
  assert.deepEqual(compilation.result.diagnostics.map(({ code, message }) => ({ code, message })), []);
  assert.equal(program !== undefined, true);
  const foreign = analyzeRust({ surfaces: ["js"], files: { "index.ts": checkedLayoutSource } }).program;
  allowSyntax = false;
  const policy = program.projectTypes;
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
    assert.equal(policy.objectLayoutForDefinition({ ...definition }), undefined, name + " forged definition");
    const foreignDefinition = foreign.projectTypes.definitions.find(candidate => candidate.sourceName === name);
    assert.equal(foreignDefinition !== undefined, true, name + " independent checker definition");
    assert.equal(policy.objectLayoutForDefinition(foreignDefinition), undefined, name + " foreign identity");
    if (name === "Fields") {
      assert.equal(layout.indexSignatures.length, 1);
      assert.equal(Object.isFrozen(layout.indexSignatures[0]), true);
    }
  }
  const child = policy.definitions.find(candidate => candidate.sourceName === "Child");
  assert.deepEqual(policy.classLineage(child).map(definition => definition.sourceName), ["Base", "Child"]);
});
