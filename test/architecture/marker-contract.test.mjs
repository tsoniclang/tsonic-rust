import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = (path) => readFileSync(join(repositoryRoot, path), "utf8");

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

test("Rust source modules expose the canonical primitive and explicit semantic contracts", () => {
  const modules = source("src/source/profiles/source-modules.ts");
  const identity = source("src/source/semantics/identity.ts");
  const types = source("src/source/semantics/declarations/types.ts");
  const operations = source("src/source/semantics/declarations/operations.ts");
  const primitiveAliases = [...modules.matchAll(/sourcePrimitive\("([^"]+)",\s*"([^"]+)"/gu)]
    .map((match) => [match[1], match[2]]);

  assert.deepEqual(primitiveAliases, [
    ["bool", "bool"],
    ["i8", "int8"],
    ["u8", "uint8"],
    ["i16", "int16"],
    ["u16", "uint16"],
    ["i32", "int32"],
    ["u32", "uint32"],
    ["i64", "int64"],
    ["u64", "uint64"],
    ["i128", "int128"],
    ["u128", "uint128"],
    ["isize", "native-int"],
    ["usize", "native-uint"],
    ["f32", "float32"],
    ["f64", "float64"],
  ]);
  for (const [property, exportName] of [
    ["life", "Life"],
    ["staticLifetime", "Static"],
    ["owned", "Owned"],
    ["sharedReference", "Ref"],
    ["mutableReference", "Mut"],
    ["outlives", "Outlives"],
    ["validFor", "ValidFor"],
    ["constParameter", "Const"],
    ["dynamicTrait", "Dyn"],
    ["captureSet", "Capture"],
    ["opaqueType", "Impl"],
    ["maybeSized", "MaybeSized"],
    ["functionPointer", "FnPtr"],
    ["rustChar", "char"],
  ]) {
    assert.match(identity, new RegExp(`${property}:\\s*"${exportName}"`, "u"));
  }
  for (const [property, exportName] of [
    ["sharedBorrow", "ref"],
    ["mutableBorrow", "mut"],
    ["move", "move"],
    ["clone", "clone"],
    ["own", "own"],
    ["load", "load"],
    ["store", "store"],
    ["replace", "replace"],
    ["take", "take"],
    ["captureMove", "captureMove"],
  ]) {
    assert.match(identity, new RegExp(`${property}:\\s*"${exportName}"`, "u"));
  }
  assert.match(types, /rustSemanticTypeDeclarations/u);
  assert.match(operations, /rustSemanticOperationDeclarations/u);
  assert.doesNotMatch(`${identity}\n${types}\n${operations}`, /["']borrowMut["']|["']borrow["']/u);
  assert.doesNotMatch(
    modules,
    /sourcePrimitive\("char"/u,
  );
});

test("Rust converts typed-location facts into one target-owned selection", () => {
  const operationRouter = source(
    "src/analysis/operations/provider/calls/deferred.ts",
  );
  const operations = source(
    "src/policy/operations/typed-location-source.ts",
  );
  const selection = source(
    "src/analysis/operations/typed-locations.ts",
  );

  assert.match(operationRouter, /selectRustTypedLocationCall/u);
  assert.doesNotMatch(operationRouter, /pointerOperationFactKey/u);
  assert.match(operations, /pointerOperationFactKey/u);
  assert.match(operations, /selectRustTypedLocationSourceOperation/u);
  assert.match(operations, /kind:\s*"selected"/u);
  assert.doesNotMatch(selection, /pointerOperationFactKey/u);
  assert.match(selection, /rustTypedLocationPlanKey/u);
  const neutralFactConsumers = sourceFiles(join(repositoryRoot, "src"))
    .filter((path) => readFileSync(path, "utf8").includes("pointerOperationFactKey"))
    .map((path) => path.slice(repositoryRoot.length + 1));
  assert.deepEqual(neutralFactConsumers, [
    "src/policy/operations/typed-location-source.ts",
  ]);
  assert.doesNotMatch(
    selection,
    /\baddressOf\b|\ballocatePointer\b|\bequalPointer\b|\bloadPointer\b|\bstorePointer\b/u,
  );
});

test("Rust backend consumes only target-owned marker facts", () => {
  const forbiddenNeutralFacts =
    /argumentPassingFactKey|defaultValueFactKey|fieldFactKey|flowStateFactKey|functionPointerFactKey|pointerFactKey|pointerOperationFactKey|structFactKey|tsonicAttributeBuilderFactKey/u;
  const failures = sourceFiles(join(repositoryRoot, "src/backend"))
    .filter((path) => forbiddenNeutralFacts.test(readFileSync(path, "utf8")))
    .map((path) => path.slice(repositoryRoot.length + 1));

  assert.deepEqual(failures, []);
});

test("Rust-flavoured flow aliases are imported only from the Rust module", () => {
  for (const file of ["test/backend/planner/expressions/native-classes-enums-and-storage.test.mjs", "test/policy/operations/operator-traits.test.mjs"]) {
    const text = source(file);
    assert.doesNotMatch(
      text,
      /import\s*\{[^}]*\b(?:ref|mut)\b[^}]*\}\s*from\s*"@tsonic\/core\/lang\.js"/u,
    );
  }
});
