import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generatedCargoOptions } from "../../helpers/cargo-target-pool.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as nativeIds from "../../../dist/target-model/types/carriers/source-types.js";
import * as errorIds from "../../../dist/target-model/types/carriers/source-error.js";
import { rustJsArrayValueTargetId } from "../../../dist/target-model/types/carriers/array-values.js";
import { rustJsArrayEntriesTargetId } from "../../../dist/target-model/types/carriers/array-entries.js";
import * as carrierExports from "../../../dist/target-model/types/carriers/built-ins.js";
import { classifyCarrierRequirements, rustFinalContractSupportsStatic } from "../../../dist/analysis/declarations/generic-carrier-requirements.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";
import { rustCallableInputTargetType, rustFutureTargetType, rustJsPromiseTargetType, rustStringTargetType } from "../../../dist/target-model/types/index.js";
import { analyzeRust, compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";

const extraIds = { ...errorIds, rustJsArrayValueTargetId, rustJsArrayEntriesTargetId };
const declarations = [
  [nativeIds.rustAbsenceTargetId, [], "arguments", "()"],
  [nativeIds.rustStringTargetId, [], "arguments", "String"],
  [nativeIds.rustStrTargetId, [], "arguments", "str"],
  [nativeIds.rustNativeScalarTargetId, [], "unavailable", undefined],
  [nativeIds.rustJsStringTargetId, [], "arguments", "js_abi::JsString"],
  [nativeIds.rustBigIntTargetId, [], "arguments", "rt::BigInt"],
  [nativeIds.rustOptionTargetId, ["type"], "arguments", "Option<i32>"],
  [nativeIds.rustLocationTargetId, ["type","type"], "arguments", "rt::Location<i32, i32>"],
  [nativeIds.rustInfallibleTargetId, [], "arguments", "core::convert::Infallible"],
  [nativeIds.rustRawPointerTargetId, [], "arguments", "rt::RawPointer"],
  [nativeIds.rustCallableTargetId, ["lifetime","type","type","type"], "arguments", "rt::Callable<'static, (i32,), Result<(), core::convert::Infallible>>"],
  [nativeIds.rustCallableInputTargetId, ["type","type"], "opaque", undefined],
  [nativeIds.rustGeneratorTargetId, ["type","type","type","type"], "arguments", "rt::Generator<i32, i32, i32, core::convert::Infallible>"],
  [nativeIds.rustAsyncGeneratorTargetId, ["type","type","type","type"], "arguments", "rt::AsyncGenerator<i32, i32, i32, core::convert::Infallible>"],
  [nativeIds.rustBorrowedGeneratorTargetId, ["lifetime","type","type","type","type"], "arguments", "rt::BorrowedGenerator<'static, i32, i32, i32, core::convert::Infallible>"],
  [nativeIds.rustBorrowedAsyncGeneratorTargetId, ["lifetime","type","type","type","type"], "arguments", "rt::BorrowedAsyncGenerator<'static, i32, i32, i32, core::convert::Infallible>"],
  [nativeIds.rustIteratorResultTargetId, ["type","type"], "arguments", "rt::IteratorResult<i32, i32>"],
  [nativeIds.rustJsErrorTargetId, [], "arguments", "rt::JsError"],
  [nativeIds.rustProgramErrorTargetId, [], "program-error", "rt::TsonicError"],
  [nativeIds.rustTsValueTargetId, [], "arguments", "rt::TsValue"],
  [nativeIds.rustJsValueTargetId, [], "arguments", "js_abi::JsValue"],
  [nativeIds.rustEmptyObjectTargetId, [], "arguments", "tsonic_rust_runtime::EmptyObject"],
  [nativeIds.rustObjectIdentityTargetId, [], "arguments", "tsonic_rust_runtime::EmptyObject"],
  [nativeIds.rustJsNumericTargetId, [], "arguments", "js_abi::JsNumeric"],
  [nativeIds.rustJsStringNumberTargetId, [], "arguments", "js_abi::JsStringNumber"],
  [nativeIds.rustJsArrayTargetId, ["type"], "arguments", "js_abi::JsArray<i32>"],
  [nativeIds.rustJsArrayConcatItemTargetId, ["type"], "arguments", "js_abi::JsArrayConcatItem<i32>"],
  [nativeIds.rustJsMapTargetId, ["type","type"], "arguments", "js_abi::JsMap<i32, i32>"],
  [nativeIds.rustJsSetTargetId, ["type"], "arguments", "js_abi::JsSet<i32>"],
  [nativeIds.rustJsDateTargetId, [], "arguments", "js_abi::JsDate"],
  [nativeIds.rustJsSymbolTargetId, [], "arguments", "js_abi::JsSymbol"],
  [nativeIds.rustJsWeakMapTargetId, ["type","type"], "arguments", "js_abi::JsWeakMap<rt::EmptyObject, i32>"],
  [nativeIds.rustJsWeakSetTargetId, ["type"], "arguments", "js_abi::JsWeakSet<rt::EmptyObject>"],
  [nativeIds.rustJsPromiseTargetId, ["type"], "arguments", "js_abi::JsPromise<i32>"],
  [nativeIds.rustJsPromiseResolutionTargetId, ["type"], "arguments", "js_abi::PromiseResolution<i32>"],
  [nativeIds.rustJsPromiseFulfilledResultTargetId, ["type"], "arguments", "js_abi::PromiseFulfilledResult<i32>"],
  [nativeIds.rustJsPromiseRejectedResultTargetId, [], "arguments", "js_abi::PromiseRejectedResult"],
  [nativeIds.rustJsPromiseSettledResultTargetId, ["type"], "arguments", "js_abi::PromiseSettledResult<i32>"],
  [nativeIds.rustJsArrayBufferTargetId, [], "arguments", "js_abi::ArrayBuffer"],
  [nativeIds.rustJsDataViewTargetId, [], "arguments", "js_abi::DataView"],
  [nativeIds.rustJsInt8ArrayTargetId, [], "arguments", "js_abi::Int8Array"],
  [nativeIds.rustJsUint8ArrayTargetId, [], "arguments", "js_abi::Uint8Array"],
  [nativeIds.rustJsUint8ClampedArrayTargetId, [], "arguments", "js_abi::Uint8ClampedArray"],
  [nativeIds.rustJsInt16ArrayTargetId, [], "arguments", "js_abi::Int16Array"],
  [nativeIds.rustJsUint16ArrayTargetId, [], "arguments", "js_abi::Uint16Array"],
  [nativeIds.rustJsInt32ArrayTargetId, [], "arguments", "js_abi::Int32Array"],
  [nativeIds.rustJsUint32ArrayTargetId, [], "arguments", "js_abi::Uint32Array"],
  [nativeIds.rustJsFloat32ArrayTargetId, [], "arguments", "js_abi::Float32Array"],
  [nativeIds.rustJsFloat64ArrayTargetId, [], "arguments", "js_abi::Float64Array"],
  [nativeIds.rustJsIntlDateTimeFormatTargetId, [], "arguments", "js_abi::IntlDateTimeFormat"],
  [nativeIds.rustJsIntlNumberFormatTargetId, [], "arguments", "js_abi::IntlNumberFormat"],
  [nativeIds.rustJsIntlCollatorTargetId, [], "arguments", "js_abi::IntlCollator"],
  [nativeIds.rustJsIntlDateTimeFormatPartTargetId, [], "arguments", "js_abi::IntlDateTimeFormatPart"],
  [nativeIds.rustJsIntlNumberFormatPartTargetId, [], "arguments", "js_abi::IntlNumberFormatPart"],
  [nativeIds.rustJsIntlGroupingTargetId, [], "arguments", "js_abi::IntlGrouping"],
  [nativeIds.rustJsIntlResolvedDateTimeFormatOptionsTargetId, [], "arguments", "js_abi::IntlResolvedDateTimeFormatOptions"],
  [nativeIds.rustJsIntlResolvedNumberFormatOptionsTargetId, [], "arguments", "js_abi::IntlResolvedNumberFormatOptions"],
  [nativeIds.rustJsIntlResolvedCollatorOptionsTargetId, [], "arguments", "js_abi::IntlResolvedCollatorOptions"],
  [nativeIds.rustJsRegExpTargetId, [], "arguments", "js_abi::JsRegExp"],
  [nativeIds.rustRegExpExecArrayTargetId, [], "arguments", "js_abi::RegExpExecArray"],
  [nativeIds.rustRegExpMatchArrayTargetId, [], "arguments", "js_abi::RegExpMatchArray"],
  [nativeIds.rustRegExpIndicesTargetId, [], "arguments", "js_abi::RegExpIndices"],
  [nativeIds.rustRegExpNamedGroupsTargetId, [], "arguments", "js_abi::RegExpNamedGroups"],
  [nativeIds.rustRegExpNamedIndicesTargetId, [], "arguments", "js_abi::RegExpNamedIndices"],
  [nativeIds.rustRegExpStringIteratorTargetId, [], "arguments", "js_abi::RegExpStringIterator"],
  [nativeIds.rustJsRegExpExecArrayTargetId, [], "arguments", "js_abi::JsRegExpExecArray"],
  [nativeIds.rustJsRegExpMatchArrayTargetId, [], "arguments", "js_abi::JsRegExpMatchArray"],
  [nativeIds.rustJsRegExpIndicesTargetId, [], "arguments", "js_abi::JsRegExpIndices"],
  [nativeIds.rustJsRegExpNamedGroupsTargetId, [], "arguments", "js_abi::JsRegExpNamedGroups"],
  [nativeIds.rustJsRegExpNamedIndicesTargetId, [], "arguments", "js_abi::JsRegExpNamedIndices"],
  [nativeIds.rustJsRegExpStringIteratorTargetId, [], "arguments", "js_abi::JsRegExpStringIterator"],
  [extraIds.rustSourceErrorTargetId, [], "arguments", undefined],
  [extraIds.rustWritableSourceErrorTargetId, [], "arguments", undefined],
  [extraIds.rustMutableJsErrorTargetId, [], "arguments", "rt::MutableJsError"],
  [extraIds.rustRetainedErrorTargetId, [], "arguments", "rt::RetainedError"],
  [extraIds.rustWritableRetainedErrorTargetId, [], "arguments", "rt::WritableRetainedError"],
  [extraIds.rustJsArrayValueTargetId, [], "arguments", "js_abi::JsArrayValue"],
  [extraIds.rustJsArrayEntriesTargetId, ["type"], "arguments", "js_abi::JsArrayEntries<i32>"],
];

const definitions = carrierExports.rustBuiltInCarrierDefinitions;
const scalar = Object.freeze({ kind: "source-primitive", name: "int32" });
const unit = Object.freeze({ kind: "tuple", elements: [] });
const staticLifetime = Object.freeze({ kind: "static" });
const borrowedLifetime = Object.freeze({ kind: "parameter", identity: "static-test:environment", name: "environment" });
const parameter = Object.freeze({ kind: "type-parameter", identity: "static-test:Value", name: "Value" });
const borrowed = { kind: "reference", mutable: false, lifetime: borrowedLifetime, referent: rustStringTargetType() };
const selected = carrier => classifyCarrierRequirements(carrier, ["static"], new Set(), new Map(), () => false,
  emptyRustTypeDefinitions, undefined);
const carrier = (id, genericArguments = []) => ({ kind: "target-named", id, genericArguments,
  ...(id === nativeIds.rustProgramErrorTargetId ? { errorOwner: { kind: "physical", domain: "runtime" } } : {}) });
const actualArguments = (id, parameters) => parameters.map((kind, index) => kind === "lifetime"
  ? { kind, lifetime: staticLifetime }
  : { kind, type: id === nativeIds.rustCallableTargetId && index === 1 ? unit
    : (id === nativeIds.rustJsWeakMapTargetId || id === nativeIds.rustJsWeakSetTargetId) && index === 0
      ? carrier(nativeIds.rustEmptyObjectTargetId) : scalar });
const finalContract = requirements => ({ declaration: {},
  typeParameters: [{ identity: parameter.identity, name: parameter.name, requirements }],
  capturedTypeParameters: [], nativeInputs: [], associatedTypes: [], projectProjections: [], optionalStorage: [] });

test("every registered runtime carrier has one immutable native definition and the provider domain is unchanged", () => {
  assert.equal(Object.isFrozen(definitions), true, "one immutable canonical declaration table");
  assert.equal(Object.hasOwn(carrierExports, "rustBuiltInCarrierRenderPaths"), false, "the superseded API is absent");
  const identifiers = Object.entries(nativeIds).filter(([symbol]) => symbol.endsWith("TargetId"));
  assert.equal(identifiers.length, 71, "all actual source carrier IDs are enumerated");
  assert.equal(declarations.length, 78, "source IDs plus seven existing extra registrations");
  assert.equal(new Set(declarations.map(([id]) => id)).size, declarations.length, "each declaration occurs once");
  assert.equal(Object.keys(definitions).length, declarations.length, "new registrations need explicit proof rows");
  for (const [symbol, id] of identifiers)
    assert.equal(declarations.filter(([candidate]) => candidate === id).length, 1, symbol);
  for (const [id, parameters, storage] of declarations) {
    const definition = definitions[id];
    assert.equal(definition !== undefined, true, `${id}: canonical declaration exists`);
    assert.equal(Object.isFrozen(definition), true, `${id}: declaration is immutable`);
    assert.equal(Object.isFrozen(definition.parameters), true, `${id}: parameter vector is immutable`);
    assert.equal(definition.parameters.join(","), parameters.join(","), `${id}: actual native parameter kinds`);
    assert.equal(definition.storage, storage, `${id}: actual physical evidence category`);
    const previouslyAdmitted = id !== nativeIds.rustAbsenceTargetId && id !== nativeIds.rustNativeScalarTargetId &&
      id !== nativeIds.rustCallableInputTargetId;
    assert.equal(carrierExports.isRustBuiltInTargetCarrierId(id), previouslyAdmitted, `${id}: provider domain unchanged`);
  }
  for (const id of ["foreign:Carrier", "constructor", "__proto__"])
    assert.equal(carrierExports.isRustBuiltInTargetCarrierId(id), false, `${id}: not a registered provider carrier`);
});

test("native storage checks exact argument kinds, all free parameters and every contextual exclusion", () => {
  for (const [id, parameters, storage] of declarations) {
    const arguments_ = actualArguments(id, parameters);
    const value = carrier(id, arguments_);
    const expected = storage === "arguments" || id === nativeIds.rustProgramErrorTargetId ? "supported" : "unresolved";
    assert.equal(selected(value).kind, expected, `${id}: actual complete declaration`);
    assert.equal(selected(carrier(id, [...arguments_, { kind: "type", type: scalar }])).kind,
      "unresolved", `${id}: extra arguments cannot prove storage`);
    for (let index = 0; index < arguments_.length; index++) {
      assert.equal(selected(carrier(id, arguments_.filter((_, position) => position !== index))).kind,
        "unresolved", `${id}: missing argument ${index}`);
      const wrong = arguments_.map((argument, position) => position !== index ? argument
        : { kind: "const", value: { kind: "integer", value: "0" } });
      assert.equal(selected(carrier(id, wrong)).kind, "unresolved", `${id}: wrong parameter kind ${index}`);
      if (storage !== "arguments") continue;
      const retained = arguments_.map((argument, position) => position !== index ? argument : argument.kind === "lifetime"
        ? { kind: "lifetime", lifetime: borrowedLifetime } : { kind: "type", type: borrowed });
      if (id === nativeIds.rustCallableTargetId && index === 1) retained[index] = { kind: "type", type: { kind: "tuple", elements: [borrowed] } };
      assert.equal(selected(carrier(id, retained)).kind, "unsatisfied", `${id}: argument ${index} retains its actual borrow`);
      if (arguments_[index].kind !== "type") continue;
      const generic = arguments_.map((argument, position) => position !== index ? argument : { kind: "type", type: parameter });
      if (id === nativeIds.rustCallableTargetId && index === 1) generic[index] = { kind: "type", type: { kind: "tuple", elements: [parameter] } };
      assert.equal(rustFinalContractSupportsStatic(finalContract([]), carrier(id, generic), { implementation: () => undefined },
        emptyRustTypeDefinitions, undefined).kind, "unsatisfied", `${id}: known generic ${index} needs its own bound`);
      assert.equal(rustFinalContractSupportsStatic(finalContract(["static"]), carrier(id, generic), { implementation: () => undefined },
        emptyRustTypeDefinitions, undefined).kind, "supported", `${id}: exact generic ${index} bound is sufficient`);
    }
  }
  for (const errorOwner of [undefined, { kind: "logical" },
    { kind: "physical", domain: "project", componentId: "" }, { kind: "physical", domain: "foreign" }])
    assert.equal(selected({ kind: "target-named", id: nativeIds.rustProgramErrorTargetId, ...(errorOwner === undefined ? {} : { errorOwner }) }).kind,
      "unresolved", "a missing, logical or invalid error owner does not prove native payload storage");
  for (const errorOwner of [{ kind: "physical", domain: "runtime" }, { kind: "physical", domain: "project", componentId: "source" }])
    assert.equal(selected({ kind: "target-named", id: nativeIds.rustProgramErrorTargetId, errorOwner }).kind,
      "supported", `${errorOwner.domain}: the actual admitted physical error owner has a closed native payload`);
  for (const id of ["foreign:Carrier", "constructor", "__proto__"])
    assert.equal(selected(carrier(id)).kind, "unresolved", `${id}: unknown is not static`);
  assert.equal(selected(rustFutureTargetType(scalar)).kind, "unresolved", "the real native Future output does not prove its captured storage");
  assert.equal(selected(rustFutureTargetType(borrowed)).kind, "unresolved", "the real borrowed-output Future still has no physical capture proof");
  assert.equal(selected(rustCallableInputTargetType([], scalar, staticLifetime)).kind,
    "unresolved", "an input signature does not reveal its implementation environment");
  assert.equal(selected(rustJsPromiseTargetType(borrowed)).kind, "unsatisfied", "a real resolved Promise can store nonstatic T");
  assert.equal(selected(rustJsPromiseTargetType(scalar)).kind, "supported", "the concrete Promise object has an actual static T");
});

test("registered concrete native types and explicit generic outlives inverses compile against the actual runtimes", { timeout: 300_000 }, () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const runtime = resolve(root, "../rust-runtime/crates/tsonic_rust_runtime");
  const javascript = resolve(root, "../rust-js/crates/tsonic_rust_js");
  const prefix = "use tsonic_rust_js::abi as js_abi;\nuse tsonic_rust_runtime as rt;\nfn require_static_type<Value: ?Sized + 'static>() {}\n";
  const concrete = declarations.filter(([, , , nativeType]) => nativeType !== undefined);
  const positive = `${prefix}\n#[test]\nfn every_concrete_registered_type_has_its_proven_native_outlives() {\n${concrete.map(([, , , nativeType]) =>
    `    require_static_type::<${nativeType}>();`).join("\n")}\n}\n`;
  const probes = [
    ["promise_free_generic", "pub fn exact<Value>() { require_static_type::<js_abi::JsPromise<Value>>(); }", false, "E0310"],
    ["promise_bound_generic", "pub fn exact<Value: 'static>() { require_static_type::<js_abi::JsPromise<Value>>(); }", true],
    ["promise_free_borrow", "pub fn exact<'environment>() { require_static_type::<js_abi::JsPromise<&'environment str>>(); }", false, "lifetime"],
    ["promise_bound_borrow", "pub fn exact<'environment: 'static>() { require_static_type::<js_abi::JsPromise<&'environment str>>(); }", true],
    ["generator_free_generic", "pub fn exact<Value>() { require_static_type::<rt::Generator<Value, (), (), core::convert::Infallible>>(); }", false, "E0310"],
    ["generator_bound_generic", "pub fn exact<Value: 'static>() { require_static_type::<rt::Generator<Value, (), (), core::convert::Infallible>>(); }", true],
    ["generator_free_environment", "pub fn exact<'environment>() { require_static_type::<rt::BorrowedGenerator<'environment, i32, (), (), core::convert::Infallible>>(); }", false, "lifetime"],
    ["generator_bound_environment", "pub fn exact<'environment: 'static>() { require_static_type::<rt::BorrowedGenerator<'environment, i32, (), (), core::convert::Infallible>>(); }", true],
    ["location_free_generic", "pub fn exact<Value>() { require_static_type::<rt::Location<Value>>(); }", false, "E0310"],
    ["location_bound_generic", "pub fn exact<Value: 'static>() { require_static_type::<rt::Location<Value>>(); }", true],
    ["weak_map_free_key", "pub fn exact<Key: rt::ObjectIdentityCarrier>() { require_static_type::<js_abi::JsWeakMap<Key, i32>>(); }", false, "E0310"],
    ["weak_map_bound_key", "pub fn exact<Key: rt::ObjectIdentityCarrier + 'static>() { require_static_type::<js_abi::JsWeakMap<Key, i32>>(); }", true],
    ["factory_free_borrow", "struct Factory<Value> { value: Value }\npub fn exact<'environment>() { require_static_type::<Factory<&'environment str>>(); }", false, "lifetime"],
    ["factory_owned", "struct Factory<Value> { value: Value }\npub fn exact() { require_static_type::<Factory<i32>>(); }", true],
  ];
  const project = writeGeneratedProject("static-runtime-native-facts", [
    { path: "Cargo.toml", text: `[package]\nname = "static_runtime_native_facts"\nversion = "0.0.0"\nedition = "2021"\n[workspace]\n[dependencies]\ntsonic_rust_runtime = { path = ${JSON.stringify(runtime)} }\ntsonic_rust_js = { path = ${JSON.stringify(javascript)} }\n[patch.crates-io]\ntsonic_rust_runtime = { path = ${JSON.stringify(runtime)} }\n` },
    { path: "src/lib.rs", text: positive },
    ...probes.map(([name, body]) => ({ path: `src/bin/${name}.rs`, text: `${prefix}${body}\nfn main() {}\n` })),
  ]);
  console.log(`native carrier evidence project: ${project}`);
  runCargo(project, ["generate-lockfile", "--offline"]);
  runCargo(project, ["test", "--lib", "--locked", "--offline"]);
  for (const [name, , accepted, diagnostic] of probes) {
    const arguments_ = ["check", "--bin", name, "--locked", "--offline"];
    const result = spawnSync("cargo", arguments_, generatedCargoOptions(project, arguments_, {
      cwd: project, encoding: "utf8", timeout: 300_000,
    }));
    const log = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    writeFileSync(join(project, `${name}.log`), log);
    assert.equal(result.error === undefined, true, `${name}: native compiler completed`);
    assert.equal(result.signal, null, `${name}: native compiler was not interrupted`);
    assert.equal(result.status === 0, accepted, `${name}: explicit native type result\n${log}`);
    if (!accepted) assert.equal(log.includes(diagnostic), true, `${name}: actual outlives rejection`);
  }
});

test("one actual class template keeps every owned and borrowed native factory instantiation distinct", () => {
  const { program } = analyzeRust({ files: { "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
function factory<Value>(value: Value) {
  return new class Held {
    read(): Value { return value; }
  }();
}
export function inspect<Region extends Life>(loan: Ref<int32, Region>) {
  const owned = factory<int32>(7);
  const borrowed = factory<Ref<int32, Region>>(loan);
  const ownedAgain = factory<int32>(8);
  const borrowedAgain = factory<Ref<int32, Region>>(loan);
  return { owned, borrowed, ownedAgain, borrowedAgain };
}
` } });
  const ast = program.source.ast;
  const variables = new Map();
  let declaration;
  const visit = node => {
    const name = ast.name(node);
    if (ast.kindName(node) === "KindVariableDeclaration" && name !== undefined) variables.set(ast.text(name), node);
    if (ast.is.IsFunctionDeclaration(node) && name !== undefined && ast.text(name) === "inspect") declaration = node;
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const sourceFile of program.records.sourceArtifacts.get().map(artifact => artifact.sourceFile)) visit(sourceFile);
  assert.equal(declaration !== undefined, true, "actual lifetime-bearing source owner exists");
  const contract = program.declarationGenericRequirements.contractFor(declaration);
  assert.equal(contract !== undefined, true, "the actual final source contract is published");
  const evidence = { lifetimeContract: program.sourceLifetimes.contractFor(declaration),
    genericCallables: program.callableValues.generic, frameCallables: program.callableValues.frames,
    classValues: program.classValues, projectTypes: program.projectTypes, objectRepresentations: program.objectRepresentations,
    structuralShapes: program.structuralShapes, records: program.records, projectFieldStorage: program.callableValues.projectFieldStorage };
  const carriers = new Map();
  for (const name of ["owned", "borrowed", "ownedAgain", "borrowedAgain"]) {
    assert.equal(variables.has(name), true, `${name}: actual checked declaration exists`);
    const value = program.records.runtimeCarrier.get(variables.get(name))?.carrier;
    assert.equal(value !== undefined, true, `${name}: actual sealed native instance exists`);
    carriers.set(name, value);
  }
  const template = program.projectTypes.definitionForCarrier(carriers.get("owned"));
  assert.equal(template !== undefined, true, "the native class has one actual declaration blueprint");
  for (const name of ["borrowed", "ownedAgain", "borrowedAgain"])
    assert.equal(program.projectTypes.definitionForCarrier(carriers.get(name)) === template, true, `${name}: the same class AST is reused`);
  const environment = program.classValues.forDeclaration(template.declaration)?.environment;
  assert.equal(environment !== undefined && environment.captures.length === 1, true, "the nonempty actual capture blueprint is present");
  for (const name of ["owned", "borrowed", "ownedAgain", "borrowedAgain", "borrowed", "owned"])
    assert.equal(rustFinalContractSupportsStatic(contract, carriers.get(name), program.typeFamilies, program.typeDefinitions, evidence).kind,
      name.startsWith("borrowed") ? "unsatisfied" : "supported", `${name}: only its exact physical binding decides static retention`);
});

test("input-only function pointers and RegExp retention match actual native storage and costs", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: {
    outputType: "lib", crateName: "static_runtime_generated",
  } }, files: { "index.ts": `
import { allocateptr, loadptr } from "@tsonic/core/lang.js";
import type { FunctionPointer, Pointer } from "@tsonic/core/types.js";
export function retainInput<Value>(value: FunctionPointer<[Value], void>): Pointer<FunctionPointer<[Value], void>> {
  return allocateptr(value);
}
export function retainPattern(value: RegExp): Pointer<RegExp> { return allocateptr(value); }
export function verify(): void {
  const pattern = loadptr(retainPattern(new RegExp("^a+$")));
  if (!pattern.test("aaa") || pattern.test("bbb")) throw new Error("retained pattern");
}
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  const output = artifactText(result, "src/index.rs");
  assert.equal(/pub fn retainInput<Value: 'static>\(\s*value: fn\(Value\) -> \(\),?\s*\) -> rt::Location<fn\(Value\) -> \(\), rt::TsonicError>/u.test(output),
    true, "the input-only function pointer has the exact static bound, void result and native Location carrier");
  assert.match(output, /pub fn retainPattern\(value: js_abi::JsRegExp\)/u);
  assert.equal(/pub fn retainPattern\(value: js_abi::JsRegExp\) -> rt::Location<js_abi::JsRegExp, rt::TsonicError> \{\s*rt::Location::<js_abi::JsRegExp, rt::TsonicError>::allocate\(value\)\s*\}/u.test(output),
    true, "RegExp retention moves the actual native value into Location without an additional clone or adapter");
  const root = writeGeneratedProject("static-runtime-generated", result.artifacts);
  const nativeCost = `${nativeOwnershipCostSupport(root)}
use static_runtime_generated::index;
use tsonic_rust_js::abi as js_abi;
use tsonic_rust_runtime as rt;

fn consume(value: i32) { assert_eq!(value, 7); }
fn native_location_like<Value: Clone + 'static, Error>(_: &rt::Location<Value, Error>, value: Value) -> rt::Location<Value, Error> {
    rt::Location::allocate(value)
}

#[test]
fn actual_generated_calls_and_locations_match_native_costs() {
    index::verify().unwrap();
    for _ in 0..32 {
        let callback: fn(i32) = consume;
        let (generated, generated_cost) = measure(|| index::retainInput(callback));
        let (native, native_cost) = measure(|| native_location_like(&generated, callback));
        assert_eq!(generated_cost, native_cost);
        assert_eq!(generated_cost.allocations, 1);
        generated.try_load().unwrap()(7);
        native.try_load().unwrap()(7);
        let generated_input = js_abi::JsRegExp::from_string(&js_abi::JsString::from_utf8("^a+$")).unwrap();
        let native_input = generated_input.clone();
        let (generated_pattern, generated_pattern_cost) = measure(|| index::retainPattern(generated_input));
        let (native_pattern, native_pattern_cost) = measure(|| native_location_like(&generated_pattern, native_input));
        assert_eq!(generated_pattern_cost, native_pattern_cost);
        assert_eq!(generated_pattern_cost.allocations, 1);
        assert!(generated_pattern.try_load().unwrap().test(&js_abi::JsString::from_utf8("aaa")).unwrap());
        assert!(native_pattern.try_load().unwrap().test(&js_abi::JsString::from_utf8("aaa")).unwrap());
    }
}
`;
  const formatted = spawnSync("rustfmt", ["--edition", "2021"], { input: nativeCost, encoding: "utf8", timeout: 30_000 });
  assert.equal(formatted.status, 0, "the handwritten control formats independently of generated artifacts");
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(join(root, "tests/static_cost.rs"), formatted.stdout);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["fmt", "--all", "--check"]);
  runCargo(root, ["check", "--all-targets", "--locked", "--offline"]);
  runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(root, ["test", "--locked", "--offline"]);
});

test("generated RegExp class factories retain both actual native environments", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: {
    outputType: "bin", crateName: "static_regexp_factory",
  } }, files: { "index.ts": `
import { allocateptr, loadptr } from "@tsonic/core/lang.js";
import type { Pointer } from "@tsonic/core/types.js";
function retainPattern(value: RegExp): Pointer<RegExp> { return allocateptr(value); }
function patternFactory(value: RegExp) {
  return new class Pattern {
    matches(text: string): boolean { return value.test(text); }
  }();
}
export function verify(): void {
  const pattern = loadptr(retainPattern(new RegExp("^a+$")));
  const first = patternFactory(pattern);
  const second = patternFactory(new RegExp("^b+$"));
  if (!first.matches("aaa") || first.matches("bbb") || !second.matches("bbb")) throw new Error("factory identity");
}
verify();
` } });
  assertNoTargetDiagnostics(result.diagnostics);
  validateGeneratedProject("static-regexp-factory", result.artifacts, { run: true });
});

for (const [label, surfaces] of [["native", []], ["js", ["js"]]]) {
  test(`returned structural methods retain generic values and caught error identity (${label})`,
    { timeout: 300_000 }, () => {
      const { result } = compileRust({ surfaces, target: { id: "rust", options: {
        outputType: "bin", crateName: `static_caught_methods_${label}`,
      } }, files: { "index.ts": `
class AppError extends Error {}

export function hold<T>(value: T, original: Error): { read(): T } {
  try { throw original; }
  catch (caught) {
    return { read(): T {
      if (!(caught instanceof Error) || caught !== original || caught.message !== "retained method error") {
        throw new Error("structural capture lost its actual caught payload or identity");
      }
      return value;
    } };
  }
}
export function verify(): void {
  const original = new AppError("retained method error");
  const numeric = hold(7, original);
  const text = hold("native", original);
  if (numeric.read() !== 7 || text.read() !== "native") throw new Error("structural capture lost a generic value");
}
verify();
` } });
      assertNoTargetDiagnostics(result.diagnostics);
      validateGeneratedProject(`static-caught-methods-${label}`, result.artifacts, { run: true });
    });
  test(`closed source error payloads retain their actual native static representation (${label})`, { timeout: 300_000 }, () => {
    const crateName = `static_source_errors_${label}`;
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { crateName } }, files: { "index.ts": `
import { allocateptr, loadptr } from "@tsonic/core/lang.js";
import type { Pointer } from "@tsonic/core/types.js";

class AppError extends Error {}
export function keep(error: Error): Pointer<Error> { return allocateptr(error); }
export function make(): AppError { return new AppError("x"); }
export function verify(): void {
  const original: Error = make();
  const retained = loadptr(keep(original));
  if (retained.message !== "x") throw new Error("retained source error payload");
}
` } });
    assertNoTargetDiagnostics(result.diagnostics);
    const transports = result.artifacts.filter(artifact => /^src\/[^/]+\.rs$/u.test(artifact.path) &&
      /pub struct SourceError\s*\{/u.test(artifact.text));
    assert.equal(transports.length, 1, "one actual generated source-error transport owner exists");
    const transport = transports[0];
    assert.equal(/pub struct WritableSourceError\s*\{/u.test(transport.text), true,
      "the actual writable source-error payload is non-generic");
    assert.equal(/pub type TsonicError\s*=/u.test(transport.text), true,
      "the actual project program error is a closed non-generic alias");
    const moduleName = transport.path.slice(4, -3);
    assert.equal(artifactText(result, "src/lib.rs").includes(`pub mod ${moduleName};`), true,
      "the native proof imports the actual emitted transport module");
    const native = `use ${crateName}::${moduleName}::{SourceError, TsonicError, WritableSourceError};

fn require_static_type<Value: ?Sized + 'static>() {}

#[test]
fn actual_generated_source_error_payloads_are_static() {
    require_static_type::<SourceError>();
    require_static_type::<WritableSourceError>();
    require_static_type::<TsonicError>();
    ${crateName}::index::verify().unwrap();
}
`;
    const formatted = spawnSync("rustfmt", ["--edition", "2021"], { input: native, encoding: "utf8", timeout: 30_000 });
    assert.equal(formatted.status, 0, "the actual generated-error native control formats");
    validateGeneratedProject(`static-source-errors-${label}`,
      [...result.artifacts, { path: "tests/static_errors.rs", text: formatted.stdout }]);
  });
}

for (const [label, surfaces] of [["native", []], ["js", ["js"]]]) {
  for (const [domain, declaration, construction] of [
    ["builtin", "", 'new Error("retained caught error")'],
    ["project", "class AppError extends Error {}", 'new AppError("retained caught error")'],
  ]) {
    test(`caught errors have actual native Location storage (${domain}, ${label})`,
      { timeout: 300_000 }, () => {
        const { result } = compileRust({ surfaces, target: { id: "rust", options: {
          outputType: "bin", crateName: `static_caught_locations_${domain}_${label}`,
        } }, files: { "index.ts": `
import { allocateptr, loadptr } from "@tsonic/core/lang.js";
${declaration}

export function verify(): void {
  const original = ${construction};
  try { throw original; }
  catch (caught) {
    const location = allocateptr(caught);
    const retained = loadptr(location);
    if (!(retained instanceof Error) || retained !== original || retained.message !== "retained caught error") {
      throw new Error("caught native Location lost its actual payload or identity");
    }
  }
}
verify();
` } });
        assertNoTargetDiagnostics(result.diagnostics);
        validateGeneratedProject(`static-caught-locations-${domain}-${label}`, result.artifacts, { run: true });
      });
    test(`caught errors cross actual static storage and Promise factory boundaries (${domain}, ${label})`,
      { timeout: 300_000 }, () => {
        const { result } = compileRust({ surfaces, target: { id: "rust", options: {
          outputType: "bin", crateName: `static_caught_errors_${domain}_${label}`,
        } }, files: { "index.ts": `
import { allocateptr, loadptr } from "@tsonic/core/lang.js";
${declaration}

export function retainCaught(original: Error) {
  try { throw original; }
  catch (caught) { return allocateptr(caught); }
}
export function caughtPromise(original: Error) {
  try { throw original; }
  catch (caught) { return (async () => caught)(); }
}
export async function verify(): Promise<void> {
  const original = ${construction};
  const retained = loadptr(retainCaught(original));
  if (!(retained instanceof Error) || retained !== original || retained.message !== "retained caught error") {
    throw new Error("caught error storage lost its actual payload or identity");
  }
  const pending = caughtPromise(original);
  const captured = await pending;
  if (!(captured instanceof Error) || captured !== original || captured.message !== "retained caught error") {
    throw new Error("caught error Promise capture lost its actual payload or identity");
  }
}
await verify();
` } });
        assertNoTargetDiagnostics(result.diagnostics);
        validateGeneratedProject(`static-caught-errors-${domain}-${label}`, result.artifacts, { run: true });
      });
  }
}
