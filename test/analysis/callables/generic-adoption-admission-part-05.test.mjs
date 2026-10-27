import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { assertRejectedAsyncSource } from "../../helpers/native-promise-lifetimes.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { sourceNodeIdentity } from "@tsonic/target-api/source";
import {
  diagnosticSummary,
  code,
  identity,
  nativeEntryCases,
  nativeEntryInverses,
  nativeOpaquePayloadCases,
  nativeConstructorCases,
  nativeConstructorInverses,
  sourcePosition,
  sourceSpan,
  rejected,
  cases,
} from "./generic-adoption-admission-fixtures.mjs";

for (const recursive of ([false, true]).slice(1, 2)) {
const helper = recursive ? `function deliver<Value>(callback: (value: Value) => void, value: Value, count: number): void {
    if (count > 0) bounce(callback, value, count - 1); else callback(value);
  } function bounce<Value>(callback: (value: Value) => void, value: Value, count: number): void {
    if (count > 0) deliver(callback, value, count - 1); else callback(value);
  }` : "function deliver<Value>(callback: (value: Value) => void, value: Value, count: number): void { callback(value); }";

test(`Rust retains ${recursive ? "recursive" : "direct"} resolver/value correlation in native execution`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin",
      crateName: `resolver_${recursive ? "recursive" : "direct"}_rows` } }, files: { "index.ts": `export {};
      ${helper}
      function wrap<Value>(value: Value): Promise<number> { return new Promise<number>(resolve => {
        deliver(resolve, 7, 2); deliver(item => { void item; }, value, 2);
      }); }
      console.log(await wrap(Promise.resolve(11)));` } });
    assert.equal(result.diagnostics.length, 0,
      JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message }))));
    const executed = validateGeneratedProject(`resolver-${recursive ? "recursive" : "direct"}-rows`, result.artifacts, { run: true });
    assert.equal(executed.stdout.trim(), "7", "the Promise-valued actual reaches only the ordinary callback");
  });

test(`Rust refuses the matching ${recursive ? "recursive" : "direct"} adopting resolver row`, () => {
    const compilation = compileRust({ surfaces: ["js"], files: { "index.ts": `${helper}
      function wrap<Value>(value: Value): Promise<Value> { return new Promise<Value>(resolve => deliver(resolve, value, 2)); }
      export function reject(promised: Promise<number>): void { void wrap(promised); }` } });
    rejected(compilation, "wrap(promised)", "KindCallExpression", "wrap");
  });
}

test("Rust keeps opaque resolver provenance explicitly unresolved for a Promise-valued actual", () => {
  const compilation = compileRust({ surfaces: ["js"], files: { "index.ts": `declare function opaque<Value>(value: Value): Value;
    function wrap<Value>(value: Value) { return new Promise<Value>(resolve => { const done = opaque(resolve); done(value); }); }
    export function reject(promised: Promise<number>): void { void wrap(promised); }` } });
  assertRejectedAsyncSource(compilation, [{ code: "RUST_ASYNC_RESULT_USE_NOT_PROVEN", kind: "KindCallExpression", text: "done(value)" }]);
});

test("Rust preserves an ordinary native actual despite an open symbolic resolver alias", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "ordinary_resolver_alias" } }, files: { "index.ts": `
      type Alias<Value> = (resolve: (value: Value) => void) => (value: Value) => void;
      function wrap<Value>(value: Value, alias: Alias<Value>): Promise<Value> {
        return new Promise<Value>(resolve => { const done = alias(resolve); done(value); });
      }
      if (await wrap<number>(7, resolve => resolve) !== 7) throw new Error("ordinary resolver alias");` } });
  assert.equal(result.diagnostics.length, 0,
    JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message }))));
  assert.equal(validateGeneratedProject("ordinary-resolver-alias", result.artifacts, { run: true }).status, 0,
    "a proven non-adopting ordinary payload retains its complete native callback and value behavior");
});

for (const [name, body] of [
  ["unused-named", "async function unused() { return value; } return 1;"],
  ["discarded-arrow", "async () => value; return 1;"],
  ["type-only", "async function unused() { return value; } type OnlyType = typeof unused; return 1;"],
  ["erased-forwarding", "function unused() { return identity(value); } return 1;"],
]) {
  test(`Rust erases ${name} without refusing or executing its generic async body`, { timeout: 300_000 }, () => {
    const { result, source } = compileRust({ surfaces: ["js"],
      target: { id: "rust", options: { outputType: "bin", crateName: "generic_erased_adoption" } },
      files: { "index.ts": `${identity}\nfunction consume<Value>(value: Value): number { ${body} }
        console.log(consume(Promise.resolve(1)));` } });
    assert.equal(result.diagnostics.length, 0, diagnosticSummary(result, source));
    const executed = validateGeneratedProject(`generic-erased-${name}`, result.artifacts, { run: true });
    assert.equal(executed.stdout.trim(), "1", "only the retained consume body runs");
  });
}

for (const declaration of [
  "interface Contract { identity<Value>(value: Value): Promise<Value>; }",
  "abstract class Contract { abstract identity<Value>(value: Value): Promise<Value>; }",
]) {
  test(`Rust generic adoption keeps its unknown ${declaration.startsWith("interface") ? "interface" : "abstract"} signature`, () => {
    const compilation = compileRust({ surfaces: ["js"], files: { "index.ts": `${declaration}
      export function reject(contract: Contract, promised: Promise<number>): void { void contract.identity(promised); }` } });
    rejected(compilation, "contract.identity(promised)", "KindCallExpression", "identity");
  });
}

test("Rust unknown source generic bodies fail closed at their actual instantiation", () => {
  const compilation = compileRust({ surfaces: ["js"], files: { "index.ts": `
    export function reject(callback: <Value>(value: Value) => Promise<Value>, promised: Promise<number>): void {
      void callback(promised);
    }
  ` } });
  rejected(compilation, "callback(promised)", "KindCallExpression");
});

test("Rust ordinary library generics and constrained native values do not acquire an adoption refusal", () => {
  const { result } = compileRust({ surfaces: ["js"], files: { "index.ts": `
    async function primitive<Value extends number>(value: Value): Promise<Value> { return value; }
    export async function run(): Promise<number> { return await primitive(7); }
  ` } });
  assert.equal(result.diagnostics.length, 0,
    JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message }))));
  assert.equal(result.program !== undefined, true, "a native primitive constraint is a checked non-adopting contract");
  for (const source of [
    "export async function run(): Promise<number[]> { return await Promise.all([1, 2].map(async value => value)); }",
    "export function run(): Promise<number>[] { return [1, 2].map(async value => value); }",
    "async function worker(): Promise<number> { return 7; } export async function run(): Promise<number[]> { return await Promise.all([worker(), worker()]); }",
  ]) {
    const compiled = compileRust({ surfaces: ["js"], files: { "index.ts": source } });
    assert.equal(compiled.result.diagnostics.filter(issue => issue.code === code).length, 0,
      "ambient library binders keep their existing lowering outcome, not the source-generic boundary");
  }
});
