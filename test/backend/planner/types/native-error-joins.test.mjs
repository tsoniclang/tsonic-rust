import assert from "node:assert/strict";
import test from "node:test";
import { planRustNativeErrorJoin } from "../../../../dist/backend/planner/types/native-error-joins.js";
import { emptyRustGenerics } from "../../../../dist/backend/target-ast/nodes.js";
import { rustTypeEquals } from "../../../../dist/backend/target-ast/inspection/type-equality.js";
import { applyRustFallibleResultExpression } from "../../../../dist/backend/planner/types/fallible-shape.js";
import { printRustExpr } from "../../../../dist/print/source/expressions/core.js";
import { printRustType } from "../../../../dist/print/source/types.js";

const named = path => ({ kind: "named", path });
const path = name => ({ kind: "path", path: name });
const source = (identity, variant, errorType = named("BorrowedError")) => ({ identity, variant, errorType });
const plan = (sources, options = {}) => planRustNativeErrorJoin({ identity: "region:joined-errors", name: "JoinedErrors",
  visibility: "private", sources, ...options });
const first = source("callback:first", "First");
const second = source("callback:second", "Second");

test("zero native error sources preserve pure code without an error type or items", () => {
  const joined = plan([]);
  assert.equal(joined !== undefined, true);
  assert.equal(joined.errorType === undefined, true);
  assert.equal(joined.items.length, 0);
  assert.equal(joined.inject(first, path("error")) === undefined, true);
  assert.equal(joined.propagate(first, path("result")) === undefined, true);
});

test("one exact source moves its error unchanged and propagates without conversion", () => {
  const errorType = { kind: "qualified", owner: named("Producer"), trait: named("Invocation"), member: "Error" };
  const selected = source("callback:only", "Only", errorType);
  const joined = plan([selected]);
  const error = path("error");
  const result = path("result");
  assert.equal(joined.errorType === errorType, true);
  assert.equal(joined.items.length, 0);
  assert.equal(joined.inject(selected, error) === error, true);
  const propagated = joined.propagate(selected, result);
  assert.equal(propagated.expr === result, true);
  assert.equal(propagated.operandErrorType === errorType, true);
  assert.equal(propagated.resultErrorType === errorType, true);
  assert.equal(applyRustFallibleResultExpression(propagated, { errorType }) === result, true);
});

test("multiple formal sources retain distinct variants when their actual error types coincide", () => {
  const joined = plan([first, second]);
  assert.equal(joined.items.length, 1);
  assert.equal(joined.items[0].kind, "enum");
  assert.deepEqual(joined.items[0].variants.map(variant => variant.name), ["First", "Second"]);
  assert.equal(rustTypeEquals(joined.items[0].variants[0].fields[0], joined.items[0].variants[1].fields[0]), false);
  assert.equal(rustTypeEquals(joined.errorType.genericArguments[0].type, joined.errorType.genericArguments[1].type), true);
  assert.equal(joined.items[0].attrs === undefined, true);
  assert.deepEqual(joined.items[0].generics.parameters.map(parameter => parameter.name), ["Error0", "Error1"]);
  assert.equal(joined.items[0].generics.wherePredicates.length, 0);
  assert.equal(printRustExpr(joined.inject(first, path("error"))), "JoinedErrors::<BorrowedError, BorrowedError>::First(error)");
  assert.equal(printRustExpr(joined.inject(second, path("error"))), "JoinedErrors::<BorrowedError, BorrowedError>::Second(error)");
});

test("native joins map a selected error once before an exactly typed try", () => {
  const joined = plan([first, second]);
  const result = { kind: "call", path: "invoke", args: [] };
  for (const selected of [first, second]) {
    const propagated = joined.propagate(selected, result);
    assert.equal(propagated.kind, "try");
    assert.equal(propagated.expr.receiver === result, true);
    assert.equal(propagated.operandErrorType === joined.errorType, true);
    assert.equal(propagated.resultErrorType === joined.errorType, true);
    assert.equal(printRustExpr(propagated), `invoke().map_err(JoinedErrors::<BorrowedError, BorrowedError>::${selected.variant})?`);
    const returned = applyRustFallibleResultExpression(propagated, { errorType: joined.errorType });
    assert.equal(returned === propagated.expr, true);
    assert.doesNotMatch(printRustExpr(returned), /from|clone|default/iu);
  }
});

test("associated errors retain native arguments without copying unrelated declaration binders", () => {
  const lifetime = { kind: "named", name: "scope" };
  const associated = { kind: "qualified", owner: named("Producer"), trait: named("Invocation"), member: "Error",
    genericArguments: [{ kind: "lifetime", lifetime }] };
  const local = { kind: "reference", mutable: true, referent: { kind: "fixed-array", element: { kind: "primitive", name: "u8" },
    length: { kind: "path", path: "COUNT" } }, lifetime };
  const joined = plan([source("local", "Local", local), source("producer", "Producer", associated)]);
  assert.equal(joined.errorType.genericArguments[1].type === associated, true);
  assert.equal(joined.items[0].generics.parameters.length, 2);
  assert.equal(printRustType(joined.errorType), "JoinedErrors<&'scope mut [u8; COUNT], <Producer as Invocation>::Error<'scope>>");
  assert.equal(printRustType(associated), "<Producer as Invocation>::Error<'scope>");
});

test("source selection rejects foreign identities and inconsistent exact carriers without a fallback", () => {
  for (const selectedSources of [[first], [first, second]]) {
    const joined = plan(selectedSources);
    for (const candidate of [source("foreign", "First"), { ...first, errorType: named("OtherError") },
      { ...first, errorType: { kind: "reference", referent: first.errorType, mutable: false } }]) {
      assert.equal(joined.inject(candidate, path("error")) === undefined, true);
      assert.equal(joined.propagate(candidate, path("result")) === undefined, true);
    }
  }
});

test("native source checks use semantic type identity rather than spelling", () => {
  const original = { kind: "named", path: "owner::Failure", identity: "package:failure" };
  const joined = plan([source("source", "Source", original), second]);
  const alias = { identity: "source", errorType: { ...original, path: "reexport::Failure" } };
  assert.equal(joined.inject(alias, path("error")) !== undefined, true);
  for (const changed of [{ ...original, identity: "other:failure" }, { kind: "named", path: original.path }]) {
    assert.equal(joined.inject({ ...alias, errorType: changed }, path("error")) === undefined, true);
  }
});

test("associated source checks retain exact owner, trait, member and lifetime substitutions", () => {
  const errorType = { kind: "qualified", owner: named("Producer"), trait: named("Invocation"), member: "AwaitError",
    genericArguments: [{ kind: "lifetime", lifetime: { kind: "named", name: "scope" } }] };
  const selected = source("associated", "Associated", errorType);
  const joined = plan([selected, second]);
  for (const replacement of [
    { ...errorType, owner: named("OtherProducer") }, { ...errorType, trait: named("OtherProtocol") },
    { ...errorType, member: "InvocationError" }, { ...errorType, genericArguments: [] },
    { ...errorType, genericArguments: [{ kind: "lifetime", lifetime: { kind: "static" } }] },
  ]) {
    const candidate = { ...selected, errorType: replacement };
    assert.equal(joined.inject(candidate, path("error")) === undefined, true);
    assert.equal(joined.propagate(candidate, path("result")) === undefined, true);
  }
});

test("ambiguous source identities, variant names and invalid declaration names reject", () => {
  for (const [label, sources, options] of [
    ["empty identity", [first], { identity: "" }],
    ["path instead of name", [first], { name: "module::Join" }],
    ["reserved name", [first], { name: "type" }],
    ["empty source", [source("", "First")], {}],
    ["same identity", [first, { ...second, identity: first.identity }], {}],
    ["same variant", [first, { ...second, variant: first.variant }], {}],
    ["raw variant alias", [first, { ...second, variant: "r#First" }], {}],
    ["invalid variant", [source("source", "crate")], {}],
    ["inferred carrier", [source("source", "Source", { kind: "infer" })], {}],
    ["opaque enum field", [source("source", "Source", { kind: "impl-trait", bounds: [], outlives: [] })], {}],
    ["removed source generic context", [first], { generics: emptyRustGenerics }],
    ["invalid binder", [first], { generics: { parameters: [{ kind: "type", name: "_", bounds: [] }], wherePredicates: [] } }],
    ["duplicate binder", [first], { generics: { parameters: [{ kind: "type", name: "Value", bounds: [] },
      { kind: "const", name: "r#Value", type: { kind: "primitive", name: "usize" } }], wherePredicates: [] } }],
  ]) assert.equal(plan(sources, options) === undefined, true, label);
});

test("native hygiene preserves explicitly selected raw identifiers without external binders", () => {
  const joined = plan([source("source", "r#type"), source("next", "Next")], { name: "r#match" });
  assert.equal(joined !== undefined, true);
  assert.equal(printRustExpr(joined.inject({ identity: "source", errorType: named("BorrowedError") }, path("error"))),
    "r#match::<BorrowedError, BorrowedError>::r#type(error)");
});

test("joined error correspondence preserves source variants across modules and equal payload types", () => {
  const joined = plan([first, second], { referencePath: "dependency::errors::JoinedErrors" });
  assert.equal(joined.items[0].name, "JoinedErrors");
  assert.equal(joined.errorType.path, "dependency::errors::JoinedErrors");
  const visited = [];
  const selected = joined.mapError(path("failure"), "payload", (source, payload) => {
    visited.push(source.identity);
    return { kind: "call", path: source.identity === first.identity ? "target_first" : "target_second", args: [payload] };
  });
  assert.deepEqual(visited, [first.identity, second.identity]);
  assert.match(printRustExpr(selected), /dependency::errors::JoinedErrors::First\(payload\) => target_first\(payload\)/u);
  assert.match(printRustExpr(selected), /dependency::errors::JoinedErrors::Second\(payload\) => target_second\(payload\)/u);
  assert.equal(joined.mapError(path("failure"), "payload", source => source.identity === first.identity
    ? path("mapped") : undefined) === undefined, true);
  assert.equal(joined.mapError(path("failure"), "type", () => path("mapped")) === undefined, true);
  for (const referencePath of ["", "owner::", "owner::::JoinedErrors", "owner;exit()", "owner::type"])
    assert.equal(plan([first, second], { referencePath }) === undefined, true, referencePath);
});
