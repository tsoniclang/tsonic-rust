import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { analyzeRust } from "../../../helpers/rust-session.mjs";

function checkedNodes(program) {
  const nodes = [];
  const visit = node => {
    nodes.push(node);
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  return nodes;
}

function named(program, predicate, name) {
  const { ast } = program.source;
  const found = checkedNodes(program).find(node => predicate(node) && ast.text(ast.name(node)) === name);
  assert.equal(found !== undefined, true, name);
  return found;
}

const aliasSource = `
import type { Life, Ref } from "@tsonic/rust/types.js";
import type { int32 } from "@tsonic/core/types.js";
type Mode = "on" | "off";
type Count = number;
type Borrowed<Region extends Life> = Ref<int32, Region>;
type Item = { readonly value: number; readonly next: Chain };
type Chain = Item | undefined;
export function pick(mode: Mode): Mode { return mode; }
export function add(left: Count, right: Count): Count { return left + right; }
export function keep<Region extends Life>(value: Borrowed<Region>): Borrowed<Region> { return value; }
export function first(chain: Chain): number { return chain === undefined ? 0 : chain.value; }
export function local(): number { type Local = number; const value: Local = 3; return value; }
`;

const familySource = `
export declare const storageKey: unique symbol;
export interface Stored<S> { readonly [storageKey]: S; }
export type Storage<T> = T extends Stored<infer S> ? S : T;
export function select<T>(value: Storage<T>): Storage<T> { return value; }
`;

for (const surfaces of [[], ["js"]]) {
  const surface = surfaces[0] ?? "native";

  test(`type-alias declarations publish their exact selected form on the alias declaration in ${surface}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": aliasSource } });
    const { ast } = program.source;
    const alias = name => named(program, node => ast.kindName(node) === "KindTypeAliasDeclaration", name);
    const mode = program.records.typeAliasDeclaration.get(alias("Mode"));
    assert.equal(mode?.kind, "string-literal");
    assert.deepEqual(mode.variants.map(variant => variant.literal).sort(), ["off", "on"]);
    assert.equal(program.records.typeAliasDeclaration.get(alias("Count"))?.kind, "erased");
    assert.equal(program.records.typeAliasDeclaration.get(alias("Item"))?.kind, "erased");
    const borrowed = program.records.typeAliasDeclaration.get(alias("Borrowed"));
    assert.equal(borrowed?.kind, "native-alias");
    assert.equal(borrowed.target.kind, "reference");
    const chain = program.records.typeAliasDeclaration.get(alias("Chain"));
    assert.equal(chain?.kind, "runtime");
    assert.equal(chain.variants.length > 0, true);
    assert.equal(program.records.typeAliasDeclaration.get(alias("Local"))?.kind, "erased", "a function-local alias is registered by the statement owner");
    for (const name of ["Mode", "Count", "Borrowed", "Item"]) {
      assert.equal(program.records.runtimeCarrier.get(alias(name)) !== undefined, true, `${name}: declaration carrier recorded`);
    }
    assert.equal(program.records.typeAliasDeclaration.get({}) === undefined, true);
    assert.equal(program.records.typeAliasDeclaration.set === undefined, true);
  });

  test(`a conditional storage family alias is published as the family owner in ${surface}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": familySource } });
    const { ast } = program.source;
    const storage = named(program, node => ast.kindName(node) === "KindTypeAliasDeclaration", "Storage");
    assert.equal(program.records.typeAliasDeclaration.get(storage)?.kind, "family");
  });

  test(`binding writes mark the binding and writes through a binding mark its referent in ${surface}`, () => {
    const { program } = analyzeRust({ surfaces, files: { "index.ts": `
      class Box { value = 0; }
      export function run(values: number[], box: Box): number {
        let total = 0;
        for (const value of values) { total += value; }
        let reset = 1;
        (reset) = 2;
        box.value = total + reset;
        return total;
      }
    ` } });
    const { ast } = program.source;
    const variable = name => named(program, node => ast.is.IsVariableDeclaration(node), name);
    const parameter = name => named(program, node => ast.kindName(node) === "KindParameter", name);
    for (const name of ["total", "reset"]) {
      assert.deepEqual(program.records.mutatedBinding.get(variable(name)), { mutated: true }, name);
      assert.equal(program.records.mutatedReferent.get(variable(name)) === undefined, true, name);
    }
    assert.deepEqual(program.records.mutatedReferent.get(parameter("box")), { mutated: true });
    assert.equal(program.records.mutatedBinding.get(parameter("box")) === undefined, true, "the parameter binding is not reassigned");
    assert.equal(program.records.mutatedBinding.get(variable("value")) === undefined, true, "a const loop binding is not written");
    assert.equal(program.records.mutatedBinding.get(parameter("values")) === undefined, true);
    assert.equal(program.records.mutatedBinding.set === undefined, true);
    assert.equal(program.records.mutatedReferent.set === undefined, true);
  });
}

test("in-place string append and iteration assignment mark the written binding", () => {
  const { program } = analyzeRust({ surfaces: ["js"], files: { "index.ts": `
    import type { nativeUint } from "@tsonic/core/types.js";
    export function combine(values: string[]): string {
      let output = "";
      for (let index: nativeUint = 0; index < values.length; index++) { output += values[index]!; }
      return output;
    }
    export function last(values: string[]): string { let item = ""; for (item of values) { } return item; }
  ` } });
  const { ast } = program.source;
  for (const name of ["output", "index", "item"]) {
    const declaration = named(program, node => ast.is.IsVariableDeclaration(node), name);
    assert.deepEqual(program.records.mutatedBinding.get(declaration), { mutated: true }, name);
  }
});

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const directory = resolve(root, ".temp/type-alias-mutation-type-proof");
const compiler = resolve(root, "../tsonic/node_modules/.bin/tsgo");

function compile(name, text) {
  mkdirSync(directory, { recursive: true });
  const file = resolve(directory, `${name}.ts`);
  writeFileSync(file, text);
  const project = resolve(directory, `${name}.json`);
  writeFileSync(project, JSON.stringify({ extends: resolve(root, ".temp/build/tsconfig.canonical-tsonic.json"),
    compilerOptions: { rootDir: directory, noEmit: true, noUnusedLocals: false, noUnusedParameters: false }, include: [file] }));
  return spawnSync(compiler, ["--project", project, "--pretty", "false"], {
    cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 262_144,
  });
}

const declarations = `
  import type { Node } from "@tsonic/tsts";
  import type { RustProgramRecordBuilder } from "../../dist/analysis/program/records/model.js";
  import type { RustProgramRecords } from "../../dist/target-model/records/program.js";
  import type { RustFactWalk } from "../../dist/analysis/program/walk.js";
  import type { TargetTypeRef } from "../../dist/target-model/types/model.js";
  declare const builder: RustProgramRecordBuilder;
  declare const records: RustProgramRecords;
  declare const walk: RustFactWalk;
  declare const subject: Node;
  declare const carrier: TargetTypeRef;
`;
const families = ["typeAliasDeclaration", "mutatedBinding", "mutatedReferent"];
const producers = ["typeAliasDeclarations", "mutatedBindings", "mutatedReferents"];

test("the type-alias and mutation producers accept their exact checked inputs", () => {
  const result = compile("accepted", `${declarations}
    builder.typeAliasDeclarations.register(walk, subject);
    builder.mutatedBindings.written(subject);
    builder.mutatedReferents.written(subject);
    const sealed: RustProgramRecords = builder;
    const kind: "family" | "string-literal" | "runtime" | "native-alias" | "erased" | undefined = sealed.typeAliasDeclaration.get(subject)?.kind;
    const mutated: true | undefined = sealed.mutatedBinding.get(subject)?.mutated;
  `);
  assert.equal(result.error === undefined, true, result.error?.message);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("removed general writes, leaked producers and malformed producer inputs fail strict source checking", () => {
  const result = compile("rejected", `${declarations}
    ${families.map(family => `builder.${family}.set(subject, undefined);`).join("\n")}
    ${families.map(family => `records.${family}.set(subject, undefined);`).join("\n")}
    ${producers.map(producer => `records.${producer};`).join("\n")}
    builder.typeAliasDeclarations.register(subject, subject);
    builder.mutatedBindings.written(carrier);
    builder.mutatedReferents.written(subject, { mutated: true });
  `);
  assert.equal(result.error === undefined, true, result.error?.message);
  assert.equal(result.status === 0, false, "every removed or malformed form must fail source checking");
  const codes = [...result.stdout.matchAll(/error TS(\d+):/gu)].map(match => Number(match[1]));
  assert.deepEqual(codes, [...Array(6).fill(2339), ...Array(3).fill(2551), 2740, 2345, 2554], result.stdout);
});

test("the three superseded keys and the type-alias forwarder are deleted rather than kept as alternate routes", () => {
  const result = compile("removed-keys", `
    import { rustTypeAliasDeclarationFactKey } from "../../dist/analysis/program/records/keys/callables-and-resources.js";
    import { rustMutatedBindingFactKey, rustMutatedReferentFactKey } from "../../dist/analysis/program/records/keys/value-projections.js";
    import { registerTypeAlias } from "../../dist/analysis/declarations/types-and-bindings.js";
  `);
  assert.equal(result.error === undefined, true, result.error?.message);
  assert.equal(result.status === 0, false, "no removed key or forwarder has a surviving import path");
  assert.deepEqual([...result.stdout.matchAll(/error TS(\d+):/gu)].map(match => Number(match[1])), [2305, 2724, 2305, 2305], result.stdout);
});
