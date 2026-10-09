import assert from "node:assert/strict";
import test from "node:test";
import { suspendedActivationCallableSource, suspendedClassActivationCallableSource } from "../../../../tsonic/test/fixtures/suspended-activation-callables.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

test("suspended frame entries retain one exact activation across awaits and later calls",
  { timeout: 300_000 }, () => {
    const name = "suspended_activation_callables";
    const { result } = compileRust({ surfaces: ["js"],
      target: { id: "rust", options: { outputType: "bin", crateName: name } },
      files: { "index.ts": suspendedActivationCallableSource },
    });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(value => value.message).join("\n"));
    const executed = validateGeneratedProject(name, result.artifacts, { run: true });
    assert.equal(executed.status, 0, executed.stderr);
  });

test("suspended class entries retain their owning activation across aliases and pending work",
  { timeout: 300_000 }, () => {
    const name = "suspended_class_activation_callables";
    const { result } = compileRust({ surfaces: ["js"],
      target: { id: "rust", options: { outputType: "bin", crateName: name } },
      files: { "index.ts": suspendedClassActivationCallableSource },
    });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.slice(0, 6).map(value => value.message).join("\n"));
    const executed = validateGeneratedProject(name, result.artifacts, { run: true });
    assert.equal(executed.status, 0, executed.stderr);
  });
