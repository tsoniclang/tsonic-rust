import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { compileRust, artifactText, repositoryRoot, rustRuntimeCratePath } from "../../helpers/rust-session.mjs";
import { memoryAbiCapability } from "../../helpers/memory-abi.mjs";
import { nativeMemoryProvider, nativeProviderProofSource, nativeProviderInferredProofSource } from "../../helpers/native-memory-provider.mjs";

function prepare() {
  const scratch = join(repositoryRoot, ".temp");
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, "native-provider-"));
  const providerRoot = join(root, "provider");
  mkdirSync(join(providerRoot, "src"), { recursive: true });
  writeFileSync(join(providerRoot, "src/lib.rs"), readFileSync(new URL("../../fixtures/native-memory/provider.rs", import.meta.url)));
  writeFileSync(join(providerRoot, "Cargo.toml"), `[package]
name = "native_memory_proof"
version = "0.1.0"
edition = "2021"
[dependencies]
tsonic_rust_runtime = { path = ${JSON.stringify(rustRuntimeCratePath)} }
`);
  return { root, providerRoot };
}

function compile(providerRoot, options = {}, source = nativeProviderProofSource) {
  return compileRust({
    capabilities: [memoryAbiCapability("rust")], packages: [nativeMemoryProvider(providerRoot, options)],
    target: { id: "rust", options: { outputType: "bin" } }, files: { "index.ts": source },
  }).result;
}

function verifyProviderSource(sourceText) {
  const { root, providerRoot } = prepare();
  const result = compile(providerRoot, {}, sourceText);
  assert.deepEqual(result.diagnostics, []);
  const source = artifactText(result, "src/index.rs");
  assert.match(source, /native_memory_proof::acquire/u);
  assert.match(source, /reinterpret_raw_location::<u32>/u);
  const output = join(root, "output");
  mkdirSync(output, { recursive: true });
  for (const artifact of result.artifacts) {
    const file = join(output, artifact.path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, artifact.text);
  }
  for (const args of [
    ["generate-lockfile", "--offline"], ["fmt", "--all", "--check"],
    ["check", "--all-targets", "--locked", "--offline"],
    ["clippy", "--all-targets", "--locked", "--offline", "--", "-D", "warnings"],
    ["test", "--locked", "--offline"], ["run", "--locked", "--offline"],
  ]) {
    const native = spawnSync("cargo", args, { cwd: output, encoding: "utf8", timeout: 240_000,
      maxBuffer: 4_194_304, env: { ...process.env, CARGO_BUILD_JOBS: "2" } });
    assert.equal(native.status, 0, `${args.join(" ")}\n${native.error ?? ""}\n${native.stdout}\n${native.stderr}`);
  }
}

for (const [name, sourceText] of [["helpers and containers", nativeProviderProofSource],
  ["inferred types without marker imports", nativeProviderInferredProofSource]]) {
  test(`selected native provider pointers retain original storage through ${name}`, { timeout: 300_000 },
    () => verifyProviderSource(sourceText));
}

for (const options of [{ missingRelation: true }, { wrongCarrier: true }, { wrongOptional: true }, { wrongPointee: true }, { wrongGenericPointee: true }]) {
  test(`native provider rejects ${Object.keys(options)[0]} before publishing artifacts`, () => {
    const { providerRoot } = prepare();
    const result = compile(providerRoot, options);
    const expected = options.missingRelation ? "RUST_PROVIDER_OPERATION_NOT_MAPPED" : "RUST_PROVIDER_POINTER_RESULT_CONFLICT";
    assert.ok(result.diagnostics.some(diagnostic => diagnostic.code === expected), JSON.stringify(result.diagnostics));
    assert.equal(result.artifacts.length, 0);
  });
}
