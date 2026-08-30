import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readRustCrateName,
  readRustEdition,
  readRustFoundation,
  readRustOutputType,
  readRustUserProjectFile,
  validateRustTargetOptions,
} from "../../../dist/options/rust-target-options.js";

function target(options) {
  return { id: "rust", ...(options === undefined ? {} : { options }) };
}

test("rust target options default deterministically", () => {
  assert.equal(readRustCrateName(target()), "tsonic_generated");
  assert.equal(readRustEdition(target()), "2021");
  assert.equal(readRustFoundation(target()), "std");
  assert.equal(readRustOutputType(target()), "lib");
  assert.equal(readRustUserProjectFile(target()), undefined);
});

test("rust target options accept explicit supported values", () => {
  const selection = target({
    crateName: "my_app",
    edition: "2024",
    foundation: "std",
    outputType: "bin",
    projectFile: "native/Cargo.toml",
  });

  validateRustTargetOptions(selection);
  assert.equal(readRustCrateName(selection), "my_app");
  assert.equal(readRustEdition(selection), "2024");
  assert.equal(readRustFoundation(selection), "std");
  assert.equal(readRustOutputType(selection), "bin");
  assert.equal(readRustUserProjectFile(selection), "native/Cargo.toml");
});

test("rust target options reject unknown keys", () => {
  assert.throws(
    () => validateRustTargetOptions(target({ assemblyName: "x" })),
    /Rust target option 'options\.assemblyName' is not supported\./,
  );
});

test("rust target options reject invalid values", () => {
  assert.throws(() => readRustCrateName(target({ crateName: "My-App" })), /crateName/);
  assert.throws(() => readRustCrateName(target({ crateName: "" })), /non-empty string/);
  assert.throws(() => readRustEdition(target({ edition: "2018" })), /'2021' or '2024'/);
  assert.throws(() => readRustFoundation(target({ foundation: "hosted" })), /'core', 'alloc', or 'std'/);
  assert.throws(() => readRustOutputType(target({ outputType: "Exe" })), /'lib' or 'bin'/);
  assert.throws(() => validateRustTargetOptions(target({ projectFile: 42 })), /non-empty string/);
  assert.throws(
    () => validateRustTargetOptions(target({ typescriptCompatibility: "compat" })),
    /option 'options\.typescriptCompatibility' is not supported/,
  );
  assert.throws(() => validateRustTargetOptions(target({ crateName: "My-App" })), /crateName/);
});

test("rust foundations are explicit and no-std startup is not inferred", () => {
  assert.equal(readRustFoundation(target({ foundation: "core" })), "core");
  assert.equal(readRustFoundation(target({ foundation: "alloc" })), "alloc");
  assert.throws(
    () => validateRustTargetOptions(target({ foundation: "core", outputType: "bin" })),
    /require library output/u,
  );
  validateRustTargetOptions(target({ foundation: "core", outputType: "lib" }));
});
