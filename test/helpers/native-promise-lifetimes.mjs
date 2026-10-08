import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { runCargo, writeGeneratedProject } from "./cargo-projects.mjs";

export function verifyNativeBorrowedPromiseBoundary(name, artifacts, optional) {
  const output = optional ? "Option<i32>" : "i32";
  const value = optional ? "Some(value)" : "value";
  const expected = optional ? "Some(17)" : "17";
  const source = `
use tsonic_rust_js::abi as js_abi;
use tsonic_rust_runtime as rt;

pub fn borrowed_read<'region>(value: &'region i32) -> js_abi::JsPromise<'region, i32, rt::TsonicError> {
    js_abi::JsPromise::from_infallible_factory(move || async move { *value })
}

#[cfg(test)]
mod native_lifetime_control {
    use super::*;

    #[test]
    fn selected_borrow_remains_valid_inside_its_owner() {
        let value = 17;
        let pending = borrowed_read(&value);
        let completion: js_abi::JsPromise<'_, ${output}, rt::TsonicError> = js_abi::JsPromise::from_fallible_factory(move || async move {
            let value = pending.into_result().await?;
            Ok(${value})
        });
        assert_eq!(rt::block_on(completion.into_result()).unwrap(), ${expected});
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
pub fn escape<'region>(value: &'region i32)
    -> rt::Callable<(), rt::TsonicResult<js_abi::JsPromise<'static, ${output}, rt::TsonicError>>> {
    let pending: js_abi::JsPromise<'static, i32, rt::TsonicError> = borrowed_read(value);
    rt::Callable::new(move |()| {
        let pending = pending.clone();
        Ok(js_abi::JsPromise::from_fallible_factory(move || async move {
            let value = pending.into_result().await?;
            Ok(${value})
        }))
    })
}
`);
  assert.throws(() => runCargo(project, ["check", "--all-targets", "--locked", "--offline"]),
    /(?:borrowed data escapes|lifetime may not live long enough)/u);
}
