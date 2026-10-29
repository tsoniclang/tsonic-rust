import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { acmePlatformPackage, analyzeRust, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { rustRawPointerTargetType } from "../../../dist/target-model/types/carriers/callables.js";
import { rustTargetTypeRefEquals } from "../../../dist/target-model/types/equality.js";

for (const [name, declarations, type] of [
  ["direct", "", "MemoryLayout<uint32>"],
  ["alias", "type Layout = MemoryLayout<uint32>;", "Layout"],
  ["nested", "interface Holder { layout: MemoryLayout<uint32>; }", "Holder"],
  ["picked", "", "Pick<RawPointer, keyof RawPointer>"],
]) {
  test(`unrepresented external ${name} types reject without querying foreign structural fields`, () => {
    const { source, result } = compileRust({
      files: {
        "index.ts": `
import type { MemoryLayout, RawPointer, uint32 } from "@tsonic/core/types.js";
${declarations}
export function pass(value: ${type}): ${type} { return value; }
`,
      },
    });
    assert.deepEqual(source.extensionDiagnostics, []);
    assert.deepEqual(result.diagnostics.map(({ code, message }) => ({ code, message })), [
      name === "nested"
        ? {
            code: "RUST_INTERFACE_FIELD_NOT_CLOSED",
            message: "A record field requires its exact selected name, native carrier and project-object storage slot.",
          }
        : {
            code: "RUST_PARAMETER_CARRIER_UNSUPPORTED",
            message: "Parameter type has no closed Rust runtime carrier under the selected source-profile and surface policy.",
          },
    ]);
    if (name !== "nested") {
      const completion = result.diagnostics[0]?.evidence?.filter(entry =>
        entry.startsWith("rust.callable.signature-unresolved="));
      assert.equal(completion?.length, 1, "the precise parameter refusal retains one actual completion reason");
      assert.match(completion[0], /^rust\.callable\.signature-unresolved=The native callable input stage did not complete;/u,
        "a whole-callable stage is evidence, not a replacement parameter-type message");
      assert.equal(completion[0].length <= "rust.callable.signature-unresolved=".length + 512, true,
        "completion evidence is bounded scalar text");
    }
    assert.deepEqual(result.artifacts, []);
  });
}

test("readonly raw pointers retain exact native parameter, return and opaque identity", { timeout: 300_000 }, () => {
  const source = `
import type { MemoryLayout, RawPointer, uint32 } from "@tsonic/core/types.js";
export function pass(value: Readonly<RawPointer>): Readonly<RawPointer> { return value; }
`;
  const { program } = analyzeRust({ files: { "index.ts": source } });
  const ast = program.source.ast;
  const declaration = program.sourceFiles.flatMap(file => ast.statements(file)).find(node =>
    ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "pass");
  assert.equal(declaration !== undefined, true, "the original readonly pointer function exists");
  const abi = program.records.sourceParameterAbi.get(ast.parameters(declaration)[0]);
  const expected = rustRawPointerTargetType();
  assert.equal(abi !== undefined && rustTargetTypeRefEquals(abi.valueCarrier, expected), true,
    "readonly preserves the already represented opaque native parameter");
  assert.equal(rustTargetTypeRefEquals(abi.parameterCarrier, expected), true,
    "the actual parameter ABI is the same owned native RawPointer");
  assert.equal(rustTargetTypeRefEquals(program.records.sourceCallableReturn.get(declaration)?.returnCarrier, expected), true,
    "the original readonly return keeps that exact native carrier");
  assert.equal(program.records.projectType.get(abi.valueCarrier) === undefined, true,
    "no foreign declaration is synthesized as a project field inventory");
  assert.equal(program.structuralShapes.definitionForCarrier(abi.valueCarrier) === undefined, true,
    "the opaque pointer does not acquire an invented structural representation");
  assert.equal(program.structuralShapes.instances.length, 0, "the identity source publishes no structural field inventory");
  const { source: checked, result } = compileRust({ files: { "index.ts": source } });
  assert.equal(checked.extensionDiagnostics.length, 0, "the original mapped readonly input has no extension refusal");
  assert.equal(result.diagnostics.length, 0, "the original readonly identity has no target refusal");
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /pub fn pass\(value: rt::RawPointer\) -> rt::RawPointer\s*\{\s*value\s*\}/u,
    "native identity directly transports the opaque value without a wrapper or copy");
  assert.doesNotMatch(output, /__tsonicRawPointer|__tsonic_raw_pointer|\.clone\(|Box::new|Rc::new|freeze|readonly/iu,
    "there is no foreign-field, heap, copy or runtime readonly machinery");
  const project = writeGeneratedProject("readonly-opaque-pointer-identity", result.artifacts);
  runCargo(project, ["generate-lockfile", "--offline"]);
  runCargo(project, ["fmt", "--check"]);
  appendFileSync(`${project}/src/index.rs`, `
#[test]
fn opaque_pointer_round_trip() {
    let original = rt::RawPointer::from_address(4096, usize::BITS).expect("non-null opaque test address");
    let address = rt::RawPointer::address(Some(&original), usize::BITS);
    let returned = pass(original);
    assert_eq!(rt::RawPointer::address(Some(&returned), usize::BITS), address);
    assert_eq!(address, 4096);
}
`);
  runCargo(project, ["fmt"]);
  runCargo(project, ["fmt", "--check"]);
  runCargo(project, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(project, ["test", "--locked", "--offline", "--", "--test-threads=1"]);
});

test("represented raw pointers retain their opaque carrier through aliases and record fields", () => {
  const { source, result } = compileRust({
    files: {
      "index.ts": `
import type { RawPointer } from "@tsonic/core/types.js";
type Address = RawPointer;
interface Holder { address: Address; }
export function pass(value: RawPointer): RawPointer { return value; }
export function alias(value: Address): Address { return value; }
export function nested(value: Holder): RawPointer { return value.address; }
`,
    },
  });
  assert.deepEqual(source.extensionDiagnostics, []);
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /use tsonic_rust_runtime as rt;/u);
  assert.match(output, /pub fn pass\(value: rt::RawPointer\) -> rt::RawPointer/u);
  assert.match(output, /pub fn alias\(value: rt::RawPointer\) -> rt::RawPointer/u);
  assert.match(output, /pub fn nested\(value: &Holder\) -> rt::RawPointer/u);
  assert.match(output, /pub address: rt::RawPointer,/u);
  assert.doesNotMatch(output, /__tsonicRawPointer|__tsonic_raw_pointer/u);
});

test("project structural fields and exact utility transformations retain their carriers", () => {
  const { result } = compileRust({
    packages: [acmePlatformPackage()],
    files: {
      "index.ts": `
import type { int32 } from "@tsonic/core/types.js";
import type { Store } from "@acme/platform";
interface Box { value: int32; label: string; }
type Selected = Readonly<Pick<Box, "value">>;
export function read(box: Box): int32 { return box.value; }
export function readSelected(box: Selected): int32 { return box.value; }
export function readProvider(value: Pick<Store, "count">): number { return value.count; }
`,
    },
  });
  assert.deepEqual(result.diagnostics, []);
  const output = artifactText(result, "src/index.rs");
  assert.match(output, /pub fn read\(/u);
  assert.match(output, /pub fn readSelected\(/u);
  assert.match(output, /pub fn readProvider\(/u);
  assert.match(output, /-> i32/u);
});
