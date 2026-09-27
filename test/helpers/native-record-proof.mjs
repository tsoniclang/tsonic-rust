import { createRustProviderPackage } from "../../dist/public/provider.js";

export const nativeArrayProofSource = `
import { abi } from "test:abi";
import { addressof, memorylayout, torawptr, reinterpretrawptr, offsetrawptr,
  loadptr, storeptr, equalptr, unsafecontext } from "@tsonic/core/lang.js";
import type { Pointer, uint32, int32 } from "@tsonic/core/types.js";
const word = memorylayout<uint32>({ datalayout: abi, bytesize: 4, bytealignment: 4, stride: 8, fields: [] });
function replace(pointer: Pointer<uint32>): uint32 { storeptr(pointer, 20); return 2; }
function retained(index: int32): Pointer<uint32> {
  unsafecontext();
  let values: uint32[] = [7, 8];
  const alias = values;
  const pointer = addressof(values[index]);
  const raw = torawptr(pointer, word);
  let position: int32 = index;
  const same = addressof(alias[position++]);
  if (position !== index + 1) throw new Error("index evaluated more than once");
  if (!equalptr(pointer, same)) throw new Error("element identity");
  storeptr(pointer, 9);
  if (alias[index] !== 9) throw new Error("element was copied");
  alias[index] = 11;
  (alias[index]) += 2;
  const previous = alias[index]++;
  if (previous !== 13) throw new Error("postfix value");
  if (loadptr(pointer) !== 14) throw new Error("element writes were lost");
  alias[index] += replace(pointer);
  if (alias[index] !== 16) throw new Error("compound read occurred after rhs");
  alias[index] = 14;
  const neighbor = reinterpretrawptr(offsetrawptr(raw, 8, abi), word);
  if (neighbor === undefined || loadptr(neighbor) !== 8) throw new Error("element stride");
  values = [99];
  if (loadptr(pointer) !== 14 || values[0] !== 99) throw new Error("element retargeted");
  return same;
}
export function run(): boolean {
  unsafecontext();
  const pointer = retained(0);
  const restored = reinterpretrawptr(torawptr(pointer, word), word);
  if (restored === undefined || !equalptr(restored, pointer)) return false;
  storeptr(restored, 21);
  return loadptr(pointer) === 21;
}
export function main(): void { if (!run()) throw new Error("native array retention"); }
`;

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
import { memorylayout, memoryfield, allocateptr, torawptr, reinterpretrawptr,
  loadptr, storeptr, offsetrawptr, equalptr, unsafecontext } from "@tsonic/core/lang.js";
import type { uint8, uint32 } from "@tsonic/core/types.js";
const byte = memorylayout<uint8>({ datalayout: abi, bytesize: 1, bytealignment: 1, stride: 1, fields: [] });
const word = memorylayout<uint32>({ datalayout: abi, bytesize: 4, bytealignment: 4, stride: 4, fields: [] });
const packedWord = memorylayout<uint32>({ datalayout: abi, bytesize: 4, bytealignment: 1, stride: 4, fields: [] });
const header = memorylayout<Header>({ datalayout: abi, bytesize: 8, bytealignment: 4, stride: 8, fields: [
  memoryfield({ select: (value: Header) => value.tag, byteoffset: 0, bytealignment: 1, fieldlayout: byte }),
  memoryfield({ select: (value: Header) => value.count, byteoffset: 4, bytealignment: 4, fieldlayout: word })] });
const envelope = memorylayout<Envelope>({ datalayout: abi, bytesize: 9, bytealignment: 1, stride: 9, fields: [
  memoryfield({ select: (value: Envelope) => value.prefix, byteoffset: 0, bytealignment: 1, fieldlayout: byte }),
  memoryfield({ select: (value: Envelope) => value.header, byteoffset: 1, bytealignment: 1, fieldlayout: header })] });
export function main(): void {
  unsafecontext();
  const pointer = allocateptr<Envelope>(create(1, 2, 7));
  const raw = torawptr(pointer, envelope);
  const saved = loadptr(pointer);
  const alias = reinterpretrawptr(raw, envelope);
  const count = reinterpretrawptr(offsetrawptr(raw, 5, abi), packedWord);
  if (alias === undefined || count === undefined) throw new Error("record alias missing");
  storeptr(count, 9);
  if (loadptr(pointer).header.count !== 9) throw new Error("record alias was copied");
  storeptr(alias, create(3, 4, 11));
  if (saved.header.count !== 7 || loadptr(count) !== 11 ||
    loadptr(pointer).prefix !== 3 || !equalptr(pointer, alias)) throw new Error("record replacement failed");
}
`;

export const nativeFieldProofSource = `
import { abi } from "test:abi";
import { addressof, memorylayout, torawptr, reinterpretrawptr,
  loadptr, storeptr, equalptr, unsafecontext } from "@tsonic/core/lang.js";
import type { Pointer, uint32 } from "@tsonic/core/types.js";
const word = memorylayout<uint32>({ datalayout: abi, bytesize: 4, bytealignment: 4, stride: 4, fields: [] });
function retained(): Pointer<uint32> {
  let cell: { value: uint32 } = { value: 7 };
  const alias = cell;
  const pointer = addressof(cell.value);
  torawptr(pointer, word);
  const same = addressof(alias.value);
  if (!equalptr(pointer, same)) throw new Error("field identity");
  storeptr(pointer, 9);
  if (alias.value !== 9) throw new Error("field was copied");
  alias.value = 11;
  const fieldValue: uint32 = 2;
  alias.value += fieldValue;
  alias.value++;
  if (loadptr(pointer) !== 14) throw new Error("field writes were lost");
  cell = { value: 99 };
  if (loadptr(pointer) !== 14 || cell.value !== 99) throw new Error("field retargeted");
  return same;
}
export function run(): boolean {
  unsafecontext();
  const pointer = retained();
  const restored = reinterpretrawptr(torawptr(pointer, word), word);
  if (restored === undefined || !equalptr(restored, pointer)) return false;
  storeptr(restored, 21);
  return loadptr(pointer) === 21;
}
export function main(): void { if (!run()) throw new Error("native field retention"); }
`;
