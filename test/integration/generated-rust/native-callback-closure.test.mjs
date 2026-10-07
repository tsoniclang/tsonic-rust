import assert from "node:assert/strict";
import test from "node:test";
import { nativeArrayCallbackClosureSource, nativeCallbackClosureSource, nativeNamedMemberSource, nativeObjectConstructionConversionSource, nativeRecordConstructionConversionSource, nativeSuspendedCallbackClosureSource } from "../../../../tsonic/test/fixtures/native-callback-closure.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const surfaces of [[], ["js"]]) {
  test(`exact named member evaluation preserves native locations on ${surfaces[0] ?? "native"}`,
    { timeout: 300_000 }, () => {
      const name = `native_named_members_${surfaces[0] ?? "native"}`;
      const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin", crateName: name } },
        files: { "index.ts": nativeNamedMemberSource } });
      assert.equal(result.diagnostics.length, 0, result.diagnostics.map(value => value.message).join("\n"));
      validateGeneratedProject(name, result.artifacts, { run: true });
    });
  test(`native object construction retains its exact carrier on ${surfaces[0] ?? "native"}`,
    { timeout: 300_000 }, () => {
      const name = `native_object_construction_${surfaces[0] ?? "native"}`;
      const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin", crateName: name } },
        files: { "index.ts": nativeObjectConstructionConversionSource } });
      assert.equal(result.diagnostics.length, 0, result.diagnostics.map(value => value.message).join("\n"));
      validateGeneratedProject(name, result.artifacts, { run: true });
    });
  test(`native callback closure retains exact storage and implementation ABI on ${surfaces[0] ?? "native"}`,
    { timeout: 300_000 }, () => {
      const name = `native_callback_closure_${surfaces[0] ?? "native"}`;
      const { result } = compileRust({ surfaces, target: { id: "rust", options: { outputType: "bin", crateName: name } },
        files: { "index.ts": nativeCallbackClosureSource } });
      assert.equal(result.diagnostics.length, 0, result.diagnostics.map(value => value.message).join("\n"));
      validateGeneratedProject(name, result.artifacts, { run: true });
    });
}

test("JS-profile record construction retains the exact selected dictionary and union arm",
  { timeout: 300_000 }, () => {
    const name = "native_record_construction";
    const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin", crateName: name } },
      files: { "index.ts": nativeRecordConstructionConversionSource } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(value => value.message).join("\n"));
    validateGeneratedProject(name, result.artifacts, { run: true });
  });

test("native array callback parameter elision retains typed and hygienic parameters",
  { timeout: 300_000 }, () => {
    const name = "native_array_callback_closure";
    const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin", crateName: name } },
      files: { "index.ts": nativeArrayCallbackClosureSource } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(value => value.message).join("\n"));
    validateGeneratedProject(name, result.artifacts, { run: true });
  });

test("native suspended callback closure retains owned promise storage and void completion",
  { timeout: 300_000 }, () => {
    const name = "native_suspended_callback_closure";
    const { result } = compileRust({ surfaces: ["js"], target: { id: "rust", options: { outputType: "bin", crateName: name } },
      files: { "index.ts": nativeSuspendedCallbackClosureSource } });
    assert.equal(result.diagnostics.length, 0, result.diagnostics.map(value => value.message).join("\n"));
    validateGeneratedProject(name, result.artifacts, { run: true });
  });
