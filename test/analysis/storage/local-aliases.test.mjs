import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRustLocalStorageAliases } from "../../../dist/analysis/storage/local-aliases.js";
import { rustBindingStorageFactKey, rustMutatedReferentFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustNativeArrayStorageKey } from "../../../dist/target-model/operations/native-memory.js";

function fixture() {
  const callable = { kind: "function" };
  const initializer = { kind: "array-literal" };
  const owner = { kind: "variable", parent: callable, Initializer: initializer };
  const reference = { kind: "identifier" };
  const alias = { kind: "variable", parent: callable, Initializer: reference };
  reference.parent = alias;
  const argument = { kind: "identifier" };
  const member = { kind: "identifier" };
  const carrier = { kind: "array", element: { kind: "source-primitive", name: "int64" } };
  const flow = { aliasDeclarations: [owner, alias], uses: [
    { reference, role: "storage" }, { reference: argument, role: "argument" },
    { reference: member, role: "write", throughMember: true },
  ] };
  const summaries = new Map([owner, alias].map(declaration => [declaration, { memberWritten: declaration === alias }]));
  const carriers = new Map([owner, alias].map(declaration => [declaration, carrier]));
  const promoted = new Map();
  const modes = new Map([[argument, "borrow-mut"]]);
  const ast = { is: {
    IsVariableDeclaration: node => node.kind === "variable",
    IsArrayLiteralExpression: node => node.kind === "array-literal",
    IsIdentifier: node => node.kind === "identifier",
    IsFunctionDeclaration: node => node.kind === "function",
    IsFunctionExpression: () => false, IsArrowFunction: () => false,
  }, as: { AsVariableDeclaration: node => node.kind === "variable" ? node : undefined },
  typeNode: node => node.Type, kindName: node => node.kind, parent: node => node.parent,
  forEachChild: (node, visit) => { for (const child of node.children ?? []) visit(child); } };
  const facts = { getRuntimeCarrierFact: node => ({ carrier: carriers.get(node) }),
    getFact: (node, key) => promoted.get(node)?.get(key),
    getArgumentPassingFact: node => modes.has(node) ? { mode: modes.get(node) } : undefined };
  const input = { ast, facts, sourceFiles: [{ children: [owner, alias] }],
    navigation: { expressionValueFlow: () => flow, declarationUseSummary: node => summaries.get(node) } };
  return { input, owner, alias, flow, summaries, carriers, modes, promoted, callable, argument };
}

test("proven local aliases share one native owner and aggregate referent mutation", () => {
  const current = fixture();
  const plan = analyzeRustLocalStorageAliases(current.input);
  assert.equal(plan.owner(current.owner), current.owner);
  assert.equal(plan.owner(current.alias), current.owner);
  assert.equal(plan.requiresMutableOwner(current.owner), true);
  assert.equal(plan.requiresMutableOwner(current.alias), false);
  assert.equal(plan.owner({}), undefined);
  current.summaries.get(current.alias).memberWritten = false;
  current.promoted.set(current.alias, new Map([[rustMutatedReferentFactKey, true]]));
  assert.equal(analyzeRustLocalStorageAliases(current.input).requiresMutableOwner(current.owner), true);
});

test("local coalescing does not guess through escapes, rebinding or foreign storage", () => {
  const controls = [
    current => { current.flow.captured = true; },
    current => { current.flow.returned = true; },
    current => { current.flow.yielded = true; },
    current => { current.flow.exported = true; },
    current => { current.flow.storedOutsideBinding = true; },
    current => { current.summaries.get(current.alias).bindingWritten = true; },
    current => { current.summaries.get(current.alias).captured = true; },
    current => { current.alias.parent = { kind: "function" }; },
    current => { current.alias.Initializer = { kind: "call" }; },
    current => { current.owner.Type = { kind: "KindTypeReference" }; },
    current => { current.carriers.set(current.alias, { kind: "array", element: { kind: "source-primitive", name: "uint64" } }); },
    current => { current.modes.set(current.argument, "by-value"); },
    current => { current.modes.clear(); },
    ...[rustBindingStorageFactKey, rustNativeArrayStorageKey].map(key =>
      current => { current.promoted.set(current.alias, new Map([[key, {}]])); }),
  ];
  for (const [index, change] of controls.entries()) {
    const current = fixture();
    change(current);
    assert.equal(analyzeRustLocalStorageAliases(current.input).owner(current.alias), undefined, `control ${index}`);
  }
});
