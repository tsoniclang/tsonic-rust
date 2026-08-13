import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(repositoryRoot, "src");

const sourceFacts = readFileSync(
  new URL("../src/source/rust-target-semantics/source-explicit-safety.ts", import.meta.url),
  "utf8",
);
const nativePlanner = readFileSync(
  new URL("../src/backend/planner/expression-native-pointers.ts", import.meta.url),
  "utf8",
);
const safetyPlanner = readFileSync(
  new URL("../src/backend/planner/explicit-safety.ts", import.meta.url),
  "utf8",
);

test("shared explicit-safety fact keys have one Rust source-boundary reader", () => {
  const files = sourceFiles(sourceRoot);
  for (const key of [
    "tsonicNativePointerOperationFactKey",
    "tsonicSafetyBuilderFactKey",
    "tsonicUnsafeContextFactKey",
  ]) {
    assert.match(sourceFacts, new RegExp(`\\b${key}\\b`, "u"));
    assert.deepEqual(
      files
        .filter((path) => readFileSync(path, "utf8").includes(key))
        .map((path) => path.slice(repositoryRoot.length + 1)),
      ["src/source/rust-target-semantics/source-explicit-safety.ts"],
      key,
    );
  }
});

test("Rust backend consumes target-owned safety models only", () => {
  const forbidden = [
    "tsonicNativePointerOperationFactKey",
    "tsonicSafetyBuilderFactKey",
    "tsonicUnsafeContextFactKey",
    "TsonicNativePointerOperationFact",
    "TsonicSafetyApplicationFact",
    "TsonicSafetyBuilderFact",
    "TsonicUnsafeContextFact",
  ];
  const failures = sourceFiles(join(sourceRoot, "backend")).flatMap((path) => {
    const source = readFileSync(path, "utf8");
    return forbidden
      .filter((name) => source.includes(name))
      .map((name) => `${path.slice(repositoryRoot.length + 1)}: ${name}`);
  });
  assert.deepEqual(failures, []);
});

test("Rust safety planning consumes closed target facts without semantic reconstruction", () => {
  for (const source of [nativePlanner, safetyPlanner]) {
    assert.doesNotMatch(
      source,
      /getResolvedSignature|getResolvedSymbol|getSymbolAtLocation|getPropertyOfType|getTypeAtLocation|getTypeFromTypeNode/u,
    );
  }
  assert.doesNotMatch(nativePlanner, /loadNativePointer|storeNativePointer|offsetNativePointer/u);
  assert.doesNotMatch(nativePlanner, /sourceFacts|sourceName|memberName|propertyName/u);
});

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : entry.isFile() && path.endsWith(".ts")
      ? [path]
      : [];
  });
}
