import assert from "node:assert/strict";
import test from "node:test";
import { planRustNativeErrorJoin, planRustNativeErrorRuntimeFrom } from "../../../../dist/backend/planner/types/native-error-joins.js";
import { emptyRustGenerics } from "../../../../dist/backend/target-ast/syntax/nodes.js";
import { rustTypeEquals } from "../../../../dist/backend/target-ast/syntax/type-equality.js";
import { applyRustFallibleResultExpression } from "../../../../dist/backend/planner/types/fallible-shape.js";
import { printRustExpr } from "../../../../dist/print/source/expressions/core.js";
import { printRustType } from "../../../../dist/print/source/types.js";
import { snapshotRustNativeErrorSources } from "../../../../dist/target-model/types/native-error-joins.js";
import { isRustTargetTypeRef } from "../../../../dist/target-model/types/equality.js";
import { rustSourcePrimitiveTargetType } from "../../../../dist/target-model/types/index.js";

const named = path => ({ kind: "named", path });
const path = name => ({ kind: "path", path: name });
const source = (identity, variant, errorType = named("BorrowedError")) => ({ identity, variant, errorType });
const plan = (sources, options = {}) => planRustNativeErrorJoin({ identity: "region:joined-errors", name: "JoinedErrors",
  visibility: "private", resultShape: sources.length === 0 ? "value" : "result", sources, ...options });
const first = source("callback:first", "First");
const second = source("callback:second", "Second");

test("runtime intrinsic conversion uses only the exact join-owner arm and leaves foreign arms untouched", () => {
  const declaration = { name: "NativeErrors3", arity: 3, clone: false, runtimeErrorArm: 2 };
  const implementation = planRustNativeErrorRuntimeFrom(declaration);
  assert.equal(implementation?.kind, "impl", "exactly one implementation represents the admitted runtime channel");
  assert.equal(printRustType(implementation.trait), "core::convert::From<tsonic_rust_runtime::TsonicError>", "only the runtime intrinsic source is converted");
  assert.equal(printRustType(implementation.target), "NativeErrors3<Error0, Error1, Error2>", "the selected native join remains generic over its original arms");
  assert.equal(implementation.generics.wherePredicates.length, 1, "no blanket bounds for foreign errors");
  assert.equal(printRustType(implementation.generics.wherePredicates[0].type), "Error2", "the record chooses the bound, not an Error0 convention");
  assert.equal(printRustExpr(implementation.members[0].body.statements[0].expr),
    "Self::Error2(<Error2 as core::convert::From<tsonic_rust_runtime::TsonicError>>::from(value))", "native payload injection targets the exact selected arm");
  assert.equal(planRustNativeErrorRuntimeFrom({ ...declaration, runtimeErrorArm: undefined }) === undefined, true,
    "no runtime-channel record means no runtime conversion implementation");
  for (const runtimeErrorArm of [-1, 3, 0.5]) assert.throws(
    () => planRustNativeErrorRuntimeFrom({ ...declaration, runtimeErrorArm }), /exact declared native join arm/u,
    "corrupted sealed arm metadata is never guessed or clamped");
});

test("zero native error sources preserve pure code without an error type or items", () => {
  const joined = plan([]);
  assert.equal(joined !== undefined, true);
  assert.equal(joined.errorType === undefined, true);
  assert.equal(joined.items.length, 0);
  assert.equal(joined.inject(first, path("error")) === undefined, true);
  assert.equal(joined.propagate(first, path("result")) === undefined, true);
});

test("an explicit native Result ABI retains Infallible without inventing error variants", () => {
  const joined = plan([], { resultShape: "result" });
  assert.equal(joined.errorType?.kind, "named");
  assert.equal(joined.errorType?.path, "core::convert::Infallible");
  assert.equal(joined.items.length, 0, "an empty native error type needs no declaration");
  assert.equal(joined.mapError(path("error"), "impossible", () => assert.fail("no error source exists")).arms.length, 0,
    "an actual Result error is eliminated by the empty native match");
  assert.equal(joined.inject(first, path("error")), undefined, "foreign inhabited errors remain refused");
  assert.throws(() => plan([first], { resultShape: "value" }), /value ABI/u,
    "nonempty source errors cannot silently become an infallible value ABI");
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
  assert.deepEqual(joined.items[0].attrs, [{ kind: "list", path: "derive", arguments: [{ kind: "word", path: "Debug" }] }]);
  assert.deepEqual(joined.items[0].generics.parameters.map(parameter => parameter.name), ["Error0", "Error1"]);
  assert.equal(joined.items[0].generics.parameters.every(parameter => parameter.bounds.length === 0), true);
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

test("explicit shared completion demand adds conditional native Clone without imposing payload bounds", () => {
  const joined = plan([first, second], { clone: true });
  assert.deepEqual(joined.items[0].attrs[0].arguments.map(argument => argument.path), ["Debug", "Clone"]);
  assert.equal(joined.items[0].generics.parameters.every(parameter => parameter.bounds.length === 0), true);
  assert.equal(joined.items[0].generics.wherePredicates.length, 0);
  assert.doesNotMatch(printRustExpr(joined.inject(first, path("error"))), /clone|Box|Rc/u);
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

// Join sources are sealed by the analysis owner (analysis/errors/regions.ts through snapshotRustNativeErrorSources).
// Join names, identities and reference paths are built by the planner from sealed join names and allocated module
// names, so the former malformed-name and generic-binder cases have no reachable input and are not exercised here.
test("ambiguous source identities and variant names are refused before a native error join", () => {
  const carrier = rustSourcePrimitiveTargetType("int32");
  const target = (identity, variant, errorType = carrier) => ({ identity, variant, errorType });
  for (const [label, sources] of [
    ["empty source", [target("", "First")]],
    ["same identity", [target("first", "First"), target("first", "Second")]],
    ["same variant", [target("first", "First"), target("second", "First")]],
    ["raw variant alias", [target("first", "First"), target("second", "r#First")]],
    ["invalid variant", [target("source", "crate")]],
    ["unrepresentable carrier", [target("source", "Source", { kind: "infer" })]],
  ]) assert.equal(snapshotRustNativeErrorSources(sources, isRustTargetTypeRef), undefined, label);
  assert.equal(snapshotRustNativeErrorSources([target("first", "First"), target("second", "Second")], isRustTargetTypeRef)?.length, 2);
  // A duplicate identity reaching the planner is a corrupt record set.
  assert.throws(() => plan([first, { ...second, identity: first.identity }]), /unique sealed source identities/u);
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
});
