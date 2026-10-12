import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
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
        assert.match(generated, /JsPromise<'Region,/u);
        assert.doesNotMatch(generated, /JsPromise<'static,/u);
      }
      const root = writeGeneratedProject(crateName, result.artifacts);
      mkdirSync(join(root, "tests"), { recursive: true });
      const completion = expression => js ? `${expression}.into_result()` : expression;
      const tests = `
use ${crateName}::index;
use tsonic_rust_runtime as rt;

#[derive(Debug)]
struct BorrowedFailure<'region>(&'region i32);

struct Borrowed<'region> { value: &'region i32, fail: bool }

impl<'region> rt::CallableImplementation<()> for Borrowed<'region> {
    type Output = Result<i32, ${js ? "&'region i32" : "BorrowedFailure<'region>"}>;
    fn invoke(&self, (): ()) -> Self::Output {
        if self.fail { Err(${js ? "self.value" : "BorrowedFailure(self.value)"}) } else { Ok(*self.value) }
    }
}

#[test]
fn owns_callback_across_nested_helper_without_clone_or_static() {
    let value = 43;
    let pending = index::outer(Borrowed { value: &value, fail: false });
    assert_eq!(rt::block_on(${completion("pending")}).unwrap(), value);
    let pending = index::outer(Borrowed { value: &value, fail: true });
    let error = rt::block_on(${completion("pending")}).unwrap_err();
    assert!(core::ptr::eq(${js ? "error" : "error.0"}, &value));
    ${js ? `let error = BorrowedFailure(&value);
    assert!(core::ptr::eq(error.0, &value));
    let pending = index::outer(|()| Err::<i32, _>(BorrowedFailure(&value)));
    drop(pending);` : ""}
}

#[test]
fn scoped_and_projected_capture_keep_their_actual_lifetime() {
    let value = 29;
    assert_eq!(rt::block_on(${completion("index::scoped(&value)")}).unwrap(), value);
    assert_eq!(rt::block_on(${completion("index::tuple((&value, 7))")}).unwrap(), value);
}
`;
      const path = join(root, "tests", "retention.rs");
      writeFileSync(path, tests);
      runCargo(root, ["generate-lockfile", "--offline"]);
      runCargo(root, ["fmt", "--all"]);
      runCargo(root, ["fmt", "--all", "--check"]);
      runCargo(root, ["check", "--all-targets", "--locked", "--offline"]);
      runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
      runCargo(root, ["test", "--locked", "--offline"]);
      const escaped = js
        ? "tsonic_rust_js::abi::JsPromise<'static, i32, &'region i32>"
        : "impl core::future::Future<Output = Result<i32, BorrowedFailure<'region>>> + 'static";
      writeFileSync(path, `${tests}
fn escape<'region>(value: &'region i32) -> ${escaped} {
    index::outer(Borrowed { value, fail: false })
}
`);
      assert.throws(() => runCargo(root, ["check", "--all-targets", "--locked", "--offline"]),
        /(?:borrowed data escapes|lifetime may not live long enough|must outlive.*static)/u);
    });
}
