import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

const source = `
export function first(seed: number): (count: number) => number {
  let callback = (count: number): number => count === 0 ? seed : callback(count - 1);
  const original = callback;
  callback = (count: number): number => count === 0 ? seed : callback(count - 1);
  return original;
}
export function second(seed: number): (count: number) => number {
  let callback = (count: number): number => count === 0 ? seed * 2 : callback(count - 1);
  const original = callback;
  callback = (count: number): number => count === 0 ? seed * 2 : callback(count - 1);
  return original;
}
export function invoke(callback: (count: number) => number, count: number): number {
  return callback(count);
}
export function main(): void {
  if (invoke(first(7), 2) !== 7 || invoke(second(7), 2) !== 14) throw new Error("borrowed input");
}
`;

for (const profile of ["native", "js"]) {
  test(`different recursive families have zero invocation-input allocation cost in ${profile}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: profile === "native" ? [] : ["js"],
      target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": source } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 4).map(row => row.message.slice(0, 256)).join("\n"));
    const project = writeGeneratedProject(`recursive-input-cost-${profile}`, result.artifacts);
    const index = result.artifacts.find(artifact => artifact.path === "src/index.rs");
    assert.equal(index !== undefined, true, "generated native module");
    runCargo(project, ["generate-lockfile", "--offline"]);
    runCargo(project, ["fmt", "--all", "--check"]);
    appendFileSync(join(project, "src", "index.rs"), `
#[cfg(test)]
mod input_cost {
    use super::*;
    ${nativeOwnershipCostSupport}
    #[test]
    fn borrowed_invocations_do_not_allocate_an_adapter_or_clone_a_frame() {
        let left = first(7.0);
        let right = second(7.0);
        let before_left = std::rc::Rc::strong_count(left.frame());
        let before_right = std::rc::Rc::strong_count(right.frame());
        let (_, cost) = measure(|| {
            for _ in 0..128 {
                assert_eq!(invoke(&left, 8.0).unwrap(), 7.0);
                assert_eq!(invoke(&right, 8.0).unwrap(), 14.0);
            }
        });
        assert_eq!(cost, Cost::default());
        assert_eq!(std::rc::Rc::strong_count(left.frame()), before_left);
        assert_eq!(std::rc::Rc::strong_count(right.frame()), before_right);
    }
}
`);
    runCargo(project, ["fmt", "--all"]);
    runCargo(project, ["check", "--all-targets", "--locked", "--offline"]);
    runCargo(project, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
    runCargo(project, ["test", "--release", "--locked", "--offline", "--", "--test-threads=1"]);
    runCargo(project, ["run", "--release", "--locked", "--offline"]);
  });
}
