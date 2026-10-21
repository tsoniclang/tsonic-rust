import assert from "node:assert/strict";
import test from "node:test";
import { planRustErrorTransport, planRustSourceErrorTransport } from "../../../../dist/backend/planner/program/error-transport.js";
import { planRustErrorObservations } from "../../../../dist/backend/planner/program/error-observations.js";
import { planRustSourceErrorObservations } from "../../../../dist/backend/planner/program/source-error-observations.js";
import { rustSourceErrorTargetType } from "../../../../dist/target-model/types/carriers/source-error.js";
import { rustJsErrorTargetType, rustProgramErrorTargetType, rustSourceTypeCarrier, rustStringTargetType } from "../../../../dist/target-model/types/index.js";
import { selectRustFlowReadProjection } from "../../../../dist/policy/types/value-carrier-reconciliation.js";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";

const named = path => ({ kind: "named", path });
const rows = [
  { name: "HttpError", type: named("crate::http::HttpError"), source: "error" },
  { name: "Unrelated", type: named("crate::large::Unrelated"), source: "thrown" },
  { name: "DependencyError", type: named("dependency::program::TsonicError"), sourceErrorType: named("dependency::program::SourceError"), writableSourceErrorType: named("dependency::program::WritableSourceError"), source: "external" },
];

test("one physical enum specializes unrelated payloads to the native uninhabited type", () => {
  const plan = planRustErrorTransport(rows);
  assert.ok(plan);
  assert.equal(plan.declaration.kind, "enum");
  assert.equal(plan.declaration.name, "ErrorTransport");
  assert.equal(plan.generics.parameters.length, 5);
  assert.deepEqual(plan.declaration.variants.find(item => item.name === "HttpError").fields, [rows[0].type]);
  assert.deepEqual(plan.declaration.variants.find(item => item.name === "Unrelated").fields, [named("Payload0")]);
  const full = plan.aliases.find(item => item.name === "TsonicError");
  assert.equal(full.kind, "type-alias");
  assert.deepEqual(full.target.genericArguments.map(argument => argument.type), [named("tsonic_rust_runtime::TsonicError"),
    named("tsonic_rust_runtime::MutableJsError"), named("SuppressedErrorPayload"), rows[1].type, rows[2].type]);
  const source = plan.aliases.find(item => item.name === "SourceError");
  assert.equal(source.kind, "struct");
  assert.equal(source.fields.length, 1);
  assert.equal(source.fields[0].visibility, "private");
  assert.deepEqual(source.fields[0].type.genericArguments.map(argument => argument.type), [named("tsonic_rust_runtime::TsonicError"),
    named("tsonic_rust_runtime::MutableJsError"), named("SuppressedErrorPayload"),
    named("core::convert::Infallible"), rows[2].sourceErrorType]);
  assert.equal(plan.aliases.some(item => item.kind === "enum"), false);
  assert.deepEqual(plan.declaration.variants.find(item => item.name === "Suppressed").fields, [named("SuppressedPayload")]);
});

test("admission retains exact rejected payloads and invokes no allocating adapter", () => {
  const plan = planRustErrorTransport(rows);
  const items = planRustSourceErrorTransport(plan);
  const conversion = items.find(item => item.trait?.path === "core::convert::TryFrom");
  const body = conversion.members.find(item => item.name === "try_from").body.statements[0].expr;
  const rejected = body.arms.find(item => item.pattern.path === "ErrorTransport::Unrelated");
  assert.deepEqual(rejected.expression, { kind: "call", path: "Err", args: [
    { kind: "call", path: "ErrorTransport::Unrelated", args: [{ kind: "path", path: "error" }] },
  ] });
  const external = body.arms.find(item => item.pattern.path === "ErrorTransport::DependencyError");
  assert.deepEqual(external.expression.expression, { kind: "call", path: "dependency::program::SourceError::try_from", args: [
    { kind: "path", path: "error" },
  ] });
  assert.equal(items.some(item => item.trait === undefined && item.target?.path === "TsonicError"), false);
  assert.equal(external.expression.arms[1].expression.args[0].path, "ErrorTransport::DependencyError");
  const constructors = items.filter(item => item.trait?.path === "core::convert::From" && item.target.path === "SourceError");
  assert.ok(constructors.some(item => item.trait.genericArguments[0].type.path === rows[0].type.path));
  assert.ok(constructors.some(item => item.trait.genericArguments[0].type.path === rows[2].sourceErrorType.path));
  assert.equal(constructors.some(item => item.trait.genericArguments[0].type.path === rows[1].type.path), false);
  const calls = [];
  const visit = value => {
    if (value === null || typeof value !== "object") return;
    if (value.kind === "call") calls.push(value.path);
    for (const child of Object.values(value)) visit(child);
  };
  visit(items);
  assert.equal(calls.some(path => path === "Box::new" || path === "Rc::new" || path === "Arc::new" || path.includes("JsError::new")), false);
});

test("writable admission preserves rejected native payloads and uninhabited restoration directly", () => {
  const plan = planRustErrorTransport(rows);
  const items = planRustSourceErrorTransport(plan, true);
  const admission = items.find(item => item.trait?.path === "core::convert::TryFrom")
    .members.find(member => member.name === "try_from").body.statements[0].expr;
  for (const name of ["Runtime", "Suppressed"]) {
    const arm = admission.arms.find(value => value.pattern.path === `ErrorTransport::${name}`);
    assert.equal(arm.expression.path, "Err");
    assert.equal(arm.expression.args[0].path, `ErrorTransport::${name}`);
    assert.deepEqual(arm.expression.args[0].args, arm.pattern.elements.map(value => ({ kind: "path", path: value.name })));
  }
  const restored = items.find(item => item.target.path === "TsonicError" && item.trait?.path === "core::convert::From")
    .members[0].body.statements[0].expr;
  const suppressed = restored.arms.find(value => value.pattern.path === "ErrorTransport::Suppressed");
  assert.deepEqual(suppressed.pattern.elements.map(value => value.kind), ["binding"]);
  assert.deepEqual(suppressed.expression, { kind: "match", expression: { kind: "path", path: "source" }, arms: [] });
  const runtime = restored.arms.find(value => value.pattern.path === "ErrorTransport::Runtime");
  assert.deepEqual(runtime.expression, { kind: "match", expression: { kind: "path", path: "error" }, arms: [] });
  const external = admission.arms.find(value => value.pattern.path === "ErrorTransport::DependencyError");
  assert.equal(external.expression.expression.path, "dependency::program::WritableSourceError::try_from");
});

test("base observations borrow real project Error storage but never unrelated thrown values", () => {
  const plan = planRustErrorTransport(rows);
  const item = planRustErrorObservations(plan);
  const source = item.members.find(member => member.name === "source_error").body.statements[0].expr;
  assert.deepEqual(source.arms.find(arm => arm.pattern.path === "ErrorTransport::HttpError").expression,
    { kind: "call", path: "Some", args: [{ kind: "path", path: "error" }] });
  assert.deepEqual(source.arms.find(arm => arm.pattern.path === "ErrorTransport::Unrelated").expression, { kind: "none" });
  const admitted = item.members.find(member => member.name === "source_error_value").body.statements[0].expr;
  assert.equal(admitted.kind, "match");
  assert.equal(admitted.expression.path, "self");
  assert.deepEqual(admitted.arms.find(arm => arm.pattern.path === "ErrorTransport::Unrelated").expression, { kind: "none" });
  assert.equal(admitted.arms.find(arm => arm.pattern.path === "ErrorTransport::Unrelated").pattern.elements[0].kind, "wildcard");
  const admittedClass = admitted.arms.find(arm => arm.pattern.path === "ErrorTransport::HttpError").expression;
  assert.equal(admittedClass.args[0].args[0].receiver.path, "error");
  const native = item.members.find(member => member.name === "native_error_value").body.statements[0].expr;
  assert.deepEqual(native.arms.find(arm => arm.pattern.path === "ErrorTransport::HttpError").expression, { kind: "none" });
  const sourceItems = planRustSourceErrorObservations(plan);
  const message = sourceItems[0].members.find(member => member.name === "message").body.statements[0].expr;
  assert.equal(message.arms.find(arm => arm.pattern.path === "ErrorTransport::HttpError").expression.path,
    "tsonic_rust_runtime::ErrorObject::error_message");
  assert.deepEqual(message.arms.find(arm => arm.pattern.path === "ErrorTransport::Unrelated").expression.arms, []);
});

test("closed transport rejects missing external specialization and conflicting variant identities", () => {
  assert.equal(planRustErrorTransport([{ ...rows[2], sourceErrorType: undefined }]), undefined);
  assert.equal(planRustErrorTransport([{ ...rows[2], writableSourceErrorType: undefined }]), undefined);
  assert.equal(planRustErrorTransport([{ ...rows[2], sourceErrorType: { kind: "unit" } }]), undefined);
  assert.equal(planRustErrorTransport([rows[0], { ...rows[1], name: rows[0].name }]), undefined);
  for (const name of ["Runtime", "SourceCreated", "Suppressed"]) assert.equal(planRustErrorTransport([{ ...rows[0], name }]), undefined);
  const plan = planRustErrorTransport(rows);
  assert.equal(plan.generics.parameters.every(parameter => parameter.bounds.length === 0), true,
    "internal transport representation requires no unrelated formatting bounds");
});

test("flow projection verifies exact Error-only admission instead of a global availability flag", () => {
  const source = rustProgramErrorTargetType();
  const selected = rustSourceErrorTargetType();
  const error = {};
  const unrelated = {};
  const errorCarrier = rustSourceTypeCarrier("project.ts", "HttpError", "object");
  const unrelatedCarrier = rustSourceTypeCarrier("project.ts", "Unrelated", "object");
  const policy = { sourceErrorCarrier: () => selected, sourceErrorDefinitions: [error],
    definitionForCarrier: carrier => rustTargetTypeRefEquals(carrier, errorCarrier) ? error
      : rustTargetTypeRefEquals(carrier, unrelatedCarrier) ? unrelated : undefined,
    programErrorVariant: definition => definition === error ? "HttpError" : definition === unrelated ? "Unrelated" : undefined };
  assert.equal(selectRustFlowReadProjection(source, selected, policy).fact.kind, "builtin-error");
  assert.equal(selectRustFlowReadProjection(selected, errorCarrier, policy).fact.kind, "program-error-variant");
  assert.equal(selectRustFlowReadProjection(selected, unrelatedCarrier, policy).kind, "incompatible");
  assert.equal(selectRustFlowReadProjection(source, rustStringTargetType(), policy).kind, "incompatible");
  assert.equal(selectRustFlowReadProjection(source, rustJsErrorTargetType(), policy).fact.kind, "builtin-error");
});
