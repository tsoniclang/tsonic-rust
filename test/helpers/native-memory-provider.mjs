import { createRustProviderPackage } from "../../dist/public/provider.js";
import { rustLocationTargetType, rustOptionTargetType, rustRawPointerTargetType } from "../../dist/target-model/types/index.js";

export const nativeProviderInferredProofSource = `
import * as native from "test:memory";
import { abi } from "test:abi";
import type { uint32 } from "@tsonic/core/types.js";
import { memoryLayout, reinterpretRawPointer, loadPointer, storePointer, unsafeContext } from "@tsonic/core/lang.js";
const word = memoryLayout<uint32>(abi, 4, 4, 4);
export function run(): boolean {
  unsafeContext();
  const raw = native.identity(native.acquire(31));
  const pointer = reinterpretRawPointer(raw, word);
  if (pointer === undefined) return false;
  storePointer(native.relay(pointer), 52);
  return native.readOriginal() === 52 && loadPointer(pointer) === 52;
}
export function released(): boolean { native.collect(); return native.liveLeases() === 0; }
export function ordinaryLocation(): boolean {
  const pointer = native.identity(native.location(71));
  return loadPointer(native.relay<uint32>(pointer)) === 71;
}
export function main(): void {
  if (!run() || !released() || !ordinaryLocation() || !released()) throw new Error("native inferred pointer lease");
}
`;


export function nativeMemoryProvider(cratePath, { missingRelation = false, wrongCarrier = false, wrongOptional = false, wrongPointee = false, wrongGenericPointee = false } = {}) {
  const moduleSpecifier = "test:memory";
  const word = { kind: "source-primitive", name: "uint32" };
  const genericSource = { kind: "provider-ref", moduleSpecifier: "@tsonic/core/types.js", exportName: "Pointer",
    typeArguments: [{ kind: "type-parameter", name: "Value" }] };
  const genericCarrier = rustLocationTargetType({ kind: "type-parameter", name: "Value" });
  const definitions = [
    ["acquire", "acquire", [{ name: "value", type: word }],
      { kind: "provider-ref", moduleSpecifier: "@tsonic/core/types.js", exportName: "RawPointer" }, rustRawPointerTargetType()],
    ["readOriginal", "read_original", [], word, word],
    ["readSecond", "read_second", [], word, word],
    ["liveLeases", "live_leases", [], word, word],
    ["collect", "collect", [], { kind: "void" }, { kind: "tuple", elements: [] }],
    ["location", "location", [{ name: "value", type: word }],
      { kind: "provider-ref", moduleSpecifier: "@tsonic/core/types.js", exportName: "Pointer", typeArguments: [word] },
      rustLocationTargetType(word)],
    ["relay", "relay", [{ name: "pointer", type: genericSource }], genericSource, genericCarrier,
      [{ name: "Value" }], [genericCarrier]],
    ["identity", "identity", [{ name: "value", type: { kind: "type-parameter", name: "Value" } }],
      { kind: "type-parameter", name: "Value" }, { kind: "type-parameter", name: "Value" },
      [{ name: "Value" }], [{ kind: "type-parameter", name: "Value" }]],
  ];
  return createRustProviderPackage({
    id: "native-memory-proof", displayName: "Native memory proof", version: "1",
    sourceDependencies: [{ moduleSpecifier: "@tsonic/core/types.js", exportedNames: ["RawPointer", "Pointer"] }],
    modules: [{ moduleSpecifier, providerModuleId: "native.memory",
      imports: [{ moduleSpecifier: "@tsonic/core/types.js", namedImports: [{ exportedName: "RawPointer" }, { exportedName: "Pointer" }] }],
      exports: definitions.map(([name, , parameters, returnType, , typeParameters]) => ({
        id: `source.export.${name}`, name, kind: "function",
        signatures: [{ id: `source.signature.${name}`, parameters, returnType,
          ...(typeParameters === undefined ? {} : { typeParameters }) }],
      })),
    }],
    operations: definitions.filter(([name]) => !missingRelation || name !== "acquire")
      .map(([name, targetName, parameters, , resultCarrier, typeParameters, parameterCarriers]) => ({
        exportId: `source.export.${name}`, signatureId: `source.signature.${name}`, operationKind: "method",
        target: { form: "call", path: `native_memory_proof::${targetName}` },
        resultCarrier: wrongCarrier && name === "acquire" ? word
          : wrongOptional && name === "acquire" ? rustOptionTargetType(resultCarrier)
          : (wrongPointee && name === "location" || wrongGenericPointee && name === "relay")
            ? rustLocationTargetType({ kind: "source-primitive", name: "int32" })
          : resultCarrier,
        parameterCarriers: parameterCarriers ?? parameters.map(() => word),
        ...(typeParameters === undefined ? {} : {
          genericParameters: typeParameters.map(parameter => ({ kind: "type", sourceName: parameter.name })),
          targetGenericArguments: typeParameters.map(parameter => ({ kind: "type", type: { kind: "type-parameter", name: parameter.name } })),
        }),
      })),
    crates: [{ crateName: "native_memory_proof", cargoPath: cratePath }],
  });
}

export const nativeProviderProofSource = `
import { acquire as openRegion } from "test:memory";
import * as native from "test:memory";
import { abi } from "test:abi";
import { memoryLayout, reinterpretRawPointer, toRawPointer, loadPointer, storePointer,
  offsetRawPointer, equalPointer, keepAlive, unsafeContext } from "@tsonic/core/lang.js";
import type { Pointer, RawPointer, uint32 } from "@tsonic/core/types.js";
const word = memoryLayout<uint32>(abi, 4, 4, 4);
function acquire(): uint32 { return 99; }
function retained(): Pointer<uint32> {
  unsafeContext();
  const raw = openRegion(31);
  const saved: RawPointer[] = [raw];
  const holder: { pointer: RawPointer } = { pointer: saved[0] };
  const first = reinterpretRawPointer(holder.pointer, word);
  const second = reinterpretRawPointer(offsetRawPointer(raw, 4, abi), word);
  if (first === undefined || second === undefined) throw new Error("missing native view");
  storePointer(first, 39);
  storePointer(second, 44);
  native.collect();
  if (native.liveLeases() !== 1 || native.readOriginal() !== 39 || native.readSecond() !== 44) {
    throw new Error("provider storage was copied or released");
  }
  keepAlive(raw);
  return first;
}
export function run(): boolean {
  unsafeContext();
  const first = retained();
  native.collect();
  const roundTrip = reinterpretRawPointer(toRawPointer(first, word), word);
  if (roundTrip === undefined || !equalPointer(first, roundTrip)) return false;
  storePointer(roundTrip, 52);
  return acquire() === 99 && native.liveLeases() === 1 && native.readOriginal() === 52 && loadPointer(first) === 52;
}
export function released(): boolean { native.collect(); return native.liveLeases() === 0; }
export function main(): void {
  if (!run()) throw new Error("native provider pointer retention");
  if (!released()) throw new Error("native provider lease leak");
  if (!ordinaryLocation()) throw new Error("native provider typed location");
  if (!released()) throw new Error("native provider typed lease leak");
}
export function ordinaryLocation(): boolean {
  const pointer = native.location(71);
  const inferred = native.relay(native.identity(pointer));
  const explicit = native.relay<uint32>(inferred);
  storePointer(explicit, 72);
  return loadPointer(pointer) === 72 && equalPointer(pointer, explicit);
}
`;
