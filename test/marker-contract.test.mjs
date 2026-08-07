import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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

test("Rust source modules expose only the approved native aliases", () => {
  const modules = source("src/source/rust-source-semantics/source-modules.ts");
  const primitiveAliases = [...modules.matchAll(/sourcePrimitive\("([^"]+)",\s*"([^"]+)"/gu)]
    .map((match) => [match[1], match[2]]);
  const callAliases = [...modules.matchAll(/exportName:\s*"([^"]+)",\s*marker:\s*"([^"]+)"/gu)]
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
    ["f32", "float32"],
    ["f64", "float64"],
  ]);
  assert.deepEqual(callAliases, [
    ["borrow", "shared-borrow"],
    ["borrowMut", "mutable-borrow"],
    ["move", "move"],
  ]);
  assert.doesNotMatch(
    modules,
    /sourcePrimitive\("(?:i128|u128|isize|usize|char)"|marker:\s*"(?:pointer|function-pointer)"/u,
  );
});

test("Rust converts typed-location facts into one target-owned disposition", () => {
  const operations = source(
    "src/source/rust-target-semantics/operations-provider.ts",
  );
  const disposition = source(
    "src/source/rust-target-semantics/typed-location-disposition.ts",
  );

  assert.doesNotMatch(operations, /pointerOperationFactKey/u);
  assert.match(operations, /selectRustTypedLocationDisposition/u);
  assert.match(disposition, /pointerOperationFactKey/u);
  assert.match(disposition, /kind:\s*"unsupported"/u);
  assert.doesNotMatch(
    disposition,
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
  for (const file of ["test/native-semantics.test.mjs", "test/operator-traits.test.mjs"]) {
    const text = source(file);
    assert.doesNotMatch(
      text,
      /import\s*\{[^}]*\b(?:borrow|borrowMut)\b[^}]*\}\s*from\s*"@tsonic\/core\/lang\.js"/u,
    );
  }
});
