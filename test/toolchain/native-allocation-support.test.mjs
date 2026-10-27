import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { appendFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeAllocationSupport, nativeOwnershipCostSupport } from "../helpers/native-ownership-cost.mjs";

const canonicalPath = fileURLToPath(new URL("../../../rust-runtime/tests/helpers/allocation_counts.rs", import.meta.url));
const generatedRoot = fileURLToPath(new URL("../../.temp/native-allocation-support", import.meta.url));

function project() {
  mkdirSync(generatedRoot, { recursive: true });
  return mkdtempSync(join(generatedRoot, "project-"));
}

function run(root, label, command, arguments_) {
  const result = spawnSync(command, arguments_, { cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 1_048_576 });
  const log = join(root, `${label}.log`);
  writeFileSync(log, `${result.stdout ?? ""}${result.stderr ?? ""}`);
  writeFileSync(join(root, `${label}.json`), JSON.stringify({ command, arguments: arguments_, status: result.status,
    signal: result.signal, error: result.error?.message, log }, null, 2) + "\n");
  assert.equal(result.status, 0, `${label}: ${log}\n${String(result.error ?? "")}\n${(result.stderr ?? "").slice(0, 4096)}`);
}

test("allocation support has one mandatory project-root API and no supported string constants", () => {
  assert.equal(typeof nativeAllocationSupport, "function");
  assert.equal(nativeAllocationSupport.length, 1);
  assert.equal(typeof nativeOwnershipCostSupport, "function");
  assert.equal(nativeOwnershipCostSupport.length, 1);
  assert.throws(() => nativeAllocationSupport(), TypeError);
  assert.throws(() => nativeOwnershipCostSupport(), TypeError);
});

for (const [name, support] of [["allocation", nativeAllocationSupport], ["ownership", nativeOwnershipCostSupport]]) {
  test(`${name} support byte-copies the canonical observer into independent project-owned storage`, () => {
    const root = project();
    const canonical = readFileSync(canonicalPath);
    const source = support(root);
    const copy = join(root, "allocation_counts.rs");
    assert.equal(source.includes(`#[path = ${JSON.stringify(copy)}]`), true, "the module targets only its project's copy");
    assert.equal(source.includes(JSON.stringify(canonicalPath)), false, "no writable external module path");
    assert.equal(readFileSync(copy).equals(canonical), true, "the helper is a byte copy, not rewritten source");
    assert.equal(lstatSync(copy).isSymbolicLink(), false, "a link would give rustfmt a shared write target");
    const copyStat = lstatSync(copy);
    const canonicalStat = lstatSync(canonicalPath);
    assert.equal(copyStat.dev === canonicalStat.dev && copyStat.ino === canonicalStat.ino, false, "the copy is not a hard link");
    appendFileSync(copy, "\n \n");
    assert.equal(readFileSync(canonicalPath).equals(canonical), true, "project edits cannot change the canonical observer");
  });
}

for (const edition of ["2021", "2024"]) {
  for (const placement of ["root", "integration", "nested"]) {
    test(`project-owned ${placement} allocation instrumentation formats and measures under Rust ${edition}`, () => {
      const root = project();
      const canonical = readFileSync(canonicalPath);
      const support = nativeOwnershipCostSupport(root);
      const proof = `${support}
#[test]
fn project_owned_cost_view_keeps_original_requested_bytes_and_counts() {
    let (values, cost) = measure(|| vec![7u8; 97]);
    assert_eq!(values, [7u8; 97]);
    assert_eq!(cost.allocations, 1);
    assert_eq!(cost.allocated_bytes, 97);
    assert_eq!(cost.reallocations, 0);
    assert_eq!(cost.deallocations, 0);
    assert_eq!(cost.deallocated_bytes, 0);
    let (_, released) = measure(|| drop(values));
    assert_eq!(released.allocations, 0);
    assert_eq!(released.deallocations, 1);
    assert_eq!(released.deallocated_bytes, 97);
}
`;
      const source = placement === "nested" ? `#[cfg(test)]\nmod nested {\n${proof}\n}\n` : proof;
      const relativePath = placement === "root" ? "native.rs" : placement === "integration" ? "tests/cost.rs" : "src/lib.rs";
      const path = join(root, relativePath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, source);
      appendFileSync(join(root, "allocation_counts.rs"), "\n \n");
      run(root, "rustfmt", "rustfmt", ["--edition", edition, path]);
      assert.equal(readFileSync(canonicalPath).equals(canonical), true, "rustfmt must not touch the canonical runtime source");
      assert.equal(readFileSync(join(root, "allocation_counts.rs")).equals(canonical), true, "rustfmt canonicalizes only the owned copy");
      const executable = join(root, "native-test");
      run(root, "rustc", "rustc", [`--edition=${edition}`, "--test", "-Dwarnings", path, "-o", executable]);
      run(root, "native-test", executable, ["--test-threads=1"]);
      assert.equal(readFileSync(canonicalPath).equals(canonical), true, "native compilation and execution preserve shared source");
    });
  }
}
