import assert from "node:assert/strict";
import test from "node:test";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";
import { moduleInitializationErrorCases } from "../../../../tsonic/test/fixtures/module-initialization-errors.mjs";

const current = moduleInitializationErrorCases.find(scenario => scenario.name === "support_name_collisions");

for (const surfaces of [[], ["js"]]) test(`library startup retains public support names on ${surfaces[0] ?? "native"}`, () => {
  const crateName = `public_names_${surfaces[0] ?? "native"}`;
  const { result } = compileRust({ surfaces,
    target: { id: "rust", options: { outputType: "lib", crateName } },
    files: { ...current.files, "index.ts": current.source },
  });
  assert.equal(result.diagnostics.length, 0, result.diagnostics.map(diagnostic => diagnostic.message).join("\n"));
  validateGeneratedProject(`public-initialization-names-${surfaces[0] ?? "native"}`, [...result.artifacts,
    { kind: "source", path: "tests/public_names.rs", text: `#[test]
fn public_names_remain_authored() {
    let _: Option<${crateName}::InitializationError> = None;
    let _: Option<${crateName}::InitializationErrors> = None;
    ${crateName}::initialize_2().unwrap();
    assert_eq!(${crateName}::initialize(), 42);
}
` },
  ]);
});
