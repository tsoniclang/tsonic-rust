import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRust } from "../../../helpers/rust-session.mjs";
import { memoryAbiCapability, rawAddressProofSource } from "../../../helpers/memory-abi.mjs";
import { nativeArrayProofSource } from "../../../helpers/native-record-proof.mjs";
import { rustTargetTypeRefEquals } from "../../../../dist/target-model/types/equality.js";
import { rustEffectiveValueCarrier } from "../../../../dist/analysis/conversions/value-carrier-queries.js";

function nodesOf(source, program) {
  const nodes = [];
  const visit = node => {
    nodes.push(node);
    source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  program.sourceFiles.forEach(visit);
  return nodes;
}

test("source native arrays publish exact checked aliases, literals and element owner declarations", () => {
  const { source, program } = analyzeRust({ capabilities: [memoryAbiCapability("rust")],
    files: { "index.ts": nativeArrayProofSource + "\nmain();\n" } });
  const nodes = nodesOf(source, program);
  const identities = new Set(nodes);
  const counts = { binding: 0, reference: 0, literal: 0, element: 0 };
  for (const node of nodes) {
    const record = program.records.nativeArrayStorage.get(node);
    if (record === undefined) continue;
    counts[record.kind] += 1;
    assert.equal(record.stride, 8);
    assert.equal(record.layout.pointeeCarrier.name, "uint32");
    assert.equal(Object.isFrozen(record), true);
    if (record.kind === "element") {
      assert.equal(source.ast.is.IsElementAccessExpression(node), true);
      assert.equal(identities.has(record.declaration), true, "owner is an exact checked declaration");
      assert.equal(program.records.nativeArrayStorage.get(record.declaration)?.kind, "binding");
    }
  }
  for (const [kind, count] of Object.entries(counts)) assert.equal(count > 0, true, kind);
});

test("raw-location and native-backing source records preserve the selected parameter and operand identities", () => {
  const { source, program } = analyzeRust({ capabilities: [memoryAbiCapability("rust")], files: { "index.ts": `
import { abi } from "test:abi";
import { memorylayout, addressof, torawptr, reinterpretrawptr, unsafecontext } from "@tsonic/core/lang.js";
import type { uint32 } from "@tsonic/core/types.js";
const word = memorylayout<uint32>({ datalayout: abi, bytesize: 4, bytealignment: 4, stride: 4, fields: [] });
export function convert(value: uint32 = 7) {
  unsafecontext();
  const pointer = addressof(value);
  return reinterpretrawptr(torawptr(pointer, word), word);
}` } });
  const nodes = nodesOf(source, program);
  const operations = new Set();
  let backingCount = 0;
  for (const node of nodes) {
    const backing = program.records.nativeBacking.get(node);
    if (backing !== undefined) {
      backingCount += 1;
      assert.equal(source.ast.is.IsParameterDeclaration(node), true);
      assert.equal(backing.pointeeCarrier.name, "uint32");
    }
    const record = program.records.rawLocationPlan.get(node);
    if (record === undefined) continue;
    operations.add(record.operation);
    assert.equal(source.ast.is.IsCallExpression(node), true);
    assert.equal(record.expression === source.ast.arguments(node)[0], true, "the exact checked operand is retained");
    assert.equal(record.layout.pointeeCarrier.name, "uint32");
    assert.equal(Object.isFrozen(record), true);
    assert.equal(rustTargetTypeRefEquals(record.inputCarrier, rustEffectiveValueCarrier(program.records, record.expression)), true);
  }
  assert.equal(backingCount, 1);
  assert.deepEqual([...operations].sort(), ["reinterpret", "to-raw"]);
});

test("source raw-address publication retains all operation forms and exact native argument identities", () => {
  const { source, program } = analyzeRust({ capabilities: [memoryAbiCapability("rust")],
    files: { "index.ts": rawAddressProofSource } });
  const methods = new Set();
  for (const node of nodesOf(source, program)) {
    const record = program.records.rawAddressPlan.get(node);
    if (record === undefined) continue;
    methods.add(record.method);
    const arguments_ = source.ast.arguments(node);
    record.arguments.forEach((argument, index) => assert.equal(argument.expression === arguments_[index], true,
      `${record.method}:${index}: exact checked argument`));
    assert.equal(Object.isFrozen(record), true);
    assert.equal(Object.isFrozen(record.arguments), true);
    if ("width" in record) assert.equal(record.width, 64);
    if (record.method === "address") assert.equal(record.resultCarrier.name, "uint64");
  }
  assert.deepEqual([...methods].sort(), ["address", "from_address", "hash", "offset", "offset_unsigned", "same"]);
});

for (const value of [false, true]) {
  test(`source ${value ? "value" : "reference"} bound records retain the exact checked field locations`, () => {
    const { source, program } = analyzeRust({ capabilities: [memoryAbiCapability("rust")], files: { "index.ts": `
import { abi } from "test:abi";
import { memorylayout, memoryfield, bindmemoryfield, bindmemoryrecord, allocateptr, struct, field } from "@tsonic/core/lang.js";
import type { uint32 } from "@tsonic/core/types.js";
${value ? "const Cell = struct({ value: field<uint32>() }); type Cell = typeof Cell;" : "type Cell = { value: uint32 };"}
const scalar = memorylayout<uint32>({ datalayout: abi, bytesize: 4, bytealignment: 4, stride: 4, fields: [] });
const slot = memoryfield({ select: (value: Cell) => value.value, byteoffset: 0, bytealignment: 4, fieldlayout: scalar });
const layout = memorylayout<Cell>({ datalayout: abi, bytesize: 4, bytealignment: 4, stride: 4, fields: [slot] });
export function create(value: uint32): Cell { return bindmemoryrecord(layout, bindmemoryfield(slot, allocateptr(value))); }
` } });
    const counts = { field: 0, record: 0 };
    for (const node of nodesOf(source, program)) {
      const record = program.records.memoryBindingPlan.get(node);
      if (record === undefined) continue;
      counts[record.kind] += 1;
      const arguments_ = source.ast.arguments(node);
      if (record.kind === "field") assert.equal(record.expression === arguments_[1], true, "exact bound pointer");
      else {
        assert.equal(record.fields.length > 0, true);
        assert.equal(Object.isFrozen(record.fields), true);
        const indices = new Set();
        for (const field of record.fields) {
          assert.equal(arguments_.includes(field.expression), true, "field retains its checked binding expression");
          assert.equal(indices.has(field.storageIndex), false, "one exact storage member per binding");
          indices.add(field.storageIndex);
        }
      }
      assert.equal(Object.isFrozen(record), true);
    }
    assert.equal(counts.field > 0 && counts.record > 0, true, "both actual source producer paths execute");
  });
}

test("empty bound source records publish present zero-field decisions rather than missing evidence", () => {
  const { source, program } = analyzeRust({ capabilities: [memoryAbiCapability("rust")], files: { "index.ts": `
import { abi } from "test:abi";
import { memorylayout, bindmemoryrecord } from "@tsonic/core/lang.js";
const layout = memorylayout<{}>({ datalayout: abi, bytesize: 0, bytealignment: 1, stride: 0, fields: [] });
export function create(): {} { return bindmemoryrecord(layout); }
` } });
  let count = 0;
  for (const node of nodesOf(source, program)) {
    const record = program.records.memoryBindingPlan.get(node);
    if (record === undefined) continue;
    count += 1;
    assert.equal(record.kind, "record");
    assert.equal(record.fields.length, 0);
    assert.equal(Object.isFrozen(record.fields), true);
  }
  assert.equal(count > 0, true);
});
