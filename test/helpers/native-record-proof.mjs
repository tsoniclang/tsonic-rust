import { createRustProviderPackage } from "../../dist/public/provider.js";

export function nativeRecordProvider(cratePath, { missingField = false, wrongField = false, missingContract = false } = {}) {
  const moduleSpecifier = "test:records";
  const byte = { kind: "source-primitive", name: "uint8" };
  const word = { kind: "source-primitive", name: "uint32" };
  const header = { kind: "target-named", id: "native.record.Header" };
  const envelope = { kind: "target-named", id: "native.record.Envelope" };
  const reference = name => ({ kind: "provider-ref", moduleSpecifier, exportName: name });
  const records = [
    ["Header", header, [["tag", "tag_byte", byte, byte], ["count", "units", word, word]]],
    ["Envelope", envelope, [["prefix", "lead", byte, byte], ["header", "record", reference("Header"), header]]],
  ];
  const fieldId = (record, name) => `source.${record}.${name}`;
  return createRustProviderPackage({ id: "native-record-proof", displayName: "Native record proof", version: "1",
    modules: [{ moduleSpecifier, providerModuleId: "native.records", exports: [
      ...records.map(([name, , fields]) => ({ id: `source.${name}`, name, kind: "interface",
        members: fields.map(([field, , type]) => ({ id: fieldId(name, field), name: field, kind: "property", type })) })),
      { id: "source.create", name: "create", kind: "function", signatures: [{ id: "source.create.signature",
        parameters: [{ name: "prefix", type: byte }, { name: "tag", type: byte }, { name: "count", type: word }], returnType: reference("Envelope") }] },
    ] }],
    types: records.map(([name, targetCarrier, fields]) => ({ exportId: `source.${name}`, targetCarrier,
      ...(missingContract ? {} : { nativeMemoryFieldIds: fields.filter(([field]) => !missingField || field !== "count").map(([field]) => fieldId(name, field)) }) })),
    carrierPaths: { [header.id]: "native_memory_proof::Header", [envelope.id]: "native_memory_proof::Envelope" },
    carrierTraits: Object.fromEntries(records.map(([, carrier]) => [carrier.id, { implementations: [
      { traitPath: "core::clone::Clone", requirements: [] }, { traitPath: "core::marker::Copy", requirements: [] },
    ] }])),
    operations: [
      { exportId: "source.create", signatureId: "source.create.signature", operationKind: "method",
        target: { form: "call", path: "native_memory_proof::create_envelope" }, parameterCarriers: [byte, byte, word], resultCarrier: envelope },
      ...records.flatMap(([name, receiverCarrier, fields]) => fields.flatMap(([field, targetName, , carrier]) => [
        { exportId: `source.${name}`, memberId: fieldId(name, field), operationKind: "property",
          target: { form: "field", name: targetName }, receiverCarrier, resultCarrier: wrongField && field === "count" ? byte : carrier },
        { exportId: `source.${name}`, memberId: fieldId(name, field), operationKind: "property-set",
          target: { form: "field", name: targetName }, receiverCarrier, parameterCarriers: [carrier], resultCarrier: { kind: "tuple", elements: [] } },
      ])),
    ], crates: [{ crateName: "native_memory_proof", cargoPath: cratePath }],
  });
}

export const nativeRecordProofSource = `
import { abi } from "test:abi";
import { create } from "test:records";
import type { Header, Envelope } from "test:records";
import { memoryLayout, memoryField, allocatePointer, toRawPointer, reinterpretRawPointer,
  loadPointer, storePointer, offsetRawPointer, equalPointer, unsafeContext } from "@tsonic/core/lang.js";
import type { uint8, uint32 } from "@tsonic/core/types.js";
const byte = memoryLayout<uint8>(abi, 1, 1, 1);
const word = memoryLayout<uint32>(abi, 4, 4, 4);
const packedWord = memoryLayout<uint32>(abi, 4, 1, 4);
const header = memoryLayout<Header>(abi, 8, 4, 8,
  memoryField((value: Header) => value.tag, 0, 1, byte),
  memoryField((value: Header) => value.count, 4, 4, word));
const envelope = memoryLayout<Envelope>(abi, 9, 1, 9,
  memoryField((value: Envelope) => value.prefix, 0, 1, byte),
  memoryField((value: Envelope) => value.header, 1, 1, header));
export function main(): void {
  unsafeContext();
  const pointer = allocatePointer<Envelope>(create(1, 2, 7));
  const raw = toRawPointer(pointer, envelope);
  const saved = loadPointer(pointer);
  const alias = reinterpretRawPointer(raw, envelope);
  const count = reinterpretRawPointer(offsetRawPointer(raw, 5, abi), packedWord);
  if (alias === undefined || count === undefined) throw new Error("record alias missing");
  storePointer(count, 9);
  if (loadPointer(pointer).header.count !== 9) throw new Error("record alias was copied");
  storePointer(alias, create(3, 4, 11));
  if (saved.header.count !== 7 || loadPointer(count) !== 11 ||
    loadPointer(pointer).prefix !== 3 || !equalPointer(pointer, alias)) throw new Error("record replacement failed");
}
`;

export const nativeFieldProofSource = `
import { abi } from "test:abi";
import { addressOf, memoryLayout, toRawPointer, reinterpretRawPointer,
  loadPointer, storePointer, equalPointer, unsafeContext } from "@tsonic/core/lang.js";
import type { Pointer, uint32 } from "@tsonic/core/types.js";
const word = memoryLayout<uint32>(abi, 4, 4, 4);
function retained(): Pointer<uint32> {
  let cell: { value: uint32 } = { value: 7 };
  const alias = cell;
  const pointer = addressOf(cell.value);
  toRawPointer(pointer, word);
  const same = addressOf(alias.value);
  if (!equalPointer(pointer, same)) throw new Error("field identity");
  storePointer(pointer, 9);
  if (alias.value !== 9) throw new Error("field was copied");
  alias.value = 11;
  const fieldValue: uint32 = 2;
  alias.value += fieldValue;
  alias.value++;
  if (loadPointer(pointer) !== 14) throw new Error("field writes were lost");
  cell = { value: 99 };
  if (loadPointer(pointer) !== 14 || cell.value !== 99) throw new Error("field retargeted");
  return same;
}
export function run(): boolean {
  unsafeContext();
  const pointer = retained();
  const restored = reinterpretRawPointer(toRawPointer(pointer, word), word);
  if (restored === undefined || !equalPointer(restored, pointer)) return false;
  storePointer(restored, 21);
  return loadPointer(pointer) === 21;
}
export function main(): void { if (!run()) throw new Error("native field retention"); }
`;
