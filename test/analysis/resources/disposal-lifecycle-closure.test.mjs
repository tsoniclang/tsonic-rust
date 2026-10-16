import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, artifactText, compileRust, unitCarrier, acmeTestingPackage } from "../../helpers/rust-session.mjs";
import { createRustProviderPackage } from "../../../dist/public/provider.js";
import { validateRustDisposalLifecycle } from "../../../dist/analysis/resources/disposal-lifecycle.js";
import { resourceDisposalReceiverMode } from "../../../dist/backend/planner/statements/resources.js";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

const resourceSource = `class Resource { constructor() {} [Symbol.dispose](): void {} }
export function run(): void { using resource = new Resource(); }`;

test("disposal lifecycle consumes the one selected fact and rejects missing evidence before publication", () => {
  const { program } = analyzeRust({ surfaces: [], files: { "index.ts": resourceSource } });
  const nodes = [];
  const visit = node => { nodes.push(node); program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  program.sourceFiles.forEach(visit);
  const declaration = nodes.find(node => program.source.ast.is.IsVariableDeclaration(node) &&
    program.source.ast.variableDeclarationKind(node) === "using");
  assert.equal(declaration !== undefined, true, "real checked resource declaration");
  const input = { source: program.source, records: program.records, names: program.names };
  assert.equal(validateRustDisposalLifecycle(input, declaration, { asynchronous: false, fallible: false }) === undefined, true,
    "selected synchronous infallible disposal needs no invented frame");
  const missing = { ...input, records: { ...program.records, resourceManagement: { get: () => undefined } } };
  const diagnostic = validateRustDisposalLifecycle(missing, declaration, { asynchronous: false, fallible: false });
  assert.equal(diagnostic?.code, "RUST_RESOURCE_MANAGEMENT_NOT_PROVEN", "missing selected cleanup rejects before planning");
  assert.equal(diagnostic?.sourceNode === declaration, true, "rejection retains the resource source identity");
  const original = program.records.resourceManagement.get(declaration);
  const fallible = { ...input, records: { ...program.records, resourceManagement: { get: () => ({ ...original,
    disposal: { ...original.disposal, fallible: true, errorBoundary: "source-program" } }) } } };
  assert.equal(validateRustDisposalLifecycle(fallible, declaration, { asynchronous: false, fallible: false })?.code,
    "RUST_RESOURCE_ERROR_FRAME_NOT_PROVEN", "native fallible disposal requires an admitted error owner");
  assert.equal(validateRustDisposalLifecycle(fallible, declaration, { asynchronous: false, fallible: true }) === undefined, true,
    "the existing native error frame admits fallible cleanup");
});

test("selected provider disposal transports all native receiver modes without a duplicate DTO", () => {
  for (const receiverMode of ["value", "ref", "mut-ref"]) {
    const fact = { disposal: { target: { form: "provider", target: { form: "free-call", path: "core::mem::drop", receiverMode } } } };
    assert.equal(resourceDisposalReceiverMode(fact), receiverMode, `${receiverMode}: exact selected mode is authoritative`);
  }
});

test("caught fallible disposal uses its nearest protected error region without changing the callable ABI", () => {
  const source = `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";
let disposed: int32 = 0;
class Resource { constructor() {} [Symbol.dispose](): void { disposed += 1; throw new Error("cleanup"); } }
export function run(): void { try { using resource = new Resource(); } catch {} }
export function main(): void { run(); check(disposed === 1); }
main();
`;
  const packages = [acmeTestingPackage()];
  const { program } = analyzeRust({ surfaces: [], packages, files: { "index.ts": source } });
  const nodes = [];
  const visit = node => { nodes.push(node); program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  program.sourceFiles.forEach(visit);
  const callable = nodes.find(node => program.source.ast.is.IsFunctionDeclaration(node) &&
    program.source.ast.text(program.source.ast.name(node)) === "run");
  const protectedBody = nodes.find(node => program.source.ast.is.IsTryStatement(node));
  const body = program.source.ast.as.AsTryStatement(protectedBody)?.TryBlock;
  assert.equal(program.errorRegions.get(callable)?.kind, "infallible", "caught cleanup does not make the outward callable fallible");
  assert.equal(program.errorRegions.get(body)?.kind, "package", "the actual protected body owns the cleanup error");
  const { result } = compileRust({ surfaces: [], packages,
    target: { id: "rust", options: { outputType: "bin", crateName: "r05_caught_cleanup" } },
    files: { "index.ts": source } });
  assert.equal(result.diagnostics.length, 0,
    result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join("\n").slice(0, 2048));
  validateGeneratedProject("r05-caught-fallible-cleanup", result.artifacts, { run: true });
});

function provider(disposalTarget = { form: "free-call", path: "core::mem::drop", receiverMode: "value" }) {
  const carrier = { kind: "target-named", id: "r05.Resource" };
  return createRustProviderPackage({ id: "r05-resource", displayName: "Native consuming resource", version: "1.0.0",
    modules: [{ moduleSpecifier: "@r05/resource", providerModuleId: "r05.resource", exports: [
      { id: "Resource", name: "Resource", kind: "interface", members: [{ id: "Resource.dispose", kind: "method",
        name: { kind: "well-known-symbol", name: "dispose" }, signatures: [{ id: "Resource.dispose()", parameters: [], returnType: { kind: "void" } }] }] },
      { id: "open", name: "open", kind: "function", signatures: [{ id: "open()", parameters: [],
        returnType: { kind: "provider-ref", moduleSpecifier: "@r05/resource", exportName: "Resource" } }] },
    ] }], types: [{ exportId: "Resource", targetCarrier: carrier }],
    carrierPaths: { "r05.Resource": "String" }, crates: [],
    operations: [
      { exportId: "open", operationKind: "method", target: { form: "call", path: "String::new" }, resultCarrier: carrier },
      { exportId: "Resource", memberId: "Resource.dispose", operationKind: "method",
        target: disposalTarget, resultCarrier: unitCarrier },
    ],
  });
}

test("a provider disposer without a native receiver rejects at its selection owner", () => {
  const { result } = compileRust({ surfaces: [], packages: [provider({ form: "call", path: "fixture::dispose" })],
    files: { "index.ts": 'import { open } from "@r05/resource"; export function run(): void { using active = open(); }' } });
  assert.equal(result.diagnostics.some(diagnostic => diagnostic.message.includes(
    "The selected provider resource disposer has no exact zero-argument Rust receiver operation.")), true,
  "the existing canonical selector rejects the same receiverless disposer");
  assert.equal(result.artifacts.length, 0, "invalid disposal cannot publish target artifacts");
});

for (const nullable of [false, true]) test(`real provider consuming disposal moves ${nullable ? "an optional payload" : "the exact resource"} once`, () => {
  const source = nullable ? `import type { Resource } from "@r05/resource";
    export function run(value: Resource | null): void { using active = value; }`
    : `import { open } from "@r05/resource"; export function run(): void { using active = open(); }`;
  const { result } = compileRust({ surfaces: [], packages: [provider()], files: { "index.ts": source } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join("\n").slice(0, 2048));
  const generated = artifactText(result, "src/index.rs");
  assert.equal([...generated.matchAll(/core::mem::drop\(/gu)].length, 1, "one statically selected consuming cleanup");
  assert.doesNotMatch(generated, /active\.(?:as_ref|as_mut|clone)\(/u, "consuming cleanup neither borrows nor clones the resource");
  if (nullable) assert.match(generated, /if let Some\(resource(?:_\d+)?\) = active/u, "native absence is matched by value");
  validateGeneratedProject(`r05-provider-consuming-${nullable ? "optional" : "direct"}`, result.artifacts);
});

test("multiple declarations retain reverse cleanup and protect each completed acquisition", () => {
  const { result } = compileRust({ surfaces: [], files: { "index.ts": `
class Resource { constructor() {} [Symbol.dispose](): void {} }
export function run(): void { using first = new Resource(), second = new Resource(); }
` } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join("\n").slice(0, 2048));
  const generated = artifactText(result, "src/index.rs");
  const first = generated.indexOf("let first:");
  const second = generated.indexOf("let second:");
  const firstCleanup = generated.indexOf("first.dispose();");
  const secondCleanup = generated.indexOf("second.dispose();");
  assert.equal(first >= 0 && second > first, true, "acquisitions keep authored order");
  assert.equal(secondCleanup > second && firstCleanup > secondCleanup, true, "cleanup executes in reverse acquisition order");
  assert.equal([...generated.matchAll(/let resource_flow(?:_\d+)?/gu)].length, 2, "each acquisition has its own cleanup boundary");
  validateGeneratedProject("r05-multiple-resource-declarations", result.artifacts);
});

for (const [name, target, expected] of [
  ["chain", { form: "receiver-method", name: "as_mut_str", mutatesReceiver: true,
    chain: [{ kind: "method", name: "make_ascii_uppercase" }] }, /\.as_mut_str\(\)\s*\.make_ascii_uppercase\(\)/u],
  ["trailing-input", { form: "receiver-method", name: "truncate", mutatesReceiver: true,
    trailingArguments: [{ kind: "integer", value: 0 }] }, /\.truncate\(0\)/u],
]) test(`selected provider disposal retains the complete native ${name}`, () => {
  const { result } = compileRust({ surfaces: [], packages: [provider(target)], files: { "index.ts":
    'import { open } from "@r05/resource"; export function run(): void { using resource = open(); }' } });
  assert.equal(result.diagnostics.length, 0,
    result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join("\n").slice(0, 2048));
  assert.match(artifactText(result, "src/index.rs"), expected, "every selected native operation component is emitted");
  validateGeneratedProject(`r05-disposal-${name}`, result.artifacts);
});
