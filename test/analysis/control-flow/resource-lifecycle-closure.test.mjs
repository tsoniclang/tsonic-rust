import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { analyzeRust, artifactText, compileRust, unitCarrier, stringCarrier, int32Carrier, fixtureCratesRoot, acmeTestingPackage } from "../../helpers/rust-session.mjs";
import { createRustProviderPackage } from "../../../dist/public/provider.js";
import { validateRustDisposalLifecycle } from "../../../dist/analysis/control-flow/resource-lifecycle.js";
import { resourceDisposalReceiverMode } from "../../../dist/backend/planner/statements/resources.js";
import { finalizeRustProviderOperationAbi } from "../../../dist/analysis/operations/finalized-operation/finalize.js";
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
    disposal: { ...original.disposal, fallible: true,
      target: { ...original.disposal.target, errorBoundary: "source-program" } } }) } } };
  assert.equal(validateRustDisposalLifecycle(fallible, declaration, { asynchronous: false, fallible: false })?.code,
    "RUST_RESOURCE_ERROR_FRAME_NOT_PROVEN", "native fallible disposal requires an admitted error owner");
  assert.equal(validateRustDisposalLifecycle(fallible, declaration, { asynchronous: false, fallible: true }) === undefined, true,
    "the existing native error frame admits fallible cleanup");
});

test("selected provider disposal transports all native receiver modes without a duplicate DTO", () => {
  for (const receiverMode of ["value", "ref", "mut-ref"]) {
    const carrier = { kind: "target-named", id: "r05.Resource" };
    const abi = finalizeRustProviderOperationAbi({ operationKind: "method",
      form: { form: "free-call", path: "core::mem::drop", receiverMode },
      sourceReceiver: { kind: "runtime", carrier }, sourceArgumentCarriers: [], resultCarrier: unitCarrier,
      isAsync: false, isFallible: false });
    assert.equal(abi !== undefined, true, `${receiverMode}: the canonical owner completes the selected disposal ABI`);
    const fact = { disposal: { target: { form: "provider", abi, receiverMode } } };
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
  const context = program.physicalEmissionContexts.contextForOwner(callable, "native-body");
  assert.equal(context?.error.kind === "region" && context.error.region.kind === "infallible", true,
    "caught cleanup does not make the outward callable fallible");
  const protectedEffects = program.records.errorEffects.get(body);
  assert.equal(protectedEffects?.localErrors === true && protectedEffects.nativeErrors.length === 0, true,
    "the actual protected body owns the cleanup error");
  const { result } = compileRust({ surfaces: [], packages,
    target: { id: "rust", options: { outputType: "bin", crateName: "r05_caught_cleanup" } },
    files: { "index.ts": source } });
  assert.equal(result.diagnostics.length, 0,
    result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join("\n").slice(0, 2048));
  validateGeneratedProject("r05-caught-fallible-cleanup", result.artifacts, { run: true });
});

function provider(disposalTarget = { form: "free-call", path: "core::mem::drop", receiverMode: "value" }, options = {}) {
  const carrier = options.carrier ?? { kind: "target-named", id: "r05.Resource" };
  const numeric = carrier.kind === "source-primitive";
  const native = options.nativeFixture === true;
  const openPath = !native ? "String::new" : numeric ? "r05_resources::open_number"
    : carrier.id === stringCarrier.id ? "r05_resources::open_resource" : "r05_resources::open_custom_resource";
  return createRustProviderPackage({ id: "r05-resource", displayName: "Native consuming resource", version: "1.0.0",
    modules: [{ moduleSpecifier: "@r05/resource", providerModuleId: "r05.resource", exports: [
      { id: "Resource", name: "Resource", kind: "interface", members: [{ id: "Resource.dispose", kind: "method",
        name: { kind: "well-known-symbol", name: "dispose" }, signatures: [{ id: "Resource.dispose()", parameters: [], returnType: { kind: "void" } }] }] },
      { id: "open", name: "open", kind: "function", signatures: [{ id: "open()", parameters: numeric
        ? [{ name: "value", type: { kind: "source-primitive", name: "int32" } }] : [],
        returnType: { kind: "provider-ref", moduleSpecifier: "@r05/resource", exportName: "Resource" } }] },
      ...(native ? [{ id: "count", name: "count", kind: "function", signatures: [{ id: "count()", parameters: [],
        returnType: { kind: "source-primitive", name: "int32" } }] }] : []),
    ] }], types: [{ exportId: "Resource", targetCarrier: carrier }],
    carrierPaths: carrier.id === "r05.Resource" ? { "r05.Resource": native ? "r05_resources::Resource" : "String" } : {},
    crates: native ? [{ crateName: "r05_resources", cargoPath: resolve(fixtureCratesRoot, "r05_resources") }] : [],
    operations: [
      { exportId: "open", operationKind: "method", target: { form: "call", path: openPath },
        parameterCarriers: numeric ? [int32Carrier] : [], resultCarrier: carrier },
      ...(native ? [{ exportId: "count", operationKind: "method", target: { form: "call", path: "r05_resources::global_count" },
        resultCarrier: int32Carrier }] : []),
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

test("multiple for-initializer resources surround the whole loop and dispose in reverse order", () => {
  const source = `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";
let order: int32 = 0;
class Resource {
  private id: int32;
  constructor(id: int32) { this.id = id; }
  [Symbol.dispose](): void { order = order * 10 + this.id; }
}
export function run(limit: int32): void {
  let iteration: int32 = 0;
  for (using first = new Resource(1), second = new Resource(2); iteration < limit;) { iteration++; }
}
export function main(): void { run(2); check(order === 21); }
main();
`;
  const { result } = compileRust({ surfaces: [], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "r05_multi_for_resources" } },
    files: { "index.ts": source } });
  assert.equal(result.diagnostics.length, 0,
    result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join("\n").slice(0, 2048));
  validateGeneratedProject("r05-multiple-for-initializer-resources", result.artifacts, { run: true });
});

for (const [name, target, expected] of [
  ["chain", { form: "receiver-method", name: "as_mut_str", mutatesReceiver: true,
    chain: [{ kind: "method", name: "make_ascii_uppercase" }] }, /\.as_mut_str\(\)\s*\.make_ascii_uppercase\(\)/u],
  ["trailing-input", { form: "receiver-method", name: "truncate", mutatesReceiver: true,
    trailingArguments: [{ kind: "integer", value: 0 }] }, /\.truncate\(0\)/u],
]) test(`selected provider disposal retains the complete native ${name}`, () => {
  const native = name === "trailing-input";
  const source = native ? `import { open, count } from "@r05/resource";
    import { check } from "@acme/testing";
    export function run(): void { using resource = open(); }
    export function main(): void { run(); check(count() === 1); }
    main();` : 'import { open } from "@r05/resource"; export function run(): void { using resource = open(); }';
  const { result } = compileRust({ surfaces: [], packages: [provider(target, { nativeFixture: native }), acmeTestingPackage()],
    ...(native ? { target: { id: "rust", options: { outputType: "bin", crateName: "r05_native_trailing_input" } } } : {}),
    files: { "index.ts": source } });
  assert.equal(result.diagnostics.length, 0,
    result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join("\n").slice(0, 2048));
  assert.match(artifactText(result, "src/index.rs"), expected, "every selected native operation component is emitted");
  validateGeneratedProject(`r05-disposal-${name}`, result.artifacts, { run: native });
});

test("provider disposal retains source borrowing before its converted native argument mode", () => {
  const selected = provider({ form: "free-call", path: "r05_resources::dispose_borrowed", receiverMode: "value",
    receiverConversion: { kind: "semantic-conversion", id: "borrowed-str-from-owned-string" } },
  { carrier: stringCarrier, nativeFixture: true });
  const source = `import { open, count } from "@r05/resource";
    import type { Resource } from "@r05/resource";
    import { check } from "@acme/testing";
    function run(value: Resource | null): void { using active = value; }
    export function main(): void { run(open()); run(null); check(count() === 1); }
    main();`;
  const options = { surfaces: [], packages: [selected, acmeTestingPackage()], files: { "index.ts": source },
    target: { id: "rust", options: { outputType: "bin", crateName: "r05_native_disposal_borrow" } } };
  const { program } = analyzeRust(options);
  const declarations = [];
  const visit = node => { if (program.source.ast.is.IsVariableDeclaration(node) &&
    program.source.ast.variableDeclarationKind(node) === "using") declarations.push(node);
  program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  program.sourceFiles.forEach(visit);
  assert.equal(declarations.length, 1, "the one checked optional resource is retained");
  const fact = program.records.resourceManagement.get(declarations[0]);
  assert.equal(fact.disposal.target.receiverMode, "ref", "the source String is borrowed before conversion");
  assert.equal(fact.disposal.target.abi.targetArguments[0].mode, "value", "the converted borrowed str is passed by value");
  const { result } = compileRust(options);
  assert.equal(result.diagnostics.length, 0,
    result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join("\n").slice(0, 2048));
  assert.doesNotMatch(artifactText(result, "src/index.rs"), /\.clone\(/u, "conversion retains the original source without copying");
  validateGeneratedProject("r05-native-disposal-borrow", result.artifacts, { run: true });
});

test("fallible disposer input conversion participates before the seal without inventing a call error channel", () => {
  const selected = provider({ form: "free-call", path: "r05_resources::dispose_number", receiverMode: "value",
    receiverConversion: { kind: "semantic-conversion", id: "checked-i32-to-usize" } },
  { carrier: int32Carrier, nativeFixture: true });
  const source = `import { open, count } from "@r05/resource";
    import { check } from "@acme/testing";
    export function main(): void {
      try { using active = open(-1); } catch {}
      check(count() === 0);
      { using active = open(3); }
      check(count() === 3);
    }
    main();`;
  const options = { surfaces: [], packages: [selected, acmeTestingPackage()], files: { "index.ts": source },
    target: { id: "rust", options: { outputType: "bin", crateName: "r05_native_disposal_conversion" } } };
  const { program } = analyzeRust(options);
  const declarations = [];
  const visit = node => { if (program.source.ast.is.IsVariableDeclaration(node) &&
    program.source.ast.variableDeclarationKind(node) === "using") declarations.push(node);
  program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  program.sourceFiles.forEach(visit);
  assert.equal(declarations.length, 2, "both checked conversions have their actual resource declaration");
  for (const declaration of declarations) {
    const fact = program.records.resourceManagement.get(declaration);
    assert.equal(fact.disposal.fallible, true, "the conversion participates in the pre-seal error summary");
    assert.equal(fact.disposal.target.abi.effects.errorBoundary, "none", "the infallible native invocation has no fabricated error channel");
    assert.equal(fact.disposal.target.abi.effects.errorCarrier === undefined, true, "no guessed native error carrier is added");
    assert.equal(Object.hasOwn(fact.disposal, "errorBoundary"), false, "the aggregate cannot duplicate the target channel");
    assert.equal(Object.hasOwn(fact.disposal, "errorCarrier"), false, "the aggregate cannot duplicate the target carrier");
    assert.equal(fact.disposal.target.abi.effects.invocation, "infallible", "the original native call channel is preserved");
    assert.equal(fact.disposal.target.abi.targetArguments[0].conversion.fallible, true,
      "the actual canonical checked conversion owns its own failure");
  }
  const { result } = compileRust(options);
  assert.equal(result.diagnostics.length, 0,
    result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join("\n").slice(0, 2048));
  validateGeneratedProject("r05-native-fallible-disposal-input", result.artifacts, { run: true });
});

test("native cleanup observes failed acquisition, continue, break and return in exact source order", () => {
  const source = `
import type { int32 } from "@tsonic/core/types.js";
import { check } from "@acme/testing";
let attempts: int32 = 0;
let disposed: int32 = 0;
let body: int32 = 0;
class Resource {
  private id: int32;
  constructor(id: int32) { this.id = id; }
  [Symbol.dispose](): void { disposed = disposed * 10 + this.id; }
}
function acquire(id: int32): Resource {
  attempts = attempts * 10 + id;
  if (id === 2) throw new Error("acquisition");
  return new Resource(id);
}
function returnValue(): int32 { using active = new Resource(5); return 7; }
export function main(): void {
  try { using first = acquire(1), second = acquire(2); body += 1; } catch {}
  check(attempts === 12);
  check(disposed === 1);
  check(body === 0);
  for (let index: int32 = 0; index < 3; index++) {
    using active = new Resource(index + 3);
    if (index === 0) continue;
    break;
  }
  check(disposed === 134);
  check(returnValue() === 7);
  check(disposed === 1345);
}
main();
`;
  const { result } = compileRust({ surfaces: [], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "r05_cleanup_completion_order" } },
    files: { "index.ts": source } });
  assert.equal(result.diagnostics.length, 0,
    result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join("\n").slice(0, 2048));
  validateGeneratedProject("r05-native-cleanup-completion-order", result.artifacts, { run: true });
});
