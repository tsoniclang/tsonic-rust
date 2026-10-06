import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { recursiveCallbackProtocolCases } from "../../../../tsonic/test/fixtures/recursive-callback-protocols.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";

const measuredCases = recursiveCallbackProtocolCases.filter(current =>
  current.name === "captured-class-field" || current.name === "shared-class-frame" ||
  current.name === "shared-class-construction-writes" || current.name === "shared-class-string-field");

const proof = current => `
#[cfg(test)]
mod recursive_class_cost {
    use super::*;
    ${nativeOwnershipCostSupport}

    #[test]
    fn one_owner_retains_captured_fields_without_repeated_allocation() {
        for _ in 0..32 {
            let (callback, created) = measure(|| create(${current.name === "shared-class-string-field" ? 'String::from("abc")' : "3.0"})${current.name === "captured-class-field" ? "" : ".unwrap()"});
            assert_eq!(created.allocations, ${current.name === "shared-class-string-field" ? 4 : 1}, "only the native owner and required owned string values");
            assert_eq!(created.deallocations, ${current.name === "shared-class-string-field" ? 2 : 0}, "only replaced string values are released during construction");
            assert_eq!(created.reallocations, 0);
            let (alias, retained) = measure(|| callback.clone());
            assert_eq!(retained, Cost::default());
            assert!(callback == alias);
            let (_, invoked) = measure(|| {
                for _ in 0..32 {
                    assert_eq!(callback.call((0.0,)).unwrap(), 13.0);
                    assert_eq!(callback.call((1.0,)).unwrap(), 14.0);
                    assert_eq!(alias.call((8.0,)).unwrap(), 14.0);
                }
            });
            assert_eq!(invoked, Cost::default(), "repeated invocation does not allocate or copy owners");
            let (_, first_drop) = measure(|| drop(callback));
            assert_eq!(first_drop, Cost::default());
            assert_eq!(alias.call((8.0,)).unwrap(), 14.0);
            let (_, final_drop) = measure(|| drop(alias));
            assert_eq!(final_drop.allocations, 0);
            assert_eq!(final_drop.reallocations, 0);
            assert_eq!(created.deallocations + final_drop.deallocations, created.allocations);
            assert_eq!(created.deallocated_bytes + final_drop.deallocated_bytes, created.allocated_bytes);
        }
    }
}
`;

for (const current of measuredCases) for (const surfaces of [[], ["js"]]) {
  const profile = surfaces[0] ?? "native";
  test(`${current.name} has one native callback owner and balanced lifetime in ${profile}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin" } },
      files: { "index.ts": current.source } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.slice(0, 4).map(row => row.message.slice(0, 256)).join("\n"));
    const directory = writeGeneratedProject(`recursive-class-cost-${current.name}-${profile}`, result.artifacts);
    runCargo(directory, ["generate-lockfile", "--offline"]);
    runCargo(directory, ["fmt", "--all", "--check"]);
    appendFileSync(join(directory, "src/index.rs"), proof(current));
    runCargo(directory, ["fmt", "--all"]);
    runCargo(directory, ["check", "--all-targets", "--locked", "--offline"]);
    runCargo(directory, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
    runCargo(directory, ["test", "--release", "--locked", "--offline", "--", "--test-threads=1"]);
    runCargo(directory, ["run", "--release", "--locked", "--offline"]);
  });
}
