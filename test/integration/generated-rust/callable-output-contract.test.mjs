import assert from "node:assert/strict";
import test from "node:test";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { printRustType } from "../../../dist/print/source/index.js";
import { selectRustNativeTypeCarrier } from "../../../dist/policy/types/model/native-type-selection.js";
import { rustTypeFromSelectedNativeCarrier } from "../../../dist/backend/planner/types/render.js";
import { rustNamedTargetType } from "../../../dist/target-model/types/carriers/native.js";
import { emptyRustTypeDefinitions } from "../../../dist/target-model/types/source-union-definitions.js";

const rejected = [
  {
    name: "superseded positional result parameter",
    source: "fn require(_: &impl CallableImplementation<(), bool>) {}",
    diagnostic: /trait takes 1 generic argument but 2 generic arguments were supplied/u,
  },
  {
    name: "mismatched associated output",
    source: `fn require(_: impl CallableImplementation<(), Output = String>) {}
fn wrong() { require(|()| 7_u64); }`,
    diagnostic: /expected.*String.*(?:found|returns).*u64/su,
  },
  {
    name: "anonymous positional argument inside an opaque trait bound",
    source: "fn require(_: impl CallableImplementation<impl core::fmt::Debug, Output = ()>) {}",
    diagnostic: /nested .impl Trait. is not allowed/u,
  },
  {
    name: "escaping borrowed capture in an anonymous future",
    source: `fn escape() -> impl CallableImplementation<(), Output = impl core::future::Future<Output = usize>> {
    let owned = String::from("local");
    let borrowed = owned.as_str();
    move |()| async move { borrowed.len() }
}`,
    diagnostic: /does not live long enough|cannot return value referencing local variable/u,
  },
];

test("native callable output contracts reject removed syntax, wrong results and escaping captures", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: [], target: { id: "rust", options: { outputType: "lib" } },
    files: { "index.ts": "export function value(): boolean { return true; }" } });
  assertNoTargetDiagnostics(result.diagnostics);
  for (const entry of rejected) {
    const directory = writeGeneratedProject("callable-output-rejection", [...result.artifacts, {
      path: "src/bin/rejected.rs",
      text: `use tsonic_rust_runtime::CallableImplementation;\n${entry.source}\nfn main() {}\n`,
    }]);
    runCargo(directory, ["generate-lockfile", "--offline"]);
    assert.throws(() => runCargo(directory, ["check", "--bin", "rejected", "--locked", "--offline"]),
      entry.diagnostic, entry.name);
  }
});

test("opaque associated outputs print and typecheck in parameters and returns", { timeout: 300_000 }, () => {
  const trait = (path, associatedConstraints = [], genericArguments = []) => ({
    kind: "trait-ref", id: path, path, genericArguments, associatedConstraints });
  const opaque = selected => ({ kind: "impl-trait", id: "fixture:associated-output", bounds: [selected], outlives: [] });
  const equality = (name, type) => ({ kind: "equality", identity: `fixture:${name}`, name, genericArguments: [], type });
  const invocation = output => opaque(trait("CallableImplementation", [output], [
    { kind: "type", type: { kind: "tuple", elements: [] } },
  ]));
  const future = opaque(trait("core::future::Future", [equality("Output", { kind: "source-primitive", name: "native-uint" })]));
  const debug = opaque(trait("core::fmt::Debug"));
  const input = { typeDefinitions: emptyRustTypeDefinitions, typeParameterNames: undefined,
    pathFor: () => undefined, additionalArgumentsFor: () => undefined, programErrorCarrier: () => undefined,
    producerErrorCarrier: () => undefined, nativeErrorJoinCarrier: () => undefined, structuralCarrier: () => undefined };
  const cases = [
    [invocation(equality("Output", future)), "|()| async { 7_usize }"],
    [invocation(equality("Output", rustNamedTargetType("fixture:Option", "Option", [{ kind: "type", type: future }], [], undefined, [], undefined, []))),
      "|()| Some(async { 7_usize })"],
    [invocation(equality("Output", invocation(equality("Output", future)))), "|()| |()| async { 7_usize }"],
    [invocation({ kind: "bounds", identity: "fixture:Output", name: "Output", genericArguments: [],
      traits: [trait("Iterator", [equality("Item", debug)])], outlives: [] }), "|()| [7_usize].into_iter()"],
  ];
  const declarations = cases.map(([type, body], index) => {
    const parameter = selectRustNativeTypeCarrier(type, input, "parameter");
    const returned = selectRustNativeTypeCarrier(type, input, "return");
    assert.equal(parameter.kind, "resolved", `parameter ${index}`);
    assert.equal(returned.kind, "resolved", `return ${index}`);
    assert.equal(selectRustNativeTypeCarrier(type, input, "general").kind, "rejected", `storage ${index}`);
    const printed = printRustType(rustTypeFromSelectedNativeCarrier(returned.carrier));
    return `fn producer_${index}() -> ${printed} { ${body} }
fn consumer_${index}(callback: ${printed}) { drop(callback.invoke(())); }`;
  });
  const { result } = compileRust({ surfaces: [], target: { id: "rust", options: { outputType: "lib" } },
    files: { "index.ts": "export function value(): boolean { return true; }" } });
  assertNoTargetDiagnostics(result.diagnostics);
  const directory = writeGeneratedProject("callable-associated-outputs", [...result.artifacts, {
    path: "src/bin/accepted.rs", text: `#![deny(warnings)]
use tsonic_rust_runtime::CallableImplementation;
${declarations.join("\n")}
fn main() { ${cases.map((_entry, index) => `consumer_${index}(producer_${index}());`).join(" ")} }
`,
  }]);
  runCargo(directory, ["generate-lockfile", "--offline"]);
  runCargo(directory, ["run", "--bin", "accepted", "--locked", "--offline"]);
});
