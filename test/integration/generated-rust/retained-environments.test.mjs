import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";

const source = `
import type { int32 } from "@tsonic/core/types.js";
import type { Life, Ref } from "@tsonic/rust/types.js";
import { load } from "@tsonic/rust/lang.js";
export interface Base<Region extends Life> { value: Ref<int32, Region>; }
export interface Extended<Region extends Life> extends Base<Region> { extra: int32; }
export async function outer(callback: () => int32): Promise<int32> {
  function helper(): int32 { return callback(); }
  return helper();
}
export function scoped<Region extends Life>(value: Ref<int32, Region>): Promise<int32> {
  return outer(() => load(value));
}
export function record<Region extends Life>(record: Extended<Region>): Promise<int32> {
  const value = record.value;
  return outer(() => load(value));
}
export function tuple<Region extends Life>(values: [Ref<int32, Region>, int32]): Promise<int32> {
  const value = values[0];
  return outer(() => load(value));
}
`;

for (const js of [false, true]) {
  test(`retained environments preserve nested helpers, projections and nonClone borrowed errors (${js ? "js" : "native"})`,
    { timeout: 300_000 }, () => {
      const crateName = `retained_environments_${js ? "js" : "native"}`;
      const { result } = compileRust({ surfaces: js ? ["js"] : [],
        target: { id: "rust", options: { outputType: "lib", crateName } }, files: { "index.ts": source } });
      assert.deepEqual(result.diagnostics.map(value => `${value.code}: ${value.message}`), []);
      const generated = artifactText(result, "src/index.rs");
      assert.match(generated, /fn helper</u);
      assert.doesNotMatch(generated, /transmute|Implementation\w*: [^\n]*(?:Clone|'static)/u);
      if (js) {
        assert.match(generated, /JsPromise<i32>/u);
        assert.doesNotMatch(generated, /JsPromise<'/u);
      }
      const root = writeGeneratedProject(crateName, result.artifacts);
      const ast = result.program.source.ast;
      const declarations = [];
      const visit = node => {
        if (ast.is.IsFunctionDeclaration(node) && ast.text(ast.name(node)) === "outer") declarations.push(node);
        ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
      };
      result.program.sourceFiles.forEach(visit);
      const declaration = declarations[0];
      assert.equal(declarations.length, 1, "one exact source callable owner");
      assert.equal(declaration !== undefined, true, "the exact source owner is retained");
      const body = js ? result.program.promiseBodies.declarations.get(declaration) : undefined;
      assert.equal(!js || body !== undefined, true, "the selected native error-preserving body remains crate-private");
      const nativeName = js ? body.name : "outer";
      const completion = expression => js ? expression : `rt::block_on(${expression})`;
      const tests = `
#[cfg(test)]
mod retention {
use super::*;
use tsonic_rust_runtime as rt;

#[derive(Debug)]
struct BorrowedFailure<'region>(&'region i32);

struct Borrowed<'region> { value: &'region i32, fail: bool }

impl<'region> rt::CallableImplementation<()> for Borrowed<'region> {
    type Output = Result<i32, BorrowedFailure<'region>>;
    fn invoke(&self, (): ()) -> Self::Output {
        if self.fail { Err(BorrowedFailure(self.value)) } else { Ok(*self.value) }
    }
}

#[test]
fn owns_callback_across_nested_helper_without_clone_or_static() {
    let value = 43;
    let pending = ${nativeName}(Borrowed { value: &value, fail: false });
    assert_eq!(${completion("pending")}.unwrap(), value);
    let pending = ${nativeName}(Borrowed { value: &value, fail: true });
    let error = ${completion("pending")}.unwrap_err();
    assert!(core::ptr::eq(error.0, &value));
}

#[test]
fn scoped_and_projected_capture_keep_their_actual_lifetime() {
    let value = 29;
    assert_eq!(rt::block_on(${js ? "scoped(&value).into_result()" : "scoped(&value)"}).unwrap(), value);
    assert_eq!(rt::block_on(${js ? "tuple((&value, 7)).into_result()" : "tuple((&value, 7))"}).unwrap(), value);
}
${js ? `
struct JsBorrowed<'region> { value: &'region i32, rejection: Option<&'region js_abi::JsValue> }

impl rt::CallableImplementation<()> for JsBorrowed<'_> {
    type Output = Result<i32, js_abi::JsValue>;
    fn invoke(&self, (): ()) -> Self::Output {
        match self.rejection { Some(reason) => Err(reason.clone()), None => Ok(*self.value) }
    }
}

#[test]
fn public_settled_results_keep_copied_values_and_canonical_rejection_identity() {
    let pending = {
        let value = 43;
        outer(JsBorrowed { value: &value, rejection: None })
    };
    assert_eq!(rt::block_on(pending.into_result()).unwrap(), 43);
    let value = 43;
    let original = js_abi::JsValue::from_error(rt::MutableJsError::error(String::from("exact native reason")));
    let error = rt::block_on(outer(JsBorrowed { value: &value, rejection: Some(&original) }).into_result()).unwrap_err();
    assert!(tsonic_rust_js::equality::JsStrictEqual::strict_equal(&error, &original));
}
` : ""}
`;
      const path = join(root, "src", "index.rs");
      writeFileSync(path, `${generated}\n${tests}\n}\n`);
      runCargo(root, ["generate-lockfile", "--offline"]);
      runCargo(root, ["fmt", "--all"]);
      runCargo(root, ["fmt", "--all", "--check"]);
      runCargo(root, ["check", "--all-targets", "--locked", "--offline"]);
      runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
      runCargo(root, ["test", "--locked", "--offline"]);
      const escaped = js
        ? "Result<i32, BorrowedFailure<'static>>"
        : "impl core::future::Future<Output = Result<i32, BorrowedFailure<'region>>> + 'static";
      writeFileSync(path, `${generated}\n${tests}
fn escape<'region>(value: &'region i32) -> ${escaped} {
    ${nativeName}(Borrowed { value, fail: true })
}
}
`);
      assert.throws(() => runCargo(root, ["check", "--all-targets", "--locked", "--offline"]),
        /(?:borrowed data escapes|lifetime may not live long enough|must outlive.*static)/u);
    });
}
