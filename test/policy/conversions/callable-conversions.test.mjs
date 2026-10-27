import assert from "node:assert/strict";
import test from "node:test";
import { rustCallableConversionMatches, selectRustCallableConversion } from "../../../dist/policy/conversions/callable.js";
import { rustCompilerOwnedContextualConversionMatches } from "../../../dist/policy/conversions/contextual.js";
import { selectRustValueCarrierReconciliation } from "../../../dist/policy/conversions/value-carrier-reconciliation.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";
import { rustCallableProtocol } from "../../../dist/target-model/types/carriers/callables.js";
import { selectRustSourceValueConversion } from "../../../dist/policy/conversions/selection.js";
import { rustAbsenceTargetType, rustCallableTargetType, rustClosureTargetType, rustJsValueTargetType, rustOptionTargetType, rustStringTargetType, rustUnitTargetType } from "../../../dist/target-model/types/index.js";
import { rustCallableConversionPhysical, rustCallablePhysicalCarrier } from "../../../dist/policy/conversions/callable-physical.js";
import { rustNamedTargetType, rustNativeTraitRef } from "../../../dist/target-model/types/carriers/native.js";
import { rustProgramErrorTargetType } from "../../../dist/target-model/types/carriers/js.js";
import { rustRuntimeErrorTargetType } from "../../../dist/target-model/types/carriers/runtime-carriers.js";
import { rustInfallibleTargetId } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustNativeErrorJoinTargetType } from "../../../dist/target-model/types/native-error-joins.js";
import { rustOnlyTypeGenericArguments } from "../../../dist/target-model/types/generic-arguments.js";
import { selectRustNativePromiseContinuation } from "../../../dist/policy/operations/source-profiles/native-promises.js";
import { jsCapabilityOperationRows } from "../../../dist/policy/operations/source-profiles/js/capability-rows.js";
import { rustFutureTargetType } from "../../../dist/target-model/types/carriers/primitives.js";

const number = { kind: "source-primitive", name: "float64" };
const string = { kind: "source-primitive", name: "string" };
const optional = rustOptionTargetType(number);
const select = (source, target) => selectRustCallableConversion(source, target, selectRustSourceValueConversion);

test("ordinary callable destinations retain the actual environment before selecting one required adapter", () => {
  const projectTypes = { definitionForCarrier: () => undefined };
  const error = { kind: "target-named", id: "test:ExactInvocationError" };
  const otherError = { kind: "target-named", id: "test:OtherInvocationError" };
  const lifetimes = [
    { kind: "static" },
    { kind: "parameter", identity: "test:retained", name: "Retained" },
    { kind: "call-scoped-elision", callIdentity: "test:call", parameterIdentity: "test:input" },
  ];
  for (const lifetime of lifetimes) {
    const source = rustCallableTargetType([], number, lifetime, error);
    const requested = rustCallableTargetType([number], number, undefined, error);
    const selected = selectRustValueCarrierReconciliation(source, requested, projectTypes);
    assert.equal(selected.kind, "conversion", `${lifetime.kind}: the real argument adapter remains`);
    assert.equal(selected.fact.conversion.kind, "callable-adapter", `${lifetime.kind}: one exact native adapter`);
    assert.equal(rustTargetTypeRefEquals(selected.fact.sourceCarrier, source), true, "the original source is unchanged");
    assert.equal(rustCallableProtocol(selected.fact.targetCarrier).lifetime === lifetime, true,
      "the selected destination retains the actual source environment");
    assert.equal(rustCallableProtocol(requested).lifetime.kind, "placeholder", "the authored request is immutable");
    assert.equal(rustCallableConversionMatches(selected.fact.conversion, source, selected.fact.targetCarrier), true,
      "the selected adaptation and its complete native destination agree");
    const returned = selectRustValueCarrierReconciliation(selected.fact.targetCarrier, requested, projectTypes);
    assert.equal(returned.kind, "identity", "returning the already adapted value adds no lifetime-only wrapper");
    const same = selectRustValueCarrierReconciliation(source, rustCallableTargetType([], number, undefined, error), projectTypes);
    assert.equal(same.kind, "identity", "an otherwise identical callable preserves its exact source carrier");
    const mismatch = selectRustValueCarrierReconciliation(source,
      rustCallableTargetType([number], number, undefined, otherError), projectTypes);
    assert.equal(mismatch.kind, "incompatible", "environment inference cannot change the native error identity");
    const resultMismatch = selectRustValueCarrierReconciliation(source,
      rustCallableTargetType([number], string, undefined, error), projectTypes);
    assert.equal(resultMismatch.kind, "incompatible", "environment inference cannot change the result protocol");
  }
  const actual = rustCallableTargetType([], number, lifetimes[1], error);
  for (const lifetime of [lifetimes[0], { kind: "parameter", identity: "test:destination", name: "Destination" }]) {
    const requested = rustCallableTargetType([number], number, lifetime, error);
    const selected = selectRustValueCarrierReconciliation(actual, requested, projectTypes);
    assert.equal(selected.kind, "conversion", "an explicit destination remains an explicit native requirement");
    assert.equal(rustTargetTypeRefEquals(selected.fact.targetCarrier, requested), true,
      "inference never overwrites an explicit or static destination");
  }
  const unresolved = rustCallableTargetType([], number, undefined, error);
  const selected = selectRustValueCarrierReconciliation(unresolved,
    rustCallableTargetType([number], number, undefined, error), projectTypes);
  assert.equal(selected.kind, "conversion", "the original unclosed request is not silently strengthened");
  assert.equal(rustCallableProtocol(selected.fact.targetCarrier).lifetime.kind, "placeholder",
    "an unknown source environment never becomes static");
});

test("native closure adapters retain exact inputs, results and invocation failure", () => {
  const integer = { kind: "source-primitive", name: "int64" };
  const source = rustCallableTargetType([integer], number);
  const target = rustClosureTargetType([integer], number, true);
  const selected = select(source, target);
  assert.equal(selected !== undefined, true);
  assert.equal(rustCallableConversionMatches(selected, source, target), true);
  assert.equal(rustCallableConversionMatches({ ...selected, target: { ...target, fallible: false } },
    source, { ...target, fallible: false }), false);
  assert.equal(select(source, rustClosureTargetType([integer], number)) === undefined, true);
  assert.equal(select(source, rustClosureTargetType([], number, true)) === undefined, true);
  assert.equal(select(source, rustClosureTargetType([string], number, true)) === undefined, true);
  assert.equal(select(source, rustClosureTargetType([integer], string, true)) === undefined, true);
  assert.equal(rustCallableConversionMatches({ ...selected, parameters: [{ kind: "discard" }] }, source, target), false);
});

test("generic native closure adapters retain every actual invocation error without a runtime-error substitution", () => {
  const integer = { kind: "source-primitive", name: "int64" };
  const program = rustProgramErrorTargetType({ kind: "physical", domain: "project", componentId: "callback-component" });
  const js = rustJsValueTargetType();
  const errors = [
    ["runtime", rustRuntimeErrorTargetType()],
    ["program", program],
    ["native", rustNamedTargetType("test:NativeError", "NativeError")],
    ["associated", { kind: "associated-type", owner: { kind: "type-parameter", identity: "Callback", name: "Callback" },
      trait: rustNativeTraitRef("CallbackContract"), name: "InvocationError" }],
    ["js", js],
    ["sum", rustNativeErrorJoinTargetType("/callback.ts", [program, js])],
    ["uninhabited", { kind: "target-named", id: rustInfallibleTargetId }],
  ];
  for (const [label, error] of errors) {
    assert.equal(error !== undefined, true, `${label}: the exact native error exists`);
    const source = rustCallableTargetType([integer], number, { kind: "static" }, error);
    const target = rustClosureTargetType([integer], number, true);
    const conversion = select(source, target);
    assert.equal(conversion !== undefined, true, `${label}: the native closure has no fixed destination error`);
    const selected = rustCallableConversionPhysical(conversion,
      { parameters: [integer], result: number, error }, "/callback.ts", { kind: "callback" });
    assert.equal(selected !== undefined, true, `${label}: the physical closure admits its actual invocation error`);
    assert.equal(rustTargetTypeRefEquals(selected.source.error, error), true, `${label}: the source is never relabelled`);
    assert.equal(rustTargetTypeRefEquals(selected.error, error), true, `${label}: the native result retains E`);
    assert.equal(selected.carrier.kind, "closure", `${label}: the result is an ordinary native closure`);
    assert.equal(selected.carrier.fallible, false, `${label}: Result is represented exactly once`);
    const result = rustOnlyTypeGenericArguments(selected.carrier.result.genericArguments);
    assert.equal(result?.length, 2, `${label}: the native completion is Result<Value, E>`);
    assert.equal(rustTargetTypeRefEquals(result[0], number), true, `${label}: the native result is unchanged`);
    assert.equal(rustTargetTypeRefEquals(result[1], error), true, `${label}: the emitted completion has exactly E`);
    assert.equal(selected.errors.length, 1, `${label}: no extra native error arm is manufactured`);
    assert.equal(rustTargetTypeRefEquals(selected.errors[0].errorType, error), true, `${label}: the invocation arm retains E`);
    assert.equal(Object.hasOwn(selected, "eliminatedInvokeError"), false, `${label}: no unnecessary error elimination`);
    assert.equal(Object.hasOwn(selected, "errorPlan"), false, `${label}: no runtime error conversion`);
    const fixedSource = rustCallablePhysicalCarrier(source);
    assert.equal(fixedSource !== undefined, true, `${label}: the original callable has a physical native contract`);
    assert.equal(select(fixedSource, rustCallableTargetType([integer], number, { kind: "static" },
      rustNamedTargetType("test:UnrelatedError", "UnrelatedError"))) === undefined, label !== "uninhabited",
    `${label}: a fixed destination still requires exact error conversion or native empty-error elimination`);
  }
});

test("native Promise and fixed intrinsic callback boundaries eliminate only empty invocation errors", () => {
  const infallible = { kind: "target-named", id: rustInfallibleTargetId };
  const runtime = rustRuntimeErrorTargetType();
  const source = rustCallableTargetType([number], number, { kind: "static" }, infallible);
  const actual = { parameters: [number], result: number, error: infallible };
  const native = selectRustNativePromiseContinuation("then", rustFutureTargetType(number), [source]);
  assert.equal(native !== undefined, true, "the real native Promise owner selects the continuation");
  assert.equal(native.returnedFuture.errorBoundary, "target-runtime", "the actual helper has a fixed native error");
  const target = native.parameterCarriers[0];
  const conversion = select(source, target);
  assert.equal(conversion !== undefined, true, "the actual native Promise parameter admits the callable");
  const selected = rustCallableConversionPhysical(conversion, actual, "/native-promise.ts", { kind: "native", carrier: runtime });
  assert.equal(selected !== undefined, true, "the fixed helper receives a physical adapter");
  assert.equal(selected.eliminatedInvokeError, true, "Infallible is eliminated into the real fixed error");
  assert.equal(rustTargetTypeRefEquals(selected.source.error, infallible), true, "the source remains genuinely infallible");
  assert.equal(rustTargetTypeRefEquals(selected.error, runtime), true, "the callback matches rt::TsonicResult exactly");
  assert.equal(selected.errors.length, 1, "empty elimination adds no error arm or allocation");
  assert.equal(Object.hasOwn(selected, "errorPlan"), false, "an empty error requires no inhabited-value conversion");
  assert.equal(rustCallableConversionPhysical(conversion, actual, "/native-promise.ts", undefined) === undefined, true,
    "a closure requires its operation's explicit error contract");
  const foreign = rustNamedTargetType("test:UnrelatedNativeError", "UnrelatedNativeError");
  const fixedRows = jsCapabilityOperationRows.filter(row => row.callback?.failure.kind === "invocation" &&
    row.callback.failure.resultError.kind === "native");
  assert.equal(fixedRows.some(row => row.owner === "TypedArray" && row.member === "sort"), true,
    "the audit includes the real fixed typed-array sort contract");
  assert.equal(fixedRows.some(row => row.owner === "JSON" && row.member === "stringify"), true,
    "the audit includes the real fixed JSON replacer contract");
  for (const row of fixedRows) {
    const boundary = row.callback.failure.resultError;
    const label = `${row.owner}.${row.member}:${row.variant ?? "default"}`;
    const empty = rustCallableConversionPhysical(conversion, actual, "/fixed-callback.ts", boundary);
    assert.equal(empty?.eliminatedInvokeError, true, `${label}: the empty source is eliminated at its fixed boundary`);
    assert.equal(rustTargetTypeRefEquals(empty?.error, boundary.carrier), true, `${label}: the actual metadata error is retained`);
    const exact = rustCallableConversionPhysical(conversion, { ...actual, error: boundary.carrier }, "/fixed-callback.ts", boundary);
    assert.equal(exact !== undefined, true, `${label}: the exact fixed error is admitted`);
    assert.equal(rustTargetTypeRefEquals(exact?.error, boundary.carrier), true, `${label}: an identical error needs no repair`);
    assert.equal(Object.hasOwn(exact, "eliminatedInvokeError"), false, `${label}: an inhabited error is not erased`);
    assert.equal(rustCallableConversionPhysical(conversion, { ...actual, error: foreign }, "/fixed-callback.ts", boundary) === undefined,
      true, `${label}: an unrelated error is never relabelled into the fixed helper error`);
  }
});

test("owning callable inputs borrow only exact elided shared parameters for invocation", () => {
  const nativeString = rustStringTargetType();
  const reference = { kind: "reference", referent: nativeString, mutable: false };
  const source = rustCallableTargetType([reference], number);
  const target = rustCallableTargetType([nativeString], number);
  const selected = select(source, target);
  assert.equal(selected !== undefined, true);
  assert.equal(selected.parameters[0].kind, "borrow");
  assert.equal(Object.isFrozen(selected.parameters[0]), true);
  assert.equal(rustCallableConversionMatches(selected, source, target), true);
  for (const changed of [
    { ...selected, parameters: [{ kind: "borrow", extra: true }] },
    { ...selected, result: { kind: "borrow" } },
  ]) assert.equal(rustCallableConversionMatches(changed, source, target), false);
  for (const carrier of [
    { ...reference, mutable: true },
    { ...reference, lifetime: { kind: "static" } },
    { ...reference, lifetime: { kind: "placeholder" } },
    { ...reference, referent: number },
  ]) {
    const unsafeSource = rustCallableTargetType([carrier], number);
    assert.equal(select(unsafeSource, target), undefined);
    assert.equal(rustCallableConversionMatches({ ...selected, source: unsafeSource }, unsafeSource, target), false);
  }
  assert.equal(select(rustCallableTargetType([], nativeString), rustCallableTargetType([], reference)), undefined);
});

test("stored void and exact absence callbacks complete only into proven native absence storage", () => {
  for (const result of [rustUnitTargetType(), rustAbsenceTargetType()]) {
    const source = rustCallableTargetType([], result);
    for (const destination of [rustJsValueTargetType(), optional]) {
      const target = rustCallableTargetType([number], destination);
      const conversion = select(source, target);
      assert.ok(conversion);
      assert.equal(conversion.result.kind, "absence");
      assert.equal(rustCompilerOwnedContextualConversionMatches(source, target, conversion), true);
      assert.equal(rustCompilerOwnedContextualConversionMatches(source,
        rustCallableTargetType([string], destination), conversion), false);
    }
  }
});

test("nested callable inputs and results reuse exact recursive signature conversion", () => {
  const nativeString = rustStringTargetType();
  const reference = { kind: "reference", referent: nativeString, mutable: false };
  const owned = rustCallableTargetType([nativeString], number);
  const borrowed = rustCallableTargetType([reference], number);
  for (const [source, target, placement] of [
    [rustCallableTargetType([owned], number), rustCallableTargetType([borrowed], number), "parameter"],
    [rustCallableTargetType([], borrowed), rustCallableTargetType([], owned), "result"],
    [rustCallableTargetType([rustCallableTargetType([], owned)], number),
      rustCallableTargetType([rustCallableTargetType([], borrowed)], number), "parameter"],
  ]) {
    const selected = select(source, target);
    assert.equal(selected !== undefined, true, placement);
    assert.equal(rustCallableConversionMatches(selected, source, target), true, placement);
    const nested = placement === "parameter" ? selected.parameters[0] : selected.result;
    assert.equal(nested.kind, "value");
    assert.equal(nested.conversion.kind, "callable-adapter");
    assert.equal(Object.isFrozen(nested.conversion), true);
    for (const replacement of [null, undefined, { ...nested.conversion, extra: true },
      { ...nested.conversion, source: target }, { ...nested.conversion, result: { kind: "borrow" } }]) {
      const changed = { ...nested, conversion: replacement };
      const mutation = placement === "parameter" ? { ...selected, parameters: [changed] }
        : { ...selected, result: changed };
      assert.equal(rustCallableConversionMatches(mutation, source, target), false);
    }
  }
  for (const unsafeReference of [{ ...reference, mutable: true }, { ...reference, lifetime: { kind: "static" } }]) {
    assert.equal(select(rustCallableTargetType([owned], number),
      rustCallableTargetType([rustCallableTargetType([unsafeReference], number)], number)) === undefined, true);
  }
  assert.equal(select(rustCallableTargetType([], nativeString), rustCallableTargetType([], reference)) === undefined, true);
  assert.equal(select(rustCallableTargetType([rustCallableTargetType([], borrowed)], number),
    rustCallableTargetType([rustCallableTargetType([], owned)], number)) === undefined, true,
    "contravariance cannot manufacture an escaping borrowed callback result");
});

test("native callable conversions retain contravariant parameter and covariant result evidence", () => {
  for (const [source, target] of [
    [rustCallableTargetType([], number), rustCallableTargetType([optional], number)],
    [rustCallableTargetType([optional], number), rustCallableTargetType([number], number)],
    [rustCallableTargetType([], number), rustCallableTargetType([], optional)],
    [rustCallableTargetType([], number), rustCallableTargetType([], rustUnitTargetType())],
  ]) {
    const selected = select(source, target);
    assert.ok(selected);
    assert.equal(rustCallableConversionMatches(selected, source, target), true);
    assert.equal(rustCallableConversionMatches({ ...selected, parameters: [...selected.parameters, { kind: "identity" }] }, source, target), false);
    assert.equal(rustCallableConversionMatches({ ...selected, result: { kind: "absence" } }, source, target), false);
  }
  const source = rustCallableTargetType([optional], number);
  const target = rustCallableTargetType([number], number);
  const selected = select(source, target);
  assert.equal(selected.parameters[0].conversion.kind, "option-some");
  assert.equal(rustCallableConversionMatches({ ...selected, parameters: [{ kind: "identity" }] }, source, target), false);
  assert.equal(rustCallableConversionMatches({ ...selected, parameters: [{ kind: "discard" }] }, source, target), false);
});

test("callable conversion cannot invent required results, arguments or unsafe carrier transitions", () => {
  for (const [source, target] of [
    [rustCallableTargetType([], rustUnitTargetType()), rustCallableTargetType([], number)],
    [rustCallableTargetType([number], rustUnitTargetType()), rustCallableTargetType([string], optional)],
    [rustCallableTargetType([number], rustUnitTargetType()), rustCallableTargetType([], optional)],
    [rustCallableTargetType([number], number), rustCallableTargetType([optional], number)],
    [rustCallableTargetType([], number), rustCallableTargetType([], string)],
  ]) assert.equal(select(source, target), undefined);
});

test("stored conversion facts are immutable and reject malformed or contradictory selections", () => {
  const source = rustCallableTargetType([optional], number);
  const target = rustCallableTargetType([number], number);
  const selected = select(source, target);
  assert.ok(Object.isFrozen(selected));
  assert.ok(Object.isFrozen(selected.parameters));
  assert.ok(Object.isFrozen(selected.parameters[0].conversion));
  for (const changed of [
    { ...selected, extra: true }, { ...selected, kind: "callable-absence-completion" },
    { ...selected, parameters: [undefined] }, { ...selected, parameters: new Array(1) },
    { ...selected, parameters: [{ kind: "unknown" }] },
    { ...selected, parameters: [{ ...selected.parameters[0], extra: true }] },
    { ...selected, result: { kind: "identity", extra: true } },
    { ...selected, parameters: [{ kind: "value", conversion: { kind: "option-some", source: string, element: number } }] },
  ]) assert.equal(rustCallableConversionMatches(changed, source, target), false);
});
