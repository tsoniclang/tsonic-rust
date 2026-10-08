import assert from "node:assert/strict";
import test from "node:test";
import { selectRustBorrowedIterationBinding } from "../../../dist/analysis/program/borrowed-iteration-bindings.js";
import { rustTargetOperationFactKey } from "../../../dist/analysis/facts/keys.js";
import { rustBorrowedStrTargetType, rustStringTargetType, rustVecTargetType } from "../../../dist/target-model/types/index.js";

function fixture() {
  const callable = { kind: "KindFunctionDeclaration" };
  const declaration = { kind: "KindVariableDeclaration" };
  const destination = { kind: "KindVariableDeclaration", parent: callable };
  const name = { kind: "KindIdentifier", parent: declaration };
  declaration.name = name;
  const input = { kind: "KindIdentifier" };
  const reference = { kind: "KindIdentifier" };
  const left = { kind: "KindIdentifier", declaration: destination };
  const append = { kind: "KindBinaryExpression", left, right: reference };
  left.parent = append;
  reference.parent = append;
  const statement = { kind: "KindExpressionStatement", expression: append };
  append.parent = statement;
  const body = { kind: "KindBlock", statements: [statement] };
  statement.parent = body;
  const initializer = { kind: "KindVariableDeclarationList", declarations: [declaration] };
  const loop = { kind: "KindForOfStatement", initializer, expression: input, statement: body, parent: callable };
  input.parent = loop;
  initializer.parent = loop;
  declaration.parent = initializer;
  body.parent = loop;
  const string = rustStringTargetType();
  let inputCarrier = { kind: "reference", mutable: false, referent: { kind: "slice", element: string } };
  let iteration = { kind: "iteration", iterationKind: "for-of", elementCarrier: string,
    lowering: { kind: "borrowed", style: "cloned", input: "reference" } };
  let operation = { kind: "operator-token", operator: "+=", resultCarrier: string, writeStrategy: "in-place-string-append-value" };
  let summary = { captured: false, exported: false, bindingWritten: false, memberWritten: false,
    aliasedOrStored: true, hasUnclassifiedValueUse: false, uses: [{ kind: "first-class", reference, role: "storage" }] };
  const ast = {
    kindName: node => node.kind,
    parent: node => node.parent,
    name: node => node.name,
    variableDeclarationKind: node => node.declarationKind ?? "const",
    statements: node => node.statements,
    arguments: node => node.args ?? [],
    as: {
      AsNode: node => ({ Expression: node.expression, Name: node.name }),
      AsBinaryExpression: node => ({ Left: node.left, Right: node.right }),
      AsForInOrOfStatement: node => ({ Initializer: node.initializer, Statement: node.statement, Expression: node.expression }),
      AsVariableDeclarationList: node => ({ Declarations: { Nodes: node.declarations } }),
      AsExpressionStatement: node => ({ Expression: node.expression }),
      AsPropertyAccessExpression: node => ({ Expression: node.expression }),
      AsCallExpression: node => ({ Expression: node.expression }),
    },
    is: Object.fromEntries(["Identifier", "ParenthesizedExpression", "AsExpression", "TypeAssertion", "SatisfiesExpression",
      "PropertyAccessExpression", "CallExpression", "ExpressionStatement", "ReturnStatement", "ThrowStatement", "IfStatement",
      "WhileStatement", "DoStatement", "ForOfStatement", "ForInStatement", "ElementAccessExpression", "NewExpression",
      "AwaitExpression", "NonNullExpression", "DeleteExpression", "VoidExpression", "TypeOfExpression", "YieldExpression",
      "SpreadElement", "ExportAssignment", "VariableDeclarationList", "BinaryExpression"].map(kind => [`Is${kind}`, node => node.kind === `Kind${kind}`])),
  };
  const facts = {
    getTargetConversionFact: () => undefined,
    getFact(node, key) {
      if (key !== rustTargetOperationFactKey) return undefined;
      return node === loop ? iteration : node === append ? operation : node.operation;
    },
    getRuntimeCarrierFact(node) { return { carrier: node === input ? inputCarrier : string }; },
  };
  const navigation = { declarationUseSummary: () => summary,
    sourceReferenceFor: node => ({ declaration: node === reference ? declaration : node.declaration }) };
  return { ast, facts, navigation, loop, body, append, reference, declaration, input, string,
    select: () => selectRustBorrowedIterationBinding(loop, ast, facts, navigation),
    setCarrier: carrier => { inputCarrier = carrier; },
    setIteration: value => { iteration = value; },
    setOperation: value => { operation = value; },
    setSummary: value => { summary = { ...summary, ...value }; },
  };
}

test("borrowed loop selection consumes exact readonly native slices and checked borrowed string uses", () => {
  const input = fixture();
  const selected = input.select();
  assert.deepEqual(selected, { declaration: input.declaration, references: [input.reference] });
  assert.equal(Object.isFrozen(selected), true);
  assert.equal(Object.isFrozen(selected.references), true);
  input.setOperation({ kind: "operator-token", operator: "+=", resultCarrier: input.string,
    writeStrategy: "in-place-string-append-parts" });
  assert.ok(input.select());
  input.setIteration({ kind: "iteration", iterationKind: "for-of", elementCarrier: input.string,
    lowering: { kind: "borrowed", style: "cloned", input: "direct" } });
  assert.ok(input.select());
});

test("borrowed loop selection rejects ownership, alias escapes and observable operations without changing owned iteration", () => {
  const mutations = [
    input => input.setCarrier(rustVecTargetType(input.string)),
    input => input.setCarrier({ kind: "reference", mutable: true, referent: { kind: "slice", element: input.string } }),
    input => input.setCarrier({ kind: "reference", mutable: false, referent: rustVecTargetType(input.string) }),
    input => input.setCarrier({ kind: "reference", mutable: false, referent: { kind: "slice", element: { kind: "source-primitive", name: "int32" } } }),
    input => input.setIteration({ kind: "iteration", iterationKind: "for-await-of", elementCarrier: input.string,
      lowering: { kind: "borrowed", style: "cloned", input: "reference" } }),
    input => input.setIteration({ kind: "iteration", iterationKind: "for-of", elementCarrier: input.string, lowering: { kind: "js-array" } }),
    ...["captured", "exported", "bindingWritten", "memberWritten"].map(key => input => input.setSummary({ [key]: true })),
    input => { input.declaration.declarationKind = "using"; },
    input => { input.declaration.name.kind = "KindObjectBindingPattern"; },
    input => { input.reference.parent = { kind: "KindReturnStatement", expression: input.reference, parent: input.body }; },
    input => { input.reference.parent = { kind: "KindVariableDeclaration", initializer: input.reference, parent: input.body }; },
    input => { input.reference.parent = { kind: "KindCallExpression", args: [input.reference], parent: input.body }; },
    input => { input.body.statements.push({ kind: "KindExpressionStatement", expression: { kind: "KindCallExpression" } }); },
    input => input.setOperation({ kind: "operator-token", operator: "+=", resultCarrier: input.string }),
  ];
  for (const mutate of mutations) {
    const input = fixture();
    assert.ok(input.select());
    mutate(input);
    assert.equal(input.select(), undefined);
  }
});

test("borrowed loop provider uses require exact compiler-selected pure shared-reference inputs", () => {
  const input = fixture();
  const read = { kind: "KindPropertyAccessExpression", expression: input.reference, parent: input.body.statements[0] };
  input.reference.parent = read;
  input.body.statements[0].expression = read;
  read.operation = { kind: "provider-operation", abi: {
    effects: { evaluation: "pure", safety: "safe" }, result: { kind: "sync" },
    sourceReceiver: { kind: "required" }, targetReceiver: { kind: "input", input: {
      mode: "ref", sourceCarrier: input.string, conversion: { kind: "identity" }, source: { kind: "receiver" },
    } }, targetArguments: [],
  } };
  const original = read.operation;
  assert.ok(input.select());
  for (const operation of [
    { ...original, abi: { ...original.abi, effects: { evaluation: "observable", safety: "safe" } } },
    { ...original, abi: { ...original.abi, effects: { evaluation: "pure", safety: "requires-unsafe" } } },
    { ...original, abi: { ...original.abi, result: { kind: "async" } } },
    ...["value", "mut-ref"].map(mode => ({ ...original, abi: { ...original.abi,
      targetReceiver: { kind: "input", input: { ...original.abi.targetReceiver.input, mode } },
    } })),
    { ...original, abi: { ...original.abi, targetReceiver: { kind: "input", input: {
      ...original.abi.targetReceiver.input, conversion: { kind: "clone" },
    } } } },
  ]) {
    read.operation = operation;
    assert.equal(input.select(), undefined);
  }
  const sourceInput = original.abi.targetReceiver.input;
  const borrowed = rustBorrowedStrTargetType();
  const semantic = { ...sourceInput, mode: "value", parameterCarrier: borrowed, conversion: {
    kind: "semantic", conversion: { kind: "semantic-conversion", id: "borrowed-str-from-owned-string" },
    sourceCarrier: input.string, targetCarrier: borrowed, fallible: false,
  } };
  const selectInput = selected => {
    read.operation = { ...original, abi: { ...original.abi, targetReceiver: { kind: "input", input: selected } } };
    return input.select();
  };
  assert.ok(selectInput(semantic), "exact native borrowed string conversion");
  for (const selected of [
    { ...semantic, mode: "ref" },
    { ...semantic, mode: "mut-ref" },
    { ...semantic, parameterCarrier: input.string },
    { ...semantic, conversion: { ...semantic.conversion, fallible: true } },
    { ...semantic, conversion: { ...semantic.conversion, sourceCarrier: borrowed } },
    { ...semantic, conversion: { ...semantic.conversion, targetCarrier: input.string } },
    { ...semantic, conversion: { ...semantic.conversion, conversion: {
      kind: "semantic-conversion", id: "owned-string-from-borrowed-str",
    } } },
    { ...semantic, conversion: { ...semantic.conversion, conversion: {
      kind: "semantic-conversion", id: "borrowed-str-from-optional-string",
    } } },
    { ...semantic, conversion: { kind: "sequence", steps: [semantic.conversion] } },
  ]) assert.equal(selectInput(selected), undefined, "nonborrow or inconsistent native input remains rejected");
});
