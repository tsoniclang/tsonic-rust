import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestWorkspace } from "../../../../../tsonic/test/scripts/test-workspaces.mjs";
import { createRustCompilerWorkerClient } from "../../../../dist/providers/native/acquisition/worker-client.js";
import { projectRustCompilerModule } from "../../../../dist/providers/native/projection/declarations.js";
import { projectRustNativeResultRetentionQuestion } from "../../../../dist/providers/native/projection/result-loans.js";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const nativeSource = `
use std::cell::{Ref, RefCell};
use std::marker::PhantomData;
pub struct Owner { value: RefCell<i32> }
pub struct Guard<'owner> { value: Ref<'owner, i32> }
impl Drop for Guard<'_> { fn drop(&mut self) { std::hint::black_box(*self.value); } }
pub struct Plain<'owner> { pub owner: &'owner Owner }
pub struct Contra<'owner> { marker: PhantomData<fn(&'owner Owner)> }
pub fn observing<'owner>(owner: &'owner Owner) -> Guard<'owner> { Guard { value: owner.value.borrow() } }
pub fn plain<'owner>(owner: &'owner Owner) -> Plain<'owner> { Plain { owner } }
pub fn contra<'owner>(_: &'owner Owner) -> Contra<'owner> { Contra { marker: PhantomData } }
pub fn borrowed_vector<'owner>(owner: &'owner Owner) -> Vec<&'owner Owner> { vec![owner] }
pub fn elided(owner: &Owner) -> Guard<'_> { Guard { value: owner.value.borrow() } }
`;

test("normal Cargo facts distinguish actual use, observing cleanup, variance and Vec cleanup", { timeout: 300_000 }, () => {
  const root = createTestWorkspace(join(repository, ".temp", "compiler-provider-tests"), "native-retention-");
  const native = join(root, "native");
  mkdirSync(join(native, "src"), { recursive: true });
  writeFileSync(join(native, "Cargo.toml"), '[package]\nname="native-retention-fixture"\nversion="0.0.0"\nedition="2021"\n[workspace]\n');
  writeFileSync(join(native, "src", "lib.rs"), nativeSource);
  const project = join(root, "project");
  mkdirSync(join(project, "src"), { recursive: true });
  writeFileSync(join(project, "Cargo.toml"), `[package]\nname="retention-client"\nversion="0.0.0"\nedition="2021"\n[workspace]\n[dependencies]\nnative_alias={package="native-retention-fixture",path=${JSON.stringify(native)}}\n`);
  writeFileSync(join(project, "src", "lib.rs"), "");
  const worker = createRustCompilerWorkerClient(join(root, "worker"));
  const snapshot = worker.snapshot(join(project, "Cargo.toml"));
  const dependency = snapshot.dependencies.find(entry => entry.alias === "native_alias");
  assert.equal(dependency !== undefined, true, "the actual native alias belongs to the frozen Cargo snapshot");
  const names = ["observing", "plain", "contra", "borrowed_vector", "elided"];
  const module = worker.module({ snapshot, dependency, modulePath: [], requestedExports: names, foundation: "std" });
  const projected = projectRustCompilerModule(module, { moduleSpecifier: "@tsonic/rust/crates/native_alias/index.js",
    providerModuleId: "actual-retention-fixture" });
  const questions = names.map(name => {
    const exported = module.exports.find(entry => entry.name === name);
    assert.equal(exported?.kind, "function", `${name}: the original compiler declaration is normalized`);
    const fn = exported.function;
    const input = fn.parameters[0].type;
    assert.equal(input.kind, "reference", `${name}: the actual declared native input is a reference`);
    assert.equal(fn.resultLoans.kind, "complete", `${name}: the sole normalized owner establishes the declared relation`);
    const origin = fn.resultLoans.loans[0].origins[0];
    const lifetime = fn.resultLoanTypes.lifetimes.find(value => value.key === origin.lifetime)?.lifetime;
    assert.equal(lifetime !== undefined, true, `${name}: the canonical selector retains its typed native binder`);
    return projectRustNativeResultRetentionQuestion({ id: name, declarationIdentity: fn.identity.itemId,
      resultTypeIdentity: fn.resultLoans.valueTypeIdentity, phase: "value", origin,
      application: { types: new Map(), lifetimes: new Map(), consts: new Map() }, arguments: [] },
    projected.nativeDeclarations.get(fn.identity.itemId), projected.nativeApplications);
  });
  const batch = worker.resultRetention({ snapshot, questions, foundation: "std" });
  assert.equal(batch.facts.length, 5, "every original native question has one fact");
  const expected = new Map([["observing", ["retained", "retained"]], ["plain", ["retained", "released"]],
    ["contra", ["released", "released"]], ["borrowed_vector", ["retained", "released"]], ["elided", ["retained", "retained"]]]);
  for (const fact of batch.facts) {
    assert.equal(fact.kind, "resolved", `${fact.questionId}: ${fact.kind === "unavailable" ? fact.reasons.join("; ") : "actual native fact"}`);
    assert.equal(fact.use, expected.get(fact.questionId)[0], `${fact.questionId}: actual native use liveness`);
    assert.equal(fact.cleanup, expected.get(fact.questionId)[1], `${fact.questionId}: actual native cleanup liveness`);
  }
  assert.equal(batch.evidence.length, 2, "one challenge and one successful complete-permitted certification");
  assert.equal(batch.evidence[0].exitCode, 101, "the challenge really contains native borrow errors");
  assert.equal(batch.evidence[1].exitCode, 0, "absence on a failed batch is never a permissive fact");
  assert.equal(batch.evidence[0].diagnostics.some(diagnostic => diagnostic.code === "E0597"), true, "native destructor observation is measured");
  assert.equal(batch.evidence[0].diagnostics.some(diagnostic => diagnostic.code === "E0502"), true, "native use conflicts are measured");
  const cached = worker.resultRetention({ snapshot, questions, foundation: "std" });
  assert.equal(JSON.stringify(cached), JSON.stringify(batch), "the same exact snapshot/compiler/application batch is reusable");
  const nativeBefore = readFileSync(join(native, "src", "lib.rs"), "utf8");
  writeFileSync(join(native, "src", "lib.rs"), `${nativeBefore}\npub fn source_changed() {}\n`);
  assert.throws(() => worker.resultRetention({ snapshot, questions, foundation: "std" }), /changed after the compiler-provider snapshot/u,
    "a stale native source cannot reuse a formerly certified retention fact");
});
