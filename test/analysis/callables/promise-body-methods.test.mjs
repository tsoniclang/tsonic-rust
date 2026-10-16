import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { analyzeRustCheckedContext } from "../../helpers/rust-session/analysis-context.mjs";

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
