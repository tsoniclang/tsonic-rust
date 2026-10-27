import { assertRustRecordRequirement } from "../../../helpers/required-records.mjs";

function selectedLayoutObservation(program, node) {
  const handler = program.records.nativeHandler.get(node);
  return handler?.kind === "native-pointer" && handler.selection.kind === "layout-query" ? handler.selection.observation : undefined;
}
import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust, compileRust } from "../../../helpers/rust-session.mjs";
import { memoryAbiCapability } from "../../../helpers/memory-abi.mjs";
import { recordRustInlineModuleCallableUses } from "../../../../dist/analysis/callables/values/module-values.js";
import { createRustProgramRecordBuilder } from "../../../../dist/analysis/program/records/create.js";
import { analyzeRustErrorEffects } from "../../../helpers/rust-error-analysis.mjs";
import { resolveExpressionCarrier } from "../../../../dist/analysis/source-evidence/types/resolution/expression-carriers.js";

function checkedNodes(program) {
  const nodes = [];
  const visit = node => {
    nodes.push(node);
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  return nodes;
}

function named(program, name) {
  const { ast } = program.source;
  const result = checkedNodes(program).find(node => ast.is.IsVariableDeclaration(node) && ast.text(ast.name(node)) === name);
  assert.equal(result !== undefined, true, name);
  return result;
}

test("forward receiver mutation publishes one final mode per class or interface method", () => {
  const calls = new Map();
  const context = analyzeRustErrorEffects(`
    interface Reader { read(): number; }
    interface Builder { new(): Counter; }
    class Counter {
      value = 0;
      chain(): void { this.change(); }
      change(): void { this.value += 1; }
      read(): number { return this.value; }
      static identity(value: number): number { return value; }
    }
    export function run(): number { const counter = new Counter(); counter.chain(); return counter.read(); }
  `, { surfaces: [] }, current => ({ ...current, records: { ...current.records,
    selfModes: { ...current.records.selfModes, method(member, mode) {
      calls.set(member, (calls.get(member) ?? 0) + 1);
      current.records.selfModes.method(member, mode);
    } },
  } }));
  const declaration = context.sourceStorage.nodes.find(node => context.ast.is.IsClassDeclaration(node));
  const definition = context.projectTypes.definitionForDeclaration(declaration);
  assert.equal(context.objectRepresentations.representationFor(definition)?.kind, "value",
    "mut-ref is the native value-receiver contract, not the shared receiver contract");
  assert.equal(calls.size, 4, "three instance methods and one interface method signature");
  for (const [member, count] of calls) {
    const name = context.ast.text(context.ast.name(member));
    assert.equal(count, 1, name);
    assert.equal(context.records.selfMode.get(member)?.mode,
      name === "chain" || name === "change" ? "mut-ref" : "ref", name);
  }
  const excluded = context.sourceStorage.nodes.filter(node => context.ast.is.IsConstructSignatureDeclaration(node) ||
    context.ast.is.IsMethodDeclaration(node) && context.ast.hasModifierKind(node, "static"));
  assert.equal(excluded.length, 2);
  assert.equal(excluded.every(node => !calls.has(node) && context.records.selfMode.get(node) === undefined), true);
});

test("actual layout carrier queries reuse one zero-valued observation per checked call", () => {
  const calls = new Map();
  let walk;
  const context = analyzeRustErrorEffects(`
    import { abi } from "test:abi";
    import { memorylayout, sizeof, strideof } from "@tsonic/core/lang.js";
    import type { nativeUint } from "@tsonic/core/types.js";
    const empty = memorylayout<{}>({ datalayout: abi, bytesize: 0, bytealignment: 1, stride: 0, fields: [] });
    export function read(): nativeUint { return sizeof(empty) + strideof(empty); }
  `, { surfaces: [], capabilities: [memoryAbiCapability("rust")] }, current => ({ ...current,
    records: { ...current.records,
      typeOnlyDeclarations: { ...current.records.typeOnlyDeclarations,
        finalize(selected, files) { walk = selected; return current.records.typeOnlyDeclarations.finalize(selected, files); } },
      memoryLayoutObservations: { ...current.records.memoryLayoutObservations, observe(expression, value) {
        calls.set(expression, (calls.get(expression) ?? 0) + 1);
        current.records.memoryLayoutObservations.observe(expression, value);
      } },
    },
  }));
  assert.equal(walk !== undefined, true);
  assert.equal(calls.size, 2);
  for (const [expression, count] of calls) {
    const fact = context.records.memoryLayoutObservation.get(expression);
    const carrier = context.records.runtimeCarrier.get(expression)?.carrier;
    assert.equal(count, 1);
    assert.equal(fact.value, 0n, "zero is present selected metadata");
    for (let attempt = 0; attempt < 3; attempt++) {
      assert.equal(resolveExpressionCarrier(walk, expression, context.ast.getSourceFile(expression), undefined) === carrier, true);
      assert.equal(context.records.memoryLayoutObservation.get(expression) === fact, true);
    }
    assert.equal(calls.get(expression), 1, "cached source resolution does not call the actual constructor again");
  }
});

for (const surfaces of [[], ["js"]]) {
  const surface = surfaces[0] ?? "native";

  test(`value-struct declarations and their exact initializers are erased, not ordinary same-named calls, in ${surface}`, () => {
    const { program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, surfaces, files: { "index.ts": `
      import { struct as valueRecord, field as valueField } from "@tsonic/core/lang.js";
      import type { uint32 } from "@tsonic/core/types.js";
      const Point = valueRecord({ count: valueField<uint32>() });
      type Point = typeof Point;
      function struct(value: uint32): uint32 { return value; }
      export function run(): uint32 { const value: Point = { count: 4 }; return struct(value.count); }
    ` } });
    const { ast } = program.source;
    const declaration = named(program, "Point");
    const initializer = ast.as.AsVariableDeclaration(declaration).Initializer;
    assert.equal(initializer !== undefined, true);
    assert.equal(program.records.compileTimeSource.get(declaration), true);
    assert.equal(program.records.compileTimeSource.get(initializer), true);
    assertRustRecordRequirement(requiredRecords, "compileTimeSource", declaration);
    assertRustRecordRequirement(requiredRecords, "compileTimeSource", initializer);
    const selected = checkedNodes(program).filter(node => program.records.compileTimeSource.get(node) === true);
    // The variable statement whose only declaration is compile-time source is erased with it (cbc9f57ad).
    const statement = ast.parent(ast.parent(declaration));
    assert.equal(ast.is.IsVariableStatement(statement), true);
    assert.equal(selected.length, 3, "only the exact struct declaration, its initializer and its statement are erased");
    for (const node of [declaration, initializer, statement]) assert.equal(selected.includes(node), true, "exact erased struct source");
    const call = checkedNodes(program).find(node => ast.is.IsCallExpression(node) && ast.text(ast.as.AsCallExpression(node).Expression) === "struct");
    assert.equal(call !== undefined, true, "ordinary same-named function call is present");
    assert.equal(program.records.compileTimeSource.get(call) === undefined, true, "spelling never selects erasure");
    assert.equal(requiredRecords.some(row => row.family === "compileTimeSource" && row.subject === call), false);
    assert.equal(program.records.compileTimeSource.get(named(program, "value")) === undefined, true);
    assert.equal(program.records.compileTimeSource.set === undefined, true);
  });

  test(`method receiver facts preserve selected read, write, accessor and interface modes in ${surface}`, () => {
    const { program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, surfaces, files: { "index.ts": `
      interface Reader { read(): number; }
      class Counter {
        value = 1;
        get current(): number { return this.value; }
        set current(next: number) { this.value = next; }
        read(): number { return this.value; }
        change(): void { this.value += 1; }
        static identity(value: number): number { return value; }
      }
      export function run(): number {
        const counter = new Counter();
        counter.change(); counter.current = 4;
        return counter.read() + counter.current;
      }
      export function selected(reader: Reader): number { return reader.read(); }
    ` } });
    const { ast } = program.source;
    const expected = new Map([
      ["KindMethodSignature:read", "ref"],
      ["KindGetAccessor:current", "ref"],
      ["KindSetAccessor:current", "mut-ref"],
      ["KindMethodDeclaration:read", "ref"],
      ["KindMethodDeclaration:change", "mut-ref"],
    ]);
    let published = 0;
    for (const node of checkedNodes(program)) {
      const fact = program.records.selfMode.get(node);
      if (fact === undefined) continue;
      const key = `${ast.kindName(node)}:${ast.text(ast.name(node))}`;
      assert.equal(expected.has(key), true, key);
      assert.equal(fact.mode, expected.get(key), key);
      assert.equal(Object.isFrozen(fact), true, key);
      if (ast.kindName(node) !== "KindMethodSignature") {
        assert.equal(fact.mode, program.objectRepresentations.methodSelfMode(node), "the producer preserves the chosen native mode");
      }
      expected.delete(key);
      published++;
    }
    assert.equal(published, 5);
    assert.equal(expected.size, 0, "all independently selected receiver kinds are published");
    const staticMethod = checkedNodes(program).find(node => ast.is.IsMethodDeclaration(node) && ast.text(ast.name(node)) === "identity");
    assert.equal(staticMethod !== undefined, true);
    assert.equal(program.records.selfMode.get(staticMethod) === undefined, true, "a static method has no receiver");
    assert.equal(program.records.selfMode.set === undefined, true);
  });

  test(`memory metadata is erased and every exact scalar observation, including zero, is retained in ${surface}`, () => {
    const { program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, surfaces, capabilities: [memoryAbiCapability("rust")], files: { "index.ts": `
      import { abi } from "test:abi";
      import { memorylayout, memoryfield, sizeof, alignof, strideof, fieldoffsetof } from "@tsonic/core/lang.js";
      import type { uint32, uint8, nativeUint } from "@tsonic/core/types.js";
      interface Header { tag: uint8; count: uint32; }
      const byte = memorylayout<uint8>({ datalayout: abi, bytesize: 1, bytealignment: 1, stride: 1, fields: [] });
      const word = memorylayout<uint32>({ datalayout: abi, bytesize: 4, bytealignment: 4, stride: 4, fields: [] });
      const tag = memoryfield({ select: (value: Header) => value.tag, byteoffset: 0, bytealignment: 1, fieldlayout: byte });
      const header = memorylayout<Header>({ datalayout: abi, bytesize: 8, bytealignment: 4, stride: 8, fields: [tag,
        memoryfield({ select: (value: Header) => value.count, byteoffset: 4, bytealignment: 4, fieldlayout: word })] });
      const alias = header;
      const empty = memorylayout<{}>({ datalayout: abi, bytesize: 0, bytealignment: 1, stride: 0, fields: [] });
      export function run(): nativeUint {
        return sizeof(alias) + alignof(alias) + strideof(alias) + fieldoffsetof(alias, value => value.count) +
          fieldoffsetof(alias, value => value.tag) + sizeof(empty) + strideof(empty) + alignof(empty);
      }
    ` } });
    const { ast } = program.source;
    for (const name of ["byte", "word", "tag", "header", "alias", "empty"]) {
      assertRustRecordRequirement(requiredRecords, "compileTimeSource", named(program, name));
      assert.equal(program.records.compileTimeSource.get(named(program, name)), true, name);
    }
    const expectedCalls = checkedNodes(program).filter(node => ast.is.IsCallExpression(node) &&
      ["sizeof", "alignof", "strideof", "fieldoffsetof"].includes(ast.text(ast.as.AsCallExpression(node).Expression)));
    assert.equal(expectedCalls.length, 8);
    for (const call of expectedCalls) {
      assertRustRecordRequirement(requiredRecords, "memoryLayoutObservation", call);
      assertRustRecordRequirement(requiredRecords, "compileTimeSource", ast.arguments(call)[0]);
    }
    const observations = checkedNodes(program).filter(node => selectedLayoutObservation(program, node) !== undefined);
    assert.equal(observations.length, 8);
    assert.deepEqual(observations.map(node => selectedLayoutObservation(program, node).value), [8n, 4n, 8n, 4n, 0n, 0n, 0n, 1n]);
    for (const node of observations) {
      assert.equal(ast.is.IsCallExpression(node), true, "the observation is attached to the exact checked call");
      const record = selectedLayoutObservation(program, node);
      assert.equal(Object.isFrozen(record), true);
      const carrier = program.records.runtimeCarrier.get(node)?.carrier;
      assert.equal(carrier?.kind, "source-primitive");
      assert.equal(carrier.name, "native-uint");
      assert.equal(program.records.compileTimeSource.get(ast.arguments(node)[0]), true, "the metadata operand is erased, not evaluated");
    }
    assert.equal(selectedLayoutObservation(program, {}) === undefined, true, "no shape-based layout observation");
    assert.equal(program.records.nativeHandler.set === undefined, true);
    assert.equal(Object.hasOwn(program.records, "memoryLayoutObservation"), false);
  });

  test(`ordinary sizeof spelling publishes no layout observation in ${surface}`, () => {
    const { program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, surfaces, files: { "index.ts": `
      function sizeof(value: number): number { return value; }
      export function run(): number { return sizeof(4); }
    ` } });
    assert.equal(checkedNodes(program).some(node => selectedLayoutObservation(program, node) !== undefined), false);
    assert.equal(checkedNodes(program).some(node => program.records.compileTimeSource.get(node) !== undefined), false);
    assert.equal(requiredRecords.some(row => row.family === "memoryLayoutObservation"), false);
  });
}

test("checked JS source-profile callable aliases erase exactly their immutable alias declarations", () => {
  const { program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, surfaces: ["js"], files: { "index.ts": `
    const absolute = Math.abs;
    const parse = parseInt;
    export function run(value: string): number { return absolute(parse(value, 10)); }
  ` } });
  const declarations = [named(program, "absolute"), named(program, "parse")];
  for (const declaration of declarations) assertRustRecordRequirement(requiredRecords, "compileTimeSource", declaration);
  const selected = checkedNodes(program).filter(node => program.records.compileTimeSource.get(node) === true);
  // Each alias is the only declaration of its statement, so the statement is erased with it (cbc9f57ad).
  const statements = declarations.map(declaration => program.source.ast.parent(program.source.ast.parent(declaration)));
  assert.equal(statements.every(statement => program.source.ast.is.IsVariableStatement(statement)), true);
  assert.equal(selected.length, 4);
  for (const node of [...declarations, ...statements]) assert.equal(selected.includes(node), true, "exact checked alias");
});

test("inline module alias transport erases only selected checked declarations when storage is elided", () => {
  const { program, requiredRecords } = analyzeRust({ captureRequiredRecords: true, files: { "index.ts": `
    function step(value: number): number { return value; }
    export function run(): number { const callback = step; return callback(2); }
  ` } });
  const declaration = named(program, "callback");
  const { ast } = program.source;
  const reference = ast.as.AsVariableDeclaration(declaration).Initializer;
  const records = createRustProgramRecordBuilder();
  const selection = { stored: false, declarationValue: false, uses: [], aliases: [{
    declarations: [declaration], references: [], producer: {},
  }] };
  const elidedRequirements = [];
  recordRustInlineModuleCallableUses({ context: { requiredRecords: elidedRequirements, records } }, selection);
  assertRustRecordRequirement(elidedRequirements, "compileTimeSource", declaration);
  assert.equal(elidedRequirements.some(row => row.subject === reference), false);
  assert.equal(records.compileTimeSource.get(declaration), true, "the exact selected alias is erased");
  assert.equal(records.compileTimeSource.get(reference) === undefined, true, "erasure does not spread to its initializer");
  const retained = createRustProgramRecordBuilder();
  const storedRequirements = [];
  recordRustInlineModuleCallableUses({ context: { requiredRecords: storedRequirements, records: retained } }, { ...selection, stored: true });
  assert.equal(storedRequirements.length, 0);
  assert.equal(retained.compileTimeSource.get(declaration) === undefined, true, "stored callable identity is preserved");
});

test("unproved struct fields reject before any compile-time source can become emitted code", () => {
  assert.throws(() => compileRust({ files: { "index.ts": `
    import { struct } from "@tsonic/core/lang.js";
    import type { uint32 } from "@tsonic/core/types.js";
    function value(): uint32 { return 1; }
    const Point = struct({ count: value() });
  ` } }), /TSEXT9901109: struct\(\.\.\.\) field shape members require finalized field<T>\(\) facts/u);
});
