import assert from "node:assert/strict";
import test from "node:test";
import { createCompilerSessionFromFiles } from "@tsonic/tsts";
import { createTargetSourceProgram } from "@tsonic/target-api/source";
import { createRustNativeCallableDispatchPlan } from "../../../dist/analysis/callables/native-dispatch.js";

test("native dispatch preserves open and invoked protocols but omits closed forward-only slots", () => {
  const closed = { ownerFileName: "/closed.ts" };
  const invoked = { ownerFileName: "/closed.ts" };
  const open = { ownerFileName: "/open.ts" };
  const plan = createRustNativeCallableDispatchPlan({ ast: { getFileName: file => file.fileName },
    closedSourceFiles: new Set([{ fileName: "/closed.ts" }]),
    navigation: { declarationUses: () => [] },
    native: { protocols: [closed, invoked, open], inputs: [], calls: [{ input: { protocol: invoked } }] } });
  assert.equal(plan.requiredFor(closed), false, "exact closed forward-only protocol");
  assert.equal(plan.requiredFor(invoked), true, "exact invoked protocol");
  assert.equal(plan.requiredFor(open), true, "native public ABI");
  assert.equal(plan.requiredFor({ ...closed }), true, "foreign evidence cannot remove dispatch");
});

test("native dispatch separates discarded and forwarded values from actual runtime invocation", () => {
  for (const [body, required] of [
    ["return callback;", false],
    ["return (callback);", false],
    ["void callback;", false],
    ["void (callback);", false],
    ["callback;", false],
    ["callback();", true],
    ["void callback();", true],
    ["return { callback };", true],
    ["const alias = callback; return alias;", true],
  ]) {
    const checked = createCompilerSessionFromFiles({ currentDirectory: "/src", files: {
      "/src/closed.ts": `export function use(callback: () => void) { ${body} }`,
    }, compilerOptions: { strict: true, target: "es2022", module: "esnext" } }).checkSource();
    assert.equal(checked.diagnostics.length, 0, "the invocation-demand fixture is valid source");
    const source = createTargetSourceProgram(checked);
    const file = checked.getSourceFile("/src/closed.ts");
    assert.equal(file !== undefined, true, "the exact owned source file exists");
    const declaration = source.ast.statements(file)[0];
    const parameter = source.ast.parameters(declaration)[0];
    assert.equal(parameter !== undefined, true, "the exact callback input exists");
    const protocol = { ownerFileName: "/src/closed.ts" };
    const input = { ast: source.ast, closedSourceFiles: new Set([file]), navigation: source.navigation,
      native: { protocols: [protocol], calls: [], inputs: [{ subject: { node: parameter }, protocol }] } };
    assert.equal(createRustNativeCallableDispatchPlan(input).requiredFor(protocol), required, body);
    const unresolved = createRustNativeCallableDispatchPlan({ ...input,
      navigation: { declarationUses: () => [{ reference: file }] } });
    assert.equal(unresolved.requiredFor(protocol), true, "an unresolved use retains the native ABI");
  }
});
