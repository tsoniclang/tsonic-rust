import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestWorkspace } from "../../../../tsonic/test/scripts/test-workspaces.mjs";
import { createRustCompilerWorkerClient } from "../../../dist/providers/native/acquisition/worker-client.js";
import { projectRustCompilerModule } from "../../../dist/providers/native/projection/declarations.js";
import { createRustProviderPackage } from "../../../dist/public/provider.js";
import { createRustCompilerProviderSession } from "../../../dist/providers/native/session.js";
import { compileRustTarget } from "../../../dist/backend/compile.js";
import { compileRust } from "../../helpers/rust-session.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const nativeModule = "@tsonic/rust/crates/native_alias/index.js";
const sourceModule = "@r04/actual-native-loans";
const nativeSource = `
use std::cell::{Cell, Ref, RefCell};
thread_local! { static ORDER: Cell<u32> = const { Cell::new(0) }; }
fn note(value: u32) { ORDER.set(ORDER.get() * 10 + value); }
pub fn reset() { ORDER.set(0); }
pub fn order() -> u32 { ORDER.get() }
pub struct Owner { value: RefCell<f64> }
pub struct Guard<'owner> { value: Ref<'owner, f64> }
impl Drop for Guard<'_> {
    fn drop(&mut self) { std::hint::black_box(*self.value); note(4); }
}
impl Owner {
    pub fn guard(&self) -> Guard<'_> { note(1); Guard { value: self.value.borrow() } }
    pub fn mutate(&mut self) -> f64 { note(2); *self.value.get_mut() = 7.0; 7.0 }
    pub fn write(&self) -> f64 { note(2); *self.value.borrow_mut() = 7.0; 7.0 }
}
impl Guard<'_> {
    pub fn consume(&self, value: f64) -> f64 { std::hint::black_box(*self.value); consume(value) }
}
pub fn owner() -> Owner { Owner { value: RefCell::new(1.0) } }
pub fn take(owner: Owner) -> f64 { note(2); owner.value.into_inner() }
pub fn consume(value: f64) -> f64 { note(3); value }
`;

function command(root, label, executable, arguments_) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(executable, arguments_, { cwd: root, encoding: "utf8", timeout: 240_000,
    maxBuffer: 8 * 1024 * 1024, env: { ...process.env, CARGO_TERM_COLOR: "never" } });
  const endedAt = new Date().toISOString();
  writeFileSync(join(root, `${label}.log`), `${result.stdout ?? ""}${result.stderr ?? ""}`);
  writeFileSync(join(root, `${label}.json`), JSON.stringify({ executable, arguments: arguments_, startedAt, endedAt,
    status: result.status, signal: result.signal, error: result.error?.message }));
  assert.equal(result.error === undefined && result.signal === null, true, `${label}: the bounded native command completes`);
  return result;
}

function fixture() {
  const root = createTestWorkspace(join(repository, ".temp", "result-loan-admission"), "actual-provider-");
  const native = join(root, "native");
  mkdirSync(join(native, "src"), { recursive: true });
  writeFileSync(join(native, "Cargo.toml"), '[package]\nname="actual-native-loans"\nversion="0.0.0"\nedition="2021"\n[workspace]\n');
  writeFileSync(join(native, "src", "lib.rs"), nativeSource);
  const client = join(root, "client");
  const project = join(client, "Cargo.toml");
  mkdirSync(join(client, "generated", "src"), { recursive: true });
  writeFileSync(join(client, "generated", "src", "lib.rs"), "");
  writeFileSync(project, `[package]\nname="actual-loan-client"\nversion="0.0.0"\nedition="2021"\n[workspace]\n[lib]\npath="generated/src/lib.rs"\n[dependencies]\nnative_alias={package="actual-native-loans",path=${JSON.stringify(native)}}\ntsonic_rust_runtime={path=${JSON.stringify(resolve(repository, "../rust-runtime/crates/tsonic_rust_runtime"))}}\n`);
  const worker = createRustCompilerWorkerClient(join(root, "worker"));
  const snapshot = worker.snapshot(project);
  const dependency = snapshot.dependencies.find(value => value.alias === "native_alias");
  assert.equal(dependency !== undefined, true, "the actual external source belongs to the Cargo snapshot");
  const model = worker.module({ snapshot, dependency, modulePath: [],
    requestedExports: ["Owner", "Guard", "owner", "take", "consume"], foundation: "std" });
  const projected = projectRustCompilerModule(model, { moduleSpecifier: sourceModule, providerModuleId: "actual-native-loan-surface" });
  const nativeSession = createRustCompilerProviderSession({ configuration: { crateName: "actual-loan-client", edition: "2021",
    outputType: "lib", foundation: "std", project: { kind: "user-owned", manifestPath: project } }, cacheRoot: join(root, "session") }, worker);
  const sourceProvider = nativeSession.sourceProviders.find(value => value.ownsModule(nativeModule).kind === "owned");
  assert.equal(sourceProvider !== undefined, true, "the original Cargo source provider owns the exact virtual module");
  const resolution = sourceProvider.resolveModule(nativeModule);
  assert.equal(resolution.kind, "virtual", "the real source provider resolves the actual native module");
  const declarations = sourceProvider.getDeclarationModel(resolution, { context: {}, materialization: { kind: "complete" } });
  assert.equal(Array.isArray(declarations.exports), true, "actual complete materialization populates the sole native query owner");
  const only = (values, label) => {
    assert.equal(values.length, 1, `${label}: exactly one actual acquired declaration is selected`);
    return values[0];
  };
  const exported = name => only(projected.module.exports.filter(value => value.name === name), name);
  const owner = exported("Owner");
  const guard = exported("Guard");
  const consume = exported("consume");
  const guardMember = only(owner.members.filter(value => value.name === "guard"), "Owner.guard");
  const guardSignature = only(guardMember.signatures, "Owner.guard signature");
  const runtimeMember = only(guard.members.filter(value => value.name === "consume"), "Guard.consume");
  const nativeOwner = only(model.exports.filter(value => value.name === "Owner"), "native Owner");
  const nativeGuard = only(nativeOwner.methods.filter(value => value.name === "guard"), "native Owner.guard");
  const guardOperation = only(projected.operations.filter(value => value.exportId === owner.id &&
    value.memberId === guardMember.id && value.signatureId === guardSignature.id), "Owner.guard operation");
  assert.equal(guardOperation.resultLoans === nativeGuard.resultLoans, true,
    "the fixture exposes the actual acquired declaration relation, not manufactured cleanup metadata");
  assert.equal(guardMember.kind, "method", "the property surface adapts the actual native method");
  assert.equal(guardSignature.parameters.length, 0, "the actual native getter has no source arguments");
  assert.equal(guardSignature.typeParameters?.length ?? 0, 0, "the actual native getter introduces no method generics");
  assert.equal(guardSignature.returnType.kind, "provider-ref", "the actual acquired return retains its native type application");
  assert.equal(guardSignature.returnType.moduleSpecifier, sourceModule, "the factory owns every facade self-reference");
  const runtimeId = `${runtimeMember.id}::runtime-surface`;
  const runtimeSignatures = runtimeMember.signatures.map(value => ({ ...value,
    id: `${value.id}::runtime-surface`, name: "runtime" }));
  const runtimeSignatureIds = new Map(runtimeMember.signatures.map((value, index) => [value.id, runtimeSignatures[index].id]));
  const evaluationId = `${guard.id}::evaluation-only-consume`;
  const evaluationSignatures = consume.signatures.map(value => ({ ...value, id: `${value.id}::evaluation-only` }));
  const evaluationSignatureIds = new Map(consume.signatures.map((value, index) => [value.id, evaluationSignatures[index].id]));
  const { signatureId: originalGuardSignatureId, ...guardReadOperation } = guardOperation;
  assert.equal(originalGuardSignatureId, guardSignature.id, "only the actual zero-argument signature becomes a property");
  const operations = projected.operations.map(value => {
    if (value === guardOperation) return { ...guardReadOperation, operationKind: "property" };
    if (value.exportId !== guard.id || value.memberId !== runtimeMember.id) return value;
    const signatureId = runtimeSignatureIds.get(value.signatureId);
    assert.equal(signatureId !== undefined, true, "every native receiver operation retains its exact source signature");
    return { ...value, memberId: runtimeId, signatureId };
  });
  for (const operation of projected.operations.filter(value => value.exportId === consume.id)) {
    const signatureId = evaluationSignatureIds.get(operation.signatureId);
    assert.equal(signatureId !== undefined, true, "every evaluation-only operation retains the actual free-function signature");
    operations.push({ ...operation, exportId: guard.id, memberId: evaluationId, signatureId });
  }
  const module = { ...projected.module, exports: projected.module.exports.map(value => {
    if (value === owner) return { ...value, members: value.members.map(member => member !== guardMember ? member : {
      id: member.id, name: member.name, kind: "property", readonly: true, type: guardSignature.returnType,
    }) };
    if (value !== guard) return value;
    return { ...value, members: [...value.members.map(member => member !== runtimeMember ? member : {
      ...member, id: runtimeId, name: "runtime", signatures: runtimeSignatures,
    }), { id: evaluationId, name: "consume", kind: "method", signatures: evaluationSignatures }] };
  }) };
  assert.equal(module.exports.find(value => value.id === guard.id).typeParameters === guard.typeParameters, true,
    "every actual Guard source generic and lifetime classification survives unchanged");
  const provider = createRustProviderPackage({ id: "actual-native-loan-surface", version: "1", displayName: "Actual native carried-loan controls",
    modules: [module], types: projected.types,
    sourceDependencies: (module.imports ?? []).map(value => ({ moduleSpecifier: value.moduleSpecifier,
      exportedNames: value.namedImports.map(named => named.exportedName) })),
    carrierPaths: Object.fromEntries(projected.carrierPaths), carrierTraits: Object.fromEntries(projected.carrierTraits), crates: [],
    operations });
  let compilation = 0;
  const compile = body => {
    const compiled = compileRust({ surfaces: [], packages: [provider], target: { id: "rust", options: { projectFile: project } },
      compileTarget: request => compileRustTarget({ ...request, nativeRetention: requests => nativeSession.resultRetention(requests) }),
      files: { "index.ts": `import type { Owner as AcquiredOwner, Guard as AcquiredGuard } from ${JSON.stringify(nativeModule)};
        import { owner, take } from ${JSON.stringify(sourceModule)};
        export function observed(): number { ${body} }` } });
    writeFileSync(join(client, `source-control-${compilation++}.json`), JSON.stringify({ source: body,
      diagnostics: compiled.result.diagnostics.map(value => ({ code: value.code, message: value.message })),
      artifactPaths: compiled.result.artifacts.map(value => value.path) }));
    return compiled;
  };
  return { root: client, project, compile, close: () => nativeSession.close() };
}

test("all six carried-Guard controls use real native acquisition and preserve the native refusal boundary", { timeout: 540_000 }, async context => {
  const current = fixture();
  context.after(current.close);
  for (const method of ["consume", "runtime"]) for (const action of ["take", "mutate", "write"]) {
    await context.test(`${method}/${action}`, () => {
    const operand = action === "take" ? "take(stored)" : `stored.${action}()`;
    const result = current.compile(`const stored = owner(); return stored.guard.${method}(${operand});`).result;
    const expected = action === "take" ? "RUST_NATIVE_RESULT_LOAN_MOVE_CONFLICT" : "RUST_NATIVE_RESULT_LOAN_MUTABLE_CONFLICT";
    if (action !== "write") {
      assert.equal(result.diagnostics.length, 1, `${method}/${action}: one precise pre-seal native loan rejection`);
      assert.equal(result.diagnostics[0].code, expected, `${method}/${action}: the exact native constraint owns the diagnostic`);
      assert.equal(result.artifacts.length, 0, `${method}/${action}: no rejected source is planned or emitted`);
    } else {
      assert.equal(result.diagnostics.length, 0, `${method}/write: native shared RefCell semantics remain admitted`);
      const generated = result.artifacts.filter(value => value.path.endsWith(".rs")).map(value => value.text).join("\n");
      assert.equal(generated.includes(".clone()"), false, `${method}/write: the native non-Clone guard is never copied`);
      for (const artifact of result.artifacts) {
        const path = join(current.root, "generated", artifact.path);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, artifact.text);
      }
      const tests = join(current.root, "tests");
      mkdirSync(tests, { recursive: true });
      writeFileSync(join(tests, "guard.rs"), `#[test] fn actual_unwind() {
        native_alias::reset();
        assert!(std::panic::catch_unwind(actual_loan_client::index::observed).is_err());
        assert_eq!(native_alias::order(), 124);
      }`);
      const checked = command(current.root, `${method}-native-unwind`, "cargo", ["test", "--offline", "--manifest-path", current.project,
        "--test", "guard", "--", "--exact", "actual_unwind"]);
      assert.equal(checked.status, 0, `${method}/write: native unwind runs and observes guard cleanup at124`);
    }
    });
  }
  for (const [name, body] of [
    ["ordinary-assignment", "const stored = owner(); const held = stored.guard; const moved = stored; return held.runtime(take(moved));"],
    ["captured-move", "const stored = owner(); const held = stored.guard; const finish = () => take(stored); return held.runtime(finish());"],
  ]) {
    await context.test(name, () => {
    const result = current.compile(body).result;
    assert.equal(result.diagnostics.length, 1, `${name}: one actual source-formation conflict is rejected before sealing`);
    assert.equal(result.diagnostics[0].code, "RUST_NATIVE_RESULT_LOAN_MOVE_CONFLICT",
      `${name}: ordinary source moves use the same actual retained-loan admission as provider inputs`);
    assert.equal(result.artifacts.length, 0, `${name}: no rejected native source is planned or emitted`);
    });
  }
  await context.test("disjoint native owner has no clone or SDK fallback", () => {
  const positive = current.compile("const stored = owner(); const other = owner(); return stored.guard.runtime(take(other));").result;
  assert.equal(positive.diagnostics.length, 0, "a real disjoint owner remains valid");
  const generated = positive.artifacts.filter(value => value.path.endsWith(".rs")).map(value => value.text).join("\n");
  assert.equal(generated.includes(".clone()"), false, "the disjoint non-Clone control needs no clone fallback");
  assert.equal(readFileSync(current.project, "utf8").includes("rustc_private"), false, "ordinary Cargo remains the only acquisition dependency");
  });
});
