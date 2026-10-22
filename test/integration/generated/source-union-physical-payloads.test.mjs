import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { createRustTypeDefinitionRegistry } from "../../../dist/analysis/project-types/type-definitions.js";
import { createRustGeneratedUnionPlan } from "../../../dist/analysis/objects/shapes/generated-union-plan.js";
import { rustSourceUnionTargetType } from "../../../dist/target-model/types/carriers/source-types.js";
import { rustFutureTargetType } from "../../../dist/target-model/types/carriers/primitives.js";
import { rustUnitTargetType, rustNamedTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { rustOptionTargetType } from "../../../dist/target-model/types/carriers/optional.js";
import { instantiateRustSourceUnionPayloads } from "../../../dist/target-model/types/source-union-definitions.js";
import { planRustSourceUnionPayloadTemplate } from "../../../dist/backend/planner/types/source-union-payloads.js";
import { rustTypeFromCarrier } from "../../../dist/backend/planner/types/carrier-syntax.js";
import { rustTypeFromCarrierInContext } from "../../../dist/backend/planner/types/render.js";
import { emptyRustGenerics, createRustSourceFile } from "../../../dist/backend/target-ast/syntax/nodes.js";
import { rustDeriveAttributes } from "../../../dist/backend/target-ast/syntax/attributes.js";
import { finalizeRustSourceStyle } from "../../../dist/backend/target-ast/normalization/source-style.js";
import { printRustType } from "../../../dist/print/source/types.js";
import { printRustSourceFile } from "../../helpers/printed-rust-source.mjs";
import { runCargo, writeGeneratedProject, validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { compileRust, artifactText } from "../../helpers/rust-session.mjs";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";

function nativeFixture() {
  const registry = createRustTypeDefinitionRegistry();
  const integer = { kind: "source-primitive", name: "int32" };
  const unit = rustUnitTargetType();
  const carrier = rustSourceUnionTargetType("/src/definitions.ts", "MixedCompletion");
  assert.equal(registry.registerSourceUnion({ carrier, variants: [
    { name: "Immediate", carrier: integer }, { name: "Pending", carrier: rustFutureTargetType(unit) },
  ] }, true), true);
  const typeDefinitions = registry.seal();
  const rendering = { typeDefinitions, pathFor: value => `crate::definitions::${value.typeName}`, additionalArgumentsFor: () => [] };
  const plan = planRustSourceUnionPayloadTemplate(typeDefinitions.sourceUnionPayloadTemplate(carrier), emptyRustGenerics,
    type => rustTypeFromCarrier(type, rendering));
  assert.equal(plan !== undefined, true);
  const declaration = printRustSourceFile(finalizeRustSourceStyle(createRustSourceFile([
    { kind: "enum", name: "MixedCompletion", visibility: "public", ...plan, attrs: rustDeriveAttributes(["Clone"]) },
  ])));
  const value = { kind: "type-parameter", identity: "call:Value", name: "Value" };
  const lifetime = { kind: "parameter", identity: "call:input", name: "input" };
  const borrowed = { kind: "reference", mutable: true, referent: value, lifetime };
  const completion = error => {
    const result = rustNamedTargetType("native.Result", "Result", [{ kind: "type", type: unit }, { kind: "type", type: error }]);
    const future = rustNamedTargetType("native.Ready", "core::future::Ready", [{ kind: "type", type: result }]);
    const physical = instantiateRustSourceUnionPayloads(carrier, [integer, future], typeDefinitions);
    assert.equal(physical !== undefined, true);
    const rendered = rustTypeFromCarrier(rustOptionTargetType(physical), rendering);
    assert.equal(rendered !== undefined, true);
    return printRustType(rendered);
  };
  return { declaration, borrowed: completion(borrowed), owned: completion(value) };
}

test("one native union template holds non-Clone borrowed and invocation-generic Future errors", { timeout: 300_000 }, () => {
  const fixture = nativeFixture();
  assert.equal((fixture.declaration.match(/enum MixedCompletion/gu) ?? []).length, 1);
  assert.doesNotMatch(fixture.borrowed, /Box|dyn |Clone|TsonicError|'static/u);
  assert.match(fixture.borrowed, /MixedCompletion<i32, core::future::Ready<Result<\(\), &'input mut Value>>>/u);
  const project = writeGeneratedProject("source-union-physical-futures", [
    { path: "Cargo.toml", text: '[package]\nname = "source_union_physical_futures"\nversion = "0.0.0"\nedition = "2024"\n' },
    { path: "src/main.rs", text: `
pub mod definitions { ${fixture.declaration} }
struct NonClone(u32);
fn borrowed<'input, Value>(value: &'input mut Value, _witness: &bool) -> ${fixture.borrowed} {
    Some(definitions::MixedCompletion::Pending(core::future::ready(Err(value))))
}
fn owned<Value>(value: Value) -> ${fixture.owned} {
    Some(definitions::MixedCompletion::Pending(core::future::ready(Err(value))))
}
fn ready<Output>(future: impl core::future::Future<Output = Output>) -> Output {
    match std::pin::pin!(future).as_mut().poll(&mut std::task::Context::from_waker(std::task::Waker::noop())) {
        std::task::Poll::Ready(output) => output,
        std::task::Poll::Pending => panic!("unexpected suspension"),
    }
}
fn main() {
    let mut value = NonClone(7);
    let address = core::ptr::from_ref(&value);
    let Some(definitions::MixedCompletion::Pending(future)) = borrowed(&mut value, &true) else { panic!("borrow arm"); };
    let error = ready(future).unwrap_err();
    assert_eq!(core::ptr::from_ref(&*error), address);
    error.0 = 13;
    assert_eq!(value.0, 13);
    let Some(definitions::MixedCompletion::Pending(future)) = owned(NonClone(19)) else { panic!("generic arm"); };
    assert_eq!(ready(future).unwrap_err().0, 19);
    let Some(definitions::MixedCompletion::Pending(future)) = owned(false) else { panic!("second generic arm"); };
    assert!(!ready(future).unwrap_err());
    let immediate: definitions::MixedCompletion<i32, ()> = definitions::MixedCompletion::Immediate(23);
    let definitions::MixedCompletion::Immediate(value) = immediate.clone() else { panic!("clone arm"); };
    assert_eq!(value, 23);
}
` },
  ]);
  runCargo(project, ["generate-lockfile", "--offline"]);
  runCargo(project, ["fmt"]);
  runCargo(project, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(project, ["run", "--locked", "--offline"]);
});

test("physical union payloads preserve native Clone, lifetime and exact error rejection", { timeout: 300_000 }, () => {
  const fixture = nativeFixture();
  for (const [name, body, expected] of [
    ["nonclone", "fn invalid<'input, Value>(value: &'input mut Value) { let _copy = borrowed(value).clone(); }", /clone.*trait bounds were not satisfied/u],
    ["escape", "fn invalid() -> impl core::future::Future<Output = Result<(), &'static mut u32>> { let mut value = 7; let Some(definitions::MixedCompletion::Pending(future)) = borrowed(&mut value) else { panic!(); }; future }", /cannot return value referencing local variable/u],
    ["wrong-error", "fn invalid(value: &mut bool) { let Some(definitions::MixedCompletion::Pending(future)) = borrowed(value) else { panic!(); }; let _: core::future::Ready<Result<(), &mut u32>> = future; }", /mismatched types/u],
  ]) {
    const project = writeGeneratedProject(`source-union-physical-${name}`, [{ path: "lib.rs", text: `
pub mod definitions { ${fixture.declaration} }
fn borrowed<'input, Value>(value: &'input mut Value) -> ${fixture.borrowed} {
    Some(definitions::MixedCompletion::Pending(core::future::ready(Err(value))))
}
${body}
` }]);
    const compiled = spawnSync("rustc", ["--edition=2024", "--crate-type=lib", "--emit=metadata", "--error-format=json",
      "lib.rs", "-o", resolve(project, "lib.rmeta")], { cwd: project, encoding: "utf8", timeout: 60_000, maxBuffer: 262_144 });
    assert.equal(compiled.error === undefined && compiled.signal === null, true, `${name}: compiler process`);
    assert.notEqual(compiled.status, 0, `${name}: invalid native program admitted`);
    const errors = compiled.stderr.split("\n").filter(line => line.trim().length > 0)
      .map(line => JSON.parse(line)).filter(diagnostic => diagnostic.level === "error");
    assert.equal(errors.some(diagnostic => expected.test(diagnostic.message)), true,
      `${name}: ${errors.map(diagnostic => diagnostic.message).join("; ")}`);
  }
});

test("imported and re-exported generic source aliases render the same canonical native payload declaration", { timeout: 300_000 }, () => {
  const { result } = compileRust({ target: { id: "rust", options: { outputType: "bin" } }, files: {
    "definitions.ts": `
import type { int32 } from "@tsonic/core/types.js";
export type Choice<Value> = Value | string;
export function choose(first: boolean, value: int32): Choice<int32> { return first ? value : "exact"; }
`,
    "facade.ts": `export type { Choice as Selected } from "./definitions.js";
export { choose } from "./definitions.js";`,
    "index.ts": `
import type { Selected as ImportedChoice } from "./facade.js";
import { choose } from "./facade.js";
function valid(value: ImportedChoice<int32>): boolean {
  if (typeof value === "string") return value === "exact";
  return value === 7;
}
export function main(): void { if (!valid(choose(true, 7)) || !valid(choose(false, 7))) throw new Error("alias payload"); }
main();
`,
  } });
  assertNoTargetDiagnostics(result.diagnostics);
  assert.equal(/enum Choice/u.test(artifactText(result, "src/definitions.rs")), false,
    "a transparent source alias must not duplicate its canonical physical enum");
  assert.equal((artifactText(result, "src/shapes.rs").match(/enum Union2<Payload0, Payload1>/gu) ?? []).length, 1);
  assert.equal(/Union2<String, i32>/u.test(artifactText(result, "src/index.rs")), true);
  validateGeneratedProject("imported-source-union-physical-payloads", result.artifacts, { run: true });
});

test("canonical authored and generated sums admit opaque futures in native signatures", { timeout: 300_000 }, () => {
  const integer = { kind: "source-primitive", name: "int32" };
  const opaque = { kind: "impl-trait", id: "call:Future", captures: [], outlives: [], bounds: [
    { kind: "trait-ref", id: "native.Future", path: "core::future::Future", genericArguments: [], associatedConstraints: [
      { kind: "equality", identity: "native.Future:Output", name: "Output", genericArguments: [], type: integer },
    ] },
  ] };
  for (const origin of ["authored", "generated"]) {
    const registry = createRustTypeDefinitionRegistry();
    const name = origin === "generated" ? "Union2" : "Completion";
    const payloads = [integer, rustFutureTargetType(integer)];
    const carrier = rustSourceUnionTargetType("/src/definitions.ts", name, [], origin,
      origin === "generated" ? { kind: "physical", types: payloads } : { kind: "source" });
    const definition = { carrier, variants: payloads.map((carrier, index) => ({ name: `Variant${index}`, carrier })) };
    assert.equal(registry.registerSourceUnion(definition, origin === "authored"), true);
    const physical = instantiateRustSourceUnionPayloads(carrier, [integer, opaque], registry);
    assert.equal(physical !== undefined, true);
    const shapes = createRustGeneratedUnionPlan(origin === "generated" ? [definition] : [], () => "root", new Map());
    const context = { moduleName: "main", structuralShapesModuleName: "definitions",
      moduleNameByFileName: new Map([["/src/definitions.ts", "definitions"]]), externalCrateNameByFileName: new Map(),
      externalStructuralShapeModuleByFileName: new Map(), input: { program: { typeDefinitions: registry.seal(),
        names: { nameForSourceType: (_file, typeName) => typeName }, structuralShapes: shapes,
        callableValues: { native: { protocolForSourceItem: () => undefined } } } } };
    const plan = planRustSourceUnionPayloadTemplate(registry.sourceUnionPayloadTemplate(carrier), emptyRustGenerics, rustTypeFromCarrier);
    assert.equal(plan !== undefined, true);
    const declaration = printRustSourceFile(finalizeRustSourceStyle(createRustSourceFile([
      { kind: "enum", name, visibility: "public", ...plan, attrs: rustDeriveAttributes(["Clone"]) },
    ])));
    const result = rustTypeFromCarrierInContext(physical, context, "return");
    const parameter = rustTypeFromCarrierInContext(physical, context, "parameter");
    assert.equal(result !== undefined && parameter !== undefined, true);
    const project = writeGeneratedProject(`source-union-opaque-${origin}`, [
      { path: "Cargo.toml", text: '[package]\nname = "source_union_opaque"\nversion = "0.0.0"\nedition = "2024"\n' },
      { path: "src/main.rs", text: `
pub mod definitions { ${declaration} }
fn produce() -> ${printRustType(result)} { definitions::${name}::Variant1(async { 41_i32 }) }
fn consume(value: ${printRustType(parameter)}) -> i32 {
    match value {
        definitions::${name}::Variant0(value) => value,
        definitions::${name}::Variant1(future) => {
            match std::pin::pin!(future).as_mut().poll(&mut std::task::Context::from_waker(std::task::Waker::noop())) {
                std::task::Poll::Ready(value) => value,
                std::task::Poll::Pending => panic!("unexpected suspension"),
            }
        }
    }
}
fn main() {
    assert_eq!(consume(produce()), 41);
    let immediate: definitions::${name}<i32, core::future::Ready<i32>> = definitions::${name}::Variant0(43);
    assert_eq!(consume(immediate), 43);
}
` },
    ]);
    runCargo(project, ["generate-lockfile", "--offline"]);
    runCargo(project, ["fmt"]);
    runCargo(project, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
    runCargo(project, ["run", "--locked", "--offline"]);
  }
});
