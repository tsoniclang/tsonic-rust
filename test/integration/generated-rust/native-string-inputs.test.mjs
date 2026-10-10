import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { nativeOwnershipCostSupport } from "../../helpers/native-ownership-cost.mjs";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";

test("unannotated read-only String parameters keep native borrowed ABI across surface calls", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: ["js"],
    target: { id: "rust", options: { outputType: "lib", crateName: "native_string_inputs" } },
    files: { "index.ts": `
      export function parses(value: string): boolean {
        return parseFloat(value) === 1.1 && Number.parseFloat(value) === 1.1 &&
          parseInt(value) === 1 && Number.parseInt(value) === 1;
      }
      export function quoted(value: string): string { return JSON.stringify(value); }
      export function encoded(value: string): string { return encodeURIComponent(value); }
      export function decoded(value: string): string { return decodeURIComponent(value); }
      export function characters(value: string): string { return Array.from(value).join(value); }
      export function mapped(value: string): string { return Array.from(value, item => item).join(value); }
      export function matches(pattern: string, flags: string, value: string): boolean {
        return new RegExp(pattern, flags).test(value);
      }
      export function replacement(value: string, pattern: string, replacement: string): string {
        return value.replace(pattern, replacement);
      }
      export function regexreplacement(value: string, pattern: string, replacement: string): string {
        return value.replace(new RegExp(pattern), replacement);
      }` },
  });
  assertNoTargetDiagnostics(result.diagnostics);
  const source = result.artifacts.filter(artifact => artifact.path.endsWith(".rs")).map(artifact => artifact.text).join("\n");
  assert.doesNotMatch(source, /String::from|\.to_owned\(|\.clone\(/u);
  for (const name of ["parses", "quoted", "encoded", "decoded", "characters", "mapped", "matches", "replacement", "regexreplacement"]) {
    assert.match(source, new RegExp(`pub fn ${name}\\([^)]*value: &str`, "u"), name);
  }
  const root = writeGeneratedProject("native-string-inputs", result.artifacts);
  mkdirSync(join(root, "tests"), { recursive: true });
  const nativePath = join(root, "tests", "native_inputs.rs");
  writeFileSync(nativePath, `${nativeOwnershipCostSupport}
use native_string_inputs::index;

#[test]
fn borrowed_parsing_does_not_allocate_or_consume_its_input() {
    let input = String::from("1.1");
    let (_, cost) = measure(|| {
        for _ in 0..10_000 {
            assert!(std::hint::black_box(index::parses(&input)));
        }
    });
    assert_eq!(cost, Cost::default());
    assert_eq!(input, "1.1");
}

#[test]
fn borrowed_native_operations_preserve_their_owned_results() {
    assert_eq!(index::quoted("abc").unwrap(), "\\\"abc\\\"");
    assert_eq!(index::encoded("a b"), "a%20b");
    assert_eq!(index::decoded("a%20b").unwrap(), "a b");
    assert_eq!(index::characters("ab"), "aabb");
    assert_eq!(index::mapped("ab"), "aabb");
    assert!(index::matches("^a", "", "abc").unwrap());
    assert!(!index::matches("^b", "", "abc").unwrap());
    assert_eq!(index::replacement("abc", "a", "z"), "zbc");
    assert_eq!(index::regexreplacement("abc", "a", "z").unwrap(), "zbc");
}
`);
  const format = spawnSync("rustfmt", ["--edition", "2021", nativePath], { encoding: "utf8" });
  assert.equal(format.status, 0, format.stderr);
  runCargo(root, ["generate-lockfile", "--offline"]);
  runCargo(root, ["fmt", "--all", "--check"]);
  runCargo(root, ["check", "--all-targets", "--locked", "--offline"]);
  runCargo(root, ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"]);
  runCargo(root, ["test", "--all-targets", "--locked", "--offline"]);
});
