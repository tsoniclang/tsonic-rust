import assert from "node:assert/strict";
import test from "node:test";
import { assertNoTargetDiagnostics } from "../../../../tsonic/test/scripts/diagnostic-assertions.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { runCargo, writeGeneratedProject } from "../../helpers/cargo-projects.mjs";

const rejected = [
  {
    name: "superseded positional result parameter",
    source: "fn require(_: &impl CallableImplementation<(), bool>) {}",
    diagnostic: /trait takes 1 generic argument but 2 generic arguments were supplied/u,
  },
  {
    name: "mismatched associated output",
    source: `fn require(_: impl CallableImplementation<(), Output = String>) {}
fn wrong() { require(|()| 7_u64); }`,
    diagnostic: /expected.*String.*(?:found|returns).*u64/su,
  },
  {
    name: "escaping borrowed capture in an anonymous future",
    source: `fn escape() -> impl CallableImplementation<(), Output = impl core::future::Future<Output = usize>> {
    let owned = String::from("local");
    let borrowed = owned.as_str();
    move |()| async move { borrowed.len() }
}`,
    diagnostic: /does not live long enough|cannot return value referencing local variable/u,
  },
];

test("native callable output contracts reject removed syntax, wrong results and escaping captures", { timeout: 300_000 }, () => {
  const { result } = compileRust({ surfaces: [], target: { id: "rust", options: { outputType: "lib" } },
    files: { "index.ts": "export function value(): boolean { return true; }" } });
  assertNoTargetDiagnostics(result.diagnostics);
  for (const entry of rejected) {
    const directory = writeGeneratedProject("callable-output-rejection", [...result.artifacts, {
      path: "src/bin/rejected.rs",
      text: `use tsonic_rust_runtime::CallableImplementation;\n${entry.source}\nfn main() {}\n`,
    }]);
    runCargo(directory, ["generate-lockfile", "--offline"]);
    assert.throws(() => runCargo(directory, ["check", "--bin", "rejected", "--locked", "--offline"]),
      entry.diagnostic, entry.name);
  }
});
