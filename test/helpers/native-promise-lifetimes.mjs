import assert from "node:assert/strict";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCargo, writeGeneratedProject } from "./cargo-projects.mjs";

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
  runCargo(project, ["fmt", "--all"]);
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
