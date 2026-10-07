import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { acmeTestingPackage, artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("compiler class exceptions retain payloads, identity, narrowing and finally cleanup", { timeout: 300_000 }, () => {
  const { result } = compileRust({
    surfaces: ["js"], packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin", crateName: "class_exceptions" } },
    files: { "index.ts": `
import { check } from "@acme/testing";
class Failure { readonly value: number; constructor(value: number) { this.value = value; } }
class Other { readonly message: string; constructor(message: string) { this.message = message; } }
let cleaned = 0;
function raise(value: Failure): never { throw value; }
function rethrow(value: unknown): never { throw value; }
export function rethrowObject(value: object): never { throw (value); }
function relay(value: Failure): never {
  try { raise(value); } catch (caught) { rethrow(caught); } finally { cleaned++; }
}
export function main(): void {
  const original = new Failure(7);
  try { relay(original); } catch (caught) {
    if (!(caught instanceof Failure)) throw caught;
    check(caught.value === 7 && caught === original && cleaned === 1);
  }
  try { throw new Other("other"); } catch (caught) {
    check(!(caught instanceof Failure));
    if (!(caught instanceof Other)) throw caught;
    check(caught.message === "other");
  }
}
` },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  validateGeneratedProject("compiler-class-exceptions", result.artifacts, { run: true });
});

for (const surfaces of [[], ["js"]]) {
  const profile = surfaces.length === 0 ? "native" : "js";
test(`throw-only parameter selection does not erase other broad value uses in ${profile}`, { timeout: 300_000 }, () => {
  const ordinary = compileRust({ surfaces, files: { "index.ts": `
export function identical(value: object): boolean { return value === value; }
` } }).result;
  assertNoTargetDiagnostics(ordinary.diagnostics);
  assert.doesNotMatch(artifactText(ordinary, "src/index.rs"), /identical\(value: rt::TsonicError/u);
  for (const [index, source] of [
    "export function rejected(value: object): never { value = {}; throw value; }",
    "export function rejected(value: object): never { const alias = value; throw alias; }",
    "export function rejected(value: unknown): never { return (() => { throw value; })(); }",
  ].entries()) {
    const accepted = compileRust({ surfaces, packages: [acmeTestingPackage()],
      target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
import { check } from "@acme/testing";
${source}
export function main(): void {
  let caughtCount: number = 0;
  try { rejected({}); } catch { caughtCount++; }
  check(caughtCount === 1);
}
` } }).result;
    assert.equal(accepted.diagnostics.length, 0, accepted.diagnostics.slice(0, 5)
      .map(diagnostic => diagnostic.message.slice(0, 256)).join("\n"));
    validateGeneratedProject(`closed-throw-storage-${profile}-${index}`, accepted.artifacts, { run: true });
  }
  const direct = compileRust({ surfaces, packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
import { check } from "@acme/testing";
function rethrow(value: object): never { throw value; }
export function main(): void {
  let caughtCount: number = 0;
  try { rethrow({}); } catch { caughtCount++; }
  check(caughtCount === 1);
}
` } }).result;
  assert.equal(direct.diagnostics.length, 0, direct.diagnostics.slice(0, 5)
    .map(diagnostic => diagnostic.message.slice(0, 256)).join("\n"));
  validateGeneratedProject(`closed-throw-empty-object-${profile}`, direct.artifacts, { run: true });
});

test(`authored object aliases preserve nominal payloads through fields and returns in ${profile}`, { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces, packages: [acmeTestingPackage()],
    target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": `
import { check } from "@acme/testing";
type Payload = object;
class Failure { constructor(public readonly value: number) {} }
class Envelope { constructor(public value: Payload) {} }
function pass(value: Payload): Payload { return value; }
function raise(value: Payload): never { throw value; }
export function main(): void {
  const original = new Failure(9);
  const envelope = new Envelope(pass(original));
  let caughtCount = 0;
  try { raise(envelope.value); } catch (caught) {
    check(caught instanceof Failure);
    if (!(caught instanceof Failure)) throw caught;
    check(caught === original && caught.value === 9);
    caughtCount++;
  }
  check(caughtCount === 1);
}
` } });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 5)
    .map(diagnostic => diagnostic.message.slice(0, 256)).join("\n"));
  validateGeneratedProject(`closed-throw-object-alias-${profile}`, result.artifacts, { run: true });
});
}
