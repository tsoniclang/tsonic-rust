import assert from "node:assert/strict";
import test from "node:test";
import { recursiveCallbackProtocolCases } from "../../../../tsonic/test/fixtures/recursive-callback-protocols.mjs";
import { compileRust } from "../../helpers/rust-session.mjs";
import { validateGeneratedProject } from "../../helpers/cargo-projects.mjs";

for (const current of (recursiveCallbackProtocolCases).slice(7, 8)) for (const profile of (["native", "js"]).slice(1, 2)) {
test(`${current.name} recursive callback protocol compiles and executes in ${profile}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: profile === "native" ? [] : ["js"],
      target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": current.source + "\nmain();\n" } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.slice(0, 4).map(row => row.message.slice(0, 256)).join("\n"));
    validateGeneratedProject(`recursive-callback-${current.name}-${profile}`, result.artifacts, { run: true });
  });
}

for (const current of (recursiveCallbackProtocolCases).slice(8, 14)) for (const profile of (["native", "js"]).slice(0, 2)) {
test(`${current.name} recursive callback protocol compiles and executes in ${profile}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: profile === "native" ? [] : ["js"],
      target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": current.source + "\nmain();\n" } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.slice(0, 4).map(row => row.message.slice(0, 256)).join("\n"));
    validateGeneratedProject(`recursive-callback-${current.name}-${profile}`, result.artifacts, { run: true });
  });
}

for (const current of (recursiveCallbackProtocolCases).slice(14, 15)) for (const profile of (["native", "js"]).slice(0, 1)) {
test(`${current.name} recursive callback protocol compiles and executes in ${profile}`, { timeout: 300_000 }, () => {
    const { result } = compileRust({ surfaces: profile === "native" ? [] : ["js"],
      target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": current.source + "\nmain();\n" } });
    assert.equal(result.diagnostics.length, 0,
      result.diagnostics.slice(0, 4).map(row => row.message.slice(0, 256)).join("\n"));
    validateGeneratedProject(`recursive-callback-${current.name}-${profile}`, result.artifacts, { run: true });
  });
}
