import assert from "node:assert/strict";
import test from "node:test";
import { rustErrorFieldBorrowNeedsSnapshot, rustErrorFieldComparisonView, rustErrorFieldHasGuardedBorrow,
  rustErrorFieldOptionalView, rustErrorFieldSharedView, rustErrorFieldOptionalComparisonView,
  rustErrorFieldStringComparisonView } from "../../../../dist/backend/planner/expressions/error-field-borrows.js";
import { rustTargetOperationFactKey } from "../../../../dist/analysis/facts/keys.js";
import { rustJsErrorTargetType, rustStringTargetType } from "../../../../dist/target-model/types/index.js";
import { rustSourceErrorTargetType } from "../../../../dist/target-model/types/carriers/source-error.js";

function scenario(carrier, property = "message") {
  const owner = { kind: "identifier" };
  const read = { kind: "property", expression: owner };
  const invalidations = new Map();
  const queries = [];
  const operations = new Map([[read, { kind: "builtin-error-property", accessMode: "read", receiverCarrier: carrier,
    property, resultCarrier: rustStringTargetType() }]]);
  const context = { diagnostics: [], syntheticNames: { reserved: new Set(), nextSuffixByBase: new Map() }, input: { program: { facts: {
    getFact: (node, key) => key === rustTargetOperationFactKey ? operations.get(node) : undefined,
  }, errorStorageDemands: { invalidationFor: (subject, expression, pure) => {
    queries.push({ subject, expression, pure });
    return invalidations.get(expression) ?? { kind: "preserved" };
  } }, source: { ast: {
    getFileName: () => "error-field.ts", getSourceText: () => "failure.message",
    pos: () => 0, end: () => 15, kindName: () => "PropertyAccessExpression",
    is: { ...Object.fromEntries([
      "IsTypeQueryNode", "IsKeywordTypeNode", "IsTypeReferenceNode", "IsUnionTypeNode",
      "IsIntersectionTypeNode", "IsConditionalTypeNode", "IsInferTypeNode", "IsArrayTypeNode",
      "IsIndexedAccessTypeNode", "IsLiteralTypeNode", "IsThisTypeNode", "IsMappedTypeNode",
      "IsTupleTypeNode", "IsOptionalTypeNode", "IsRestTypeNode", "IsParenthesizedTypeNode",
      "IsFunctionTypeNode", "IsConstructorTypeNode", "IsTemplateLiteralTypeNode", "IsImportTypeNode",
      "IsTypeLiteralNode", "IsInterfaceDeclaration", "IsTypeAliasDeclaration", "IsArrowFunction",
      "IsFunctionExpression", "IsFunctionDeclaration", "IsClassDeclaration", "IsClassExpression",
      "IsMethodDeclaration", "IsGetAccessorDeclaration", "IsSetAccessorDeclaration",
      "IsConstructorDeclaration", "IsPropertyDeclaration",
    ].map(name => [name, () => false])),
      IsParenthesizedExpression: node => node.kind === "parentheses", IsAsExpression: () => false,
      IsExpressionStatement: () => false, IsReturnStatement: () => false, IsThrowStatement: () => false,
      IsIfStatement: () => false, IsWhileStatement: () => false, IsDoStatement: () => false,
      IsForOfStatement: () => false, IsForInStatement: () => false, IsElementAccessExpression: () => false,
      IsNewExpression: () => false,
      IsTypeAssertion: () => false, IsSatisfiesExpression: () => false, IsNonNullExpression: () => false,
      IsPropertyAccessExpression: node => node.kind === "property", IsCallExpression: node => node.kind === "call" },
    as: { AsParenthesizedExpression: node => ({ Expression: node.expression }),
      AsPropertyAccessExpression: node => ({ Expression: node.expression }) },
    forEachChild: (node, visit) => { for (const child of node.children ?? []) visit(child); },
  } }, sourceNavigation: {} } } };
  const expression = { kind: "owned-string-from-borrowed-str", expression: {
    kind: "method-call", receiver: { kind: "path", path: "original" }, method: property, args: [],
  } };
  return { read, owner, invalidations, operations, context, expression, queries };
}

test("immutable native Error name/message never acquire mutation guards or snapshots", () => {
  for (const property of ["name", "message"]) {
    const { read, invalidations, context, expression, queries } = scenario(rustJsErrorTargetType(), property);
    const later = {};
    invalidations.set(later, { kind: "invalidated" });
    assert.equal(rustErrorFieldHasGuardedBorrow(read, context), false);
    assert.equal(rustErrorFieldBorrowNeedsSnapshot(read, [later], context), false);
    assert.equal(rustErrorFieldComparisonView(read, expression, later, context), expression.expression);
    assert.deepEqual(queries, []);
  }
});

test("actual same-owner writes consume guarded fields before mutation", () => {
  for (const property of ["name", "message", "stack"]) {
    const { read, owner, invalidations, context, expression, queries } = scenario(rustSourceErrorTargetType(), property);
    const write = {};
    invalidations.set(write, { kind: "invalidated" });
    assert.equal(rustErrorFieldHasGuardedBorrow(read, context), true);
    const snapshot = rustErrorFieldComparisonView(read, expression, write, context);
    assert.equal(snapshot.kind, "block");
    assert.equal(snapshot.body.statements[0].init, expression);
    assert.equal(snapshot.body.statements[1].expr.path, snapshot.body.statements[0].name);
    assert.equal(queries[0].subject, owner);
  }
});

test("native captured stacks release their guard before exact recapture", () => {
  const { read, invalidations, context } = scenario(rustJsErrorTargetType(), "stack");
  const capture = {};
  invalidations.set(capture, { kind: "invalidated" });
  assert.equal(rustErrorFieldHasGuardedBorrow(read, context), true);
  assert.equal(rustErrorFieldBorrowNeedsSnapshot(read, [capture], context), true);
});

test("valid uncertain effects release guarded fields while actual analysis failures still reject", () => {
  for (const property of ["name", "message", "stack"]) {
    const { read, invalidations, context, expression } = scenario(rustSourceErrorTargetType(), property);
    const opaque = {};
    invalidations.set(opaque, { kind: "unproven", reason: "exact checked native receiver has an open admission domain" });
    const snapshot = rustErrorFieldComparisonView(read, expression, opaque, context);
    assert.equal(snapshot.kind === "block", true, property);
    assert.equal(snapshot.body.statements[0].init === expression, true, "owned read precedes the opaque invocation");
    assert.deepEqual(context.diagnostics, []);
    invalidations.set(opaque, { kind: "unresolved", reason: "exact storage analysis exhausted its finite budget" });
    assert.equal(rustErrorFieldBorrowNeedsSnapshot(read, [opaque], context), false);
    assert.equal(context.diagnostics.length === 1 && context.diagnostics[0].message.includes("finite budget"), true,
      "missing or exhausted evidence never becomes a conservative runtime fallback");
  }
});

test("read-only callbacks and unrelated writes remain zero-copy instead of all-invocation snapshots", () => {
  const { read, context, expression } = scenario(rustSourceErrorTargetType());
  for (const later of [{ kind: "call" }, { kind: "unrelated-write" }]) {
    assert.equal(rustErrorFieldBorrowNeedsSnapshot(read, [later], context), false);
    assert.equal(rustErrorFieldComparisonView(read, expression, later, context), expression.expression);
  }
  assert.equal(rustErrorFieldComparisonView(read, expression, undefined, context), expression.expression);
});

test("pure provider evidence exempts its invocation, not independently evaluated mutations", () => {
  const { read, context, expression, queries, operations, invalidations } = scenario(rustSourceErrorTargetType());
  const argument = {};
  const later = { kind: "call", children: [argument] };
  operations.set(later, { kind: "provider-operation", abi: { sourceReceiver: { kind: "none" },
    result: { kind: "sync" }, effects: { evaluation: "pure", safety: "safe" } } });
  assert.equal(rustErrorFieldComparisonView(read, expression, later, context), expression.expression);
  assert.equal(queries[0].pure.has(later), true);
  assert.equal(queries[0].pure.has(argument), false);
  invalidations.set(later, { kind: "invalidated" });
  const snapshot = rustErrorFieldComparisonView(read, expression, later, context);
  assert.equal(snapshot.kind, "block");
  assert.equal(snapshot.body.statements[0].init, expression);
  assert.equal(snapshot.body.statements[1].expr.path, snapshot.body.statements[0].name);
});

test("transparent syntax retains the original selected Error owner", () => {
  const { read, owner, context, expression, queries } = scenario(rustSourceErrorTargetType());
  const wrapped = { kind: "parentheses", expression: read };
  assert.equal(rustErrorFieldComparisonView(wrapped, expression, {}, context), expression.expression);
  assert.equal(queries[0].subject, owner);
});

test("shared ErrorField reads borrow native str; optional presence does not copy captured stack", () => {
  const { read, expression, context } = scenario(rustSourceErrorTargetType());
  assert.deepEqual(rustErrorFieldSharedView(read, expression, context), {
    kind: "reference", expr: { kind: "dereference", pointer: expression.expression },
  });
  const stack = scenario(rustSourceErrorTargetType(), "stack");
  const borrowed = { kind: "method-call", receiver: { kind: "path", path: "error" }, method: "stack", args: [] };
  const owned = { kind: "method-call", receiver: borrowed, method: "map", args: [{ kind: "path", path: "String::from" }] };
  assert.equal(rustErrorFieldOptionalView(stack.read, owned, stack.context), borrowed);
  assert.equal(rustErrorFieldOptionalView(read, owned, context), owned);
});

test("optional stack equality borrows the original guard without a String snapshot", () => {
  const { read, context } = scenario(rustSourceErrorTargetType(), "stack");
  const borrowed = { kind: "method-call", receiver: { kind: "path", path: "error" }, method: "stack", args: [] };
  const owned = { kind: "method-call", receiver: borrowed, method: "map", args: [{ kind: "path", path: "String::from" }] };
  assert.deepEqual(rustErrorFieldOptionalComparisonView(read, owned, {}, context), {
    kind: "method-call", receiver: borrowed, method: "as_deref", args: [],
  });
});

test("optional stack equality consumes its guard before a same-owner mutation or recapture", () => {
  const { read, context, invalidations } = scenario(rustJsErrorTargetType(), "stack");
  const owned = { kind: "method-call", receiver: { kind: "path", path: "stack_guard" }, method: "map", args: [{ kind: "path", path: "String::from" }] };
  const capture = {};
  invalidations.set(capture, { kind: "invalidated" });
  assert.deepEqual(rustErrorFieldOptionalComparisonView(read, owned, capture, context), {
    kind: "method-call", receiver: owned, method: "as_deref", args: [],
  });
});

test("stack/string equality uses borrowed literals and native str guarded views", () => {
  const { read, context, expression } = scenario(rustSourceErrorTargetType());
  assert.deepEqual(rustErrorFieldStringComparisonView(read, expression, undefined, context), {
    kind: "reference", expr: { kind: "dereference", pointer: expression.expression },
  });
  assert.deepEqual(rustErrorFieldStringComparisonView({}, { kind: "string-literal", value: "stack" }, undefined, context), {
    kind: "str-literal", value: "stack",
  });
});
