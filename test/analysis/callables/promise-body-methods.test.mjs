import assert from "node:assert/strict";
import test from "node:test";
import { compileRust, rustSourceText } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { analyzeRustCheckedContext } from "../../helpers/rust-session-analysis-context.mjs";

const header = `import type { int32 } from "@tsonic/core/types.js";`;

function analyze(text) {
  let context;
  const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin" } },
    files: { "index.ts": `${header}${text}` }, compileTarget(request) {
      context = analyzeRustCheckedContext(request);
      return { kind: "resolved", value: { artifacts: [] }, diagnostics: context.diagnostics };
    } });
  assert.deepEqual(result.diagnostics.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`), []);
  const named = name => context.sourceStorage.nodes.find(node =>
    (context.ast.is.IsFunctionDeclaration(node) || context.ast.is.IsMethodDeclaration(node)) &&
    context.ast.text(context.ast.name(node)) === name);
  const call = context.sourceStorage.nodes.find(node => {
    if (!context.ast.is.IsCallExpression(node)) return false;
    const semantics = context.semanticsFor(node);
    const selected = semantics.operations.call(node);
    const declaration = selected === undefined ? undefined : semantics.declarations.signatureDeclaration(selected.selectedSignature);
    const implementation = declaration === undefined ? undefined : context.source.navigation.callableImplementation(declaration);
    return implementation?.kind === "resolved" && implementation.implementation.declaration === named("wait");
  });
  return { context, named, call };
}

test("an immutable method remains a native edge without a property slot", () => {
  const current = analyze(`
class Work { async wait(): Promise<int32> { return 1; } }
export async function main(): Promise<void> {
  const work = new Work();
  if (await work.wait() !== 1) throw new Error("value");
}
await main();`);
  assert.equal(current.call !== undefined, true);
  assert.equal(current.context.records.targetOperation.get(current.call).asyncBody?.declaration === current.named("wait"), true);
  assert.equal(current.context.projectMethodProperties.usageFor(current.named("wait")) === undefined, true);
});

for (const suspending of [false, true]) for (const alias of [false, true]) {
  test(`a ${suspending ? "suspending" : "settled"} replacement through ${alias ? "an alias" : "its receiver"} prevents native-body bypass`, () => {
    const current = analyze(`
class Work { async wait(): Promise<int32> { return 1; } }
export async function main(): Promise<void> {
  const work = new Work();
  ${alias ? "const alias = work;" : ""}
  ${alias ? "alias" : "work"}.wait = async (): Promise<int32> => { ${suspending ? "await Promise.resolve(0);" : ""} return 2; };
  if (await work.wait() !== 2) throw new Error("replacement");
}
await main();`);
    assert.equal(current.context.projectMethodProperties.usageFor(current.named("wait"))?.writable, true);
    assert.equal(current.call !== undefined, true);
    assert.equal(current.context.records.targetOperation.get(current.call).asyncBody === undefined, true);
    assert.equal(current.context.records.asyncFunction.get(current.named("main"))?.lowering.kind, "factory");
  });
}

test("an implicit interface with an async member cannot query an uninitialized property plan", () => {
  const current = analyze(`
interface Contract { wait(): Promise<int32>; }
class Work { async wait(): Promise<int32> { return 1; } }
export async function main(): Promise<void> {
  const work: Contract = new Work();
  if (await work.wait() !== 1) throw new Error("interface");
}
await main();`);
  assert.equal(current.context.records.asyncFunction.get(current.named("wait"))?.kind, "js-promise");
  assert.equal(current.context.projectMethodProperties.usages.length, 0);
});

test("polymorphic Promise methods retain virtual and exact bodies without unreachable native helpers", { timeout: 300_000 }, () => {
  const text = `${header}
abstract class Base {
  calls: int32 = 0;
  async value(): Promise<int32> { this.calls += 1; return 1; }
}
class Derived extends Base implements Value {
  override async value(): Promise<int32> { this.calls += 1; return 2; }
  async exact(): Promise<int32> { return await super.value(); }
}
class Further extends Derived {}
interface Value { value(): Promise<int32>; }
function equal(actual: int32, expected: int32): boolean { return actual === expected; }
export async function main(): Promise<void> {
  const concrete = new Derived();
  const virtual: Base = concrete;
  if (await virtual.value() !== 2) throw new Error("virtual value");
  if (await concrete.exact() !== 1) throw new Error("exact base value");
  if (!equal(concrete.calls, 2)) throw new Error("one receiver, two actual invocations");
  const inherited = new Further();
  if (await inherited.value() !== 2) throw new Error("inherited virtual value");
  if (await inherited.exact() !== 1) throw new Error("inherited exact base value");
  if (!equal(inherited.calls, 2)) throw new Error("inherited receiver identity");
  const contract: Value = concrete;
  if (await contract.value() !== 2) throw new Error("interface dispatch value");
  if (!equal(concrete.calls, 3)) throw new Error("interface receiver identity");
}
await main();`;
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "polymorphic_promise_bodies" } },
    files: { "index.ts": text },
  });
  assert.equal(result.diagnostics.length, 0,
    `polymorphic object bodies: ${JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message })))}`);
  const rust = rustSourceText(result);
  assert.equal(rust.includes("value_native") || rust.includes("exact_native"), false,
    "dispatch-only methods have neither unreachable native definitions nor native calls");
  assert.equal(validateGeneratedProject("polymorphic-promise-bodies", result.artifacts, { run: true }).status, 0,
    "virtual and super invocations execute their exact original bodies");
});

test("generic classes allocate same-named static Promise bodies in their actual module namespace", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "bin", crateName: "static_promise_names" } },
    files: { "index.ts": `${header}
class Left<Unused> { static async wait(): Promise<int32> { return 1; } }
class Right<Unused> { static async wait(): Promise<int32> { return 2; } }
function left_wait_native(): int32 { return 3; }
export async function main(): Promise<void> {
  if (await Left.wait() + await Right.wait() + left_wait_native() !== 6) throw new Error("static bodies");
}
await main();` },
  });
  assert.equal(result.diagnostics.length, 0,
    `static native bodies: ${JSON.stringify(result.diagnostics.map(({ code, message }) => ({ code, message })))}`);
  const rust = rustSourceText(result);
  assert.equal(rust.includes("fn left_wait_native_2("), true, "the real left static slot avoids the authored module function");
  assert.equal(rust.includes("fn right_wait_native("), true, "the real right static slot has its independent native body");
  assert.equal(validateGeneratedProject("static-promise-names", result.artifacts, { run: true }).status, 0,
    "both hoisted static native bodies and the authored collision control execute exactly");
});
