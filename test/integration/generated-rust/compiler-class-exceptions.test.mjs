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
  assert.deepEqual(result.diagnostics, []);
  validateGeneratedProject("compiler-class-exceptions", result.artifacts, { run: true });
});

test("throw-only parameter selection does not erase other broad value uses", () => {
  const ordinary = compileRust({ surfaces: ["js"], files: { "index.ts": `
export function identical(value: object): boolean { return value === value; }
` } }).result;
  assert.deepEqual(ordinary.diagnostics, []);
  assert.doesNotMatch(artifactText(ordinary, "src/index.rs"), /identical\(value: rt::TsonicError/u);
  for (const source of [
    "export function rejected(value: object): never { value = {}; throw value; }",
    "export function rejected(value: object): never { const alias = value; throw alias; }",
    "export function rejected(value: unknown): never { return (() => { throw value; })(); }",
    "function rethrow(value: object): never { throw value; } export function rejected(): never { return rethrow({}); }",
  ]) {
    const rejected = compileRust({ surfaces: ["js"], files: { "index.ts": source } }).result;
    assert.equal(rejected.artifacts.length, 0);
    assert.ok(rejected.diagnostics.some(diagnostic => diagnostic.category === "error"));
  }
});
