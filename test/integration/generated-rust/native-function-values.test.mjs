import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactText, compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, validateGeneratedProject, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

const files = {
  "producer.ts": `
    import type { int64 } from "@tsonic/core/types.js";
    export async function read(value: int64): Promise<int64> { return value; }
    export async function other(value: int64): Promise<int64> { return value; }
    export function select(): typeof read { return read; }
  `,
  "index.ts": `
    import type { int32, int64 } from "@tsonic/core/types.js";
    import { other, read, select } from "./producer.js";
    async function invoke(callback: (value: int64) => Promise<int64>, value: int64): Promise<int64> {
      return await callback(value);
    }
    export async function main(): Promise<void> {
      const selected = select();
      const alias = selected;
      if (alias !== read || alias === other) throw new Error("declaration identity changed");
      const wide: int64 = 9007199254740993n;
      for (let index: int32 = 0; index < 10000; index++) {
        if (await invoke(alias, wide) !== wide) throw new Error("named future payload changed");
      }
    }
  `,
};

for (const surfaces of [[], ["js"]]) {
  test(`named asynchronous values preserve imports, returned aliases and declaration identity (${surfaces[0] ?? "native"})`,
    { timeout: 300_000 }, () => {
      const { result } = compileRust({ surfaces,
        target: { id: "rust", options: { outputType: "bin" } }, files: { ...files, "index.ts": files["index.ts"] + "\nawait main();\n" } });
      assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
      assert.doesNotMatch(artifactText(result, "src/index.rs"), /transmute|unreachable_unchecked|i64_to_f64/u);
      validateGeneratedProject(`named-future-values-${surfaces[0] ?? "native"}`, result.artifacts, { run: true });
    });
}

test("named native future values add no allocation at first construction or over 10000 invocations",
  { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: [],
      target: { id: "rust", options: { outputType: "lib", crateName: "native_function_values" } }, files });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(row => row.message).join("\n"));
    const generated = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
    assert.doesNotMatch(generated, /JsPromise|Callable::new|ModuleCell|Rc::new|Box<dyn|Pin<Box/u);
    const directory = writeGeneratedProject("native-function-value-cost", result.artifacts);
    mkdirSync(join(directory, "tests"), { recursive: true });
    writeFileSync(join(directory, "tests/cost.rs"), `${nativeOwnershipCostSupport}
#[test]
fn first_construction_and_every_invocation_stay_native() {
    use std::future::Future;
    let (result, cost) = measure(|| {
        let mut future = std::pin::pin!(native_function_values::index::main());
        let mut context = std::task::Context::from_waker(std::task::Waker::noop());
        match future.as_mut().poll(&mut context) {
            std::task::Poll::Ready(result) => result,
            std::task::Poll::Pending => panic!("immediately ready native calls suspended"),
        }
    });
    assert!(result.is_ok());
    assert_eq!(cost, Cost::default());
}
`);
    runCargo(directory, ["generate-lockfile", "--offline"]);
    runCargo(directory, ["fmt"]);
    runCargo(directory, ["fmt", "--check"]);
    runCargo(directory, ["check", "--all-targets", "--locked", "--offline"]);
    runCargo(directory, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
    runCargo(directory, ["test", "--locked", "--offline", "--test", "cost"]);
  });
