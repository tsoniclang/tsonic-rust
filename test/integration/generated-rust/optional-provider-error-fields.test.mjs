import assert from "node:assert/strict";
import test from "node:test";
import { optionalProviderErrorFieldSource } from "../../../../tsonic/test/fixtures/optional-provider-error-fields.mjs";
import { compileRust, nodejsCapability } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("optional provider Error fields retain canonical storage through aliases and schema reads",
  { timeout: 300_000 }, async () => {
    const name = "optional_provider_error_fields";
    const { result } = compileRust({ surfaces: ["js"], capabilities: [await nodejsCapability()],
      target: { id: "rust", options: { outputType: "bin", crateName: name } },
      files: { "index.ts": optionalProviderErrorFieldSource },
    });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(value => value.message).join("\n"));
    const executed = validateGeneratedProject(name, result.artifacts, { run: true });
    assert.equal(executed.status, 0, executed.stderr);
  });
