import assert from "node:assert/strict";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCargo, writeGeneratedProject } from "./cargo-projects.mjs";
import { rustJsPromiseOutputTargetType } from "../../dist/target-model/types/carriers/promises.js";
import { rustSourcePrimitiveTargetType } from "../../dist/target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../dist/target-model/types/equality.js";

export function assertSettledCopiedPromise(result, storageName) {
  const program = result.program;
  assert.equal(program !== undefined, true, "the settled copied result has a published native program");
  const ast = program.source.ast;
  const declarations = [];
  const visit = node => {
    if (ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "read") declarations.push(node);
    ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  assert.equal(declarations.length, 1, "one exact read declaration owns the copied result");
  const fact = program.records.asyncFunction.get(declarations[0]);
  assert.equal(fact?.kind === "js-promise" && fact.lowering.kind === "settled", true,
    "the actual source read completes synchronously before publication");
  const payload = fact === undefined ? undefined : rustJsPromiseOutputTargetType(fact.futureCarrier);
  assert.equal(rustTargetTypeRefEquals(payload, rustSourcePrimitiveTargetType("int32")), true,
    "the exact selected Promise owns one copied native i32 payload");
  const output = result.artifacts.find(artifact => artifact.path === "src/index.rs")?.text;
  assert.equal(typeof output, "string", "the original copied-read program emits native code");
  const read = output.match(/\bfn read(?:<[^>]*>)?\([^)]*\)\s*->\s*js_abi::JsPromise<i32>\s*\{([\s\S]*?)^\}/mu);
  assert.equal(read !== null, true, "read emits the one-payload JsPromise<i32> signature");
  assert.equal(/JsPromise::(?:resolved|from_result)\(/u.test(read[1]), true,
    "read uses the actual settled native constructor");
  assert.equal(/from_\w+_factory/u.test(read[1]), false, "read creates no pending factory");
  assert.equal(new RegExp(`let ${storageName}: js_abi::JsPromise<i32>`, "u").test(output), true,
    "the original stored completion owns i32 rather than an input loan");
}

export function assertRejectedAsyncSource(compilation, expected) {
  const { result, source } = compilation;
  const ast = source.ast;
  const nodes = [];
  const visit = node => { nodes.push(node); ast.forEachChild(node, child => { if (child !== undefined) visit(child); }); };
  source.sourceFiles.filter(file => file !== undefined).forEach(visit);
  const text = node => Buffer.from(ast.getSourceText(ast.getSourceFile(node)))
    .subarray(ast.pos(node), ast.end(node)).toString("utf8").trim();
  assert.deepEqual(result.diagnostics.map(issue => issue.code).sort(), expected.map(issue => issue.code).sort(),
    "every rejection has its exact complete diagnostic code, with no unrelated or missing failure");
  const consumed = new Set();
  for (const item of expected) {
    const sourceNodes = nodes.filter(node => ast.kindName(node) === item.kind && text(node) === item.text);
    const expectedNode = sourceNodes[item.occurrence ?? 0];
    assert.equal(expectedNode !== undefined, true, `${item.code}: actual checked source occurrence ${item.occurrence ?? 0}`);
    const matching = result.diagnostics.filter(issue => !consumed.has(issue) && issue.code === item.code &&
      issue.sourceNode === expectedNode);
    assert.equal(matching.length, 1, `${item.code}: exactly the intended ${item.kind} ${item.text.slice(0, 96)}`);
    const issue = matching[0];
    consumed.add(issue);
    assert.equal(nodes.includes(issue.sourceNode), true, `${item.code}: the exact original checked source node`);
  }
  assert.equal(consumed.size, result.diagnostics.length, "all actual source rejections are accounted for by identity");
  assert.equal(result.program === undefined, true, "source rejection precedes native program publication");
  assert.equal(result.artifacts.length, 0, "source rejection emits no artifacts");
}

export function verifyNativeBorrowedPromiseBoundary(name, artifacts, optional) {
  const output = optional ? "Option<i32>" : "i32";
  const expected = optional ? "Some(17)" : "17";
  const borrowedOutput = optional ? "Option<&'static i32>" : "&'static i32";
  const nativeOutput = optional ? "Option<&i32>" : "&i32";
  const borrowedValue = optional ? "Some(value)" : "value";
  const observed = optional ? "value.copied()" : "*value";
  const source = `
use tsonic_rust_js::abi as js_abi;

pub fn borrowed_read(value: &i32) -> js_abi::JsPromise<&i32> {
    js_abi::JsPromise::resolved(value)
}

#[cfg(test)]
mod native_lifetime_control {
    use super::*;
    use tsonic_rust_runtime as rt;

    #[test]
    fn selected_borrow_remains_valid_inside_its_owner() {
        let value = 17;
        let pending = borrowed_read(&value);
        let retained = rt::block_on(pending.into_result()).unwrap();
        assert!(core::ptr::eq(retained, &value));
        let completion: js_abi::JsPromise<${nativeOutput}> = js_abi::JsPromise::resolved(${optional ? "Some(retained)" : "retained"});
        let value = rt::block_on(completion.into_result()).unwrap();
        assert_eq!(${observed}, ${expected});
        let native = async { Ok::<_, js_abi::JsValue>(value) };
        let value = rt::block_on(native).unwrap();
        assert_eq!(${observed}, ${expected});
        let owned: js_abi::JsPromise<${output}> = js_abi::JsPromise::resolved(${optional ? "value.copied()" : "*value"});
        assert_eq!(rt::block_on(owned.into_result()).unwrap(), ${expected});
    }
}
`;
  const project = writeGeneratedProject(name, artifacts.map(artifact => artifact.path === "src/index.rs"
    ? { ...artifact, text: source } : artifact.path === "src/lib.rs"
      ? { ...artifact, text: "pub mod index;\n" } : artifact));
  runCargo(project, ["generate-lockfile", "--offline"]);
  runCargo(project, ["fmt"]);
  runCargo(project, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(project, ["test", "--locked", "--offline"]);
  appendFileSync(join(project, "src/index.rs"), `
use tsonic_rust_runtime as rt;

pub fn escape<'region>(value: &'region i32)
    -> rt::Callable<'static, (), rt::TsonicResult<js_abi::JsPromise<${borrowedOutput}>>> {
    let pending = borrowed_read(value);
    rt::Callable::new(move |()| {
        let value = rt::block_on(pending.clone().into_result()).unwrap();
        Ok(js_abi::JsPromise::resolved(${borrowedValue}))
    })
}
`);
  assert.throws(() => runCargo(project, ["check", "--all-targets", "--locked", "--offline"]),
    /(?:borrowed data escapes|lifetime may not live long enough)/u);
  writeFileSync(join(project, "src/index.rs"), `${source}
pub fn native_escape<'region>(value: &'region i32)
    -> impl core::future::Future<Output = Result<${borrowedOutput}, js_abi::JsValue>> + 'static {
    async move { Ok(${borrowedValue}) }
}
`);
  assert.throws(() => runCargo(project, ["check", "--all-targets", "--locked", "--offline"]),
    /(?:borrowed data escapes|lifetime may not live long enough)/u);
  writeFileSync(join(project, "src/index.rs"), `${source}
pub fn pending_capture<'region>(value: &'region i32) -> js_abi::JsPromise<i32> {
    js_abi::JsPromise::from_infallible_factory(move || async move {
        core::future::pending::<()>().await;
        *value
    })
}
`);
  assert.throws(() => runCargo(project, ["check", "--all-targets", "--locked", "--offline"]),
    /(?:borrowed data escapes|lifetime may not live long enough)/u);
}
