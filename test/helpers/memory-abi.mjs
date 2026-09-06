import { createSourceSemanticsVirtualModuleProvider } from "@tsonic/source-core/extension";

export function memoryAbiCapability(targetId, addressWidth = 64) {
  const providerId = "test.memory-abi";
  const moduleSpecifier = "test:abi";
  const provider = createSourceSemanticsVirtualModuleProvider({
    id: providerId, version: "1", displayName: "Memory ABI proof", virtualDirectory: "memory-abi-proof",
    modules: [{ moduleSpecifier, exports: [] }], evidenceMessage: "Exact registered ABI proof token",
    importsForModule: () => [{ moduleSpecifier: "@tsonic/core/types.js",
      namedImports: [{ exportedName: "DataLayout", kind: "type" }], typeOnly: true }],
    exportsForModule: () => [{ id: "abi.token", name: "abi", kind: "value",
      type: { kind: "provider-ref", moduleSpecifier: "@tsonic/core/types.js", exportName: "DataLayout" } }],
  });
  return {
    kind: "target-capability", id: providerId, targetId, displayName: "Memory ABI proof",
    moduleOwnership: [{ specifierPrefix: moduleSpecifier, providerId }],
    sourceCompilerContributions() {
      return {
        dataLayouts: [{
          providerDeclaration: { providerId, providerVersion: "1", providerModuleId: moduleSpecifier,
            moduleSpecifier, exportId: "abi.token" },
          descriptor: { fingerprint: `proof-le${addressWidth}-v1`, byteOrder: "little", addressWidth },
        }],
        extensions: [{ identity: { id: providerId, version: "1" },
          initialize(context) { context.registerSourceDeclarationProvider(provider); } }],
      };
    },
  };
}

export const rawAddressProofSource = `
import { abi } from "test:abi";
import { addressIntegerToRawPointer as fromAddress, rawPointerToAddressInteger as address,
  offsetRawPointer, equalRawPointer, hashRawPointer, memoryLayout, memoryField,
  sizeOf, alignOf, strideOf, fieldOffsetOf } from "@tsonic/core/lang.js";
import type { RawPointer, uint8, uint32, uint64, int64, uint128, nativeInt, nativeUint } from "@tsonic/core/types.js";
interface Header { tag: uint8; count: uint32 }
const tagField = memoryField((value: Header) => value.tag, 0, 1);
const headerLayout = memoryLayout<Header>(abi, 8, 4, 8, tagField,
  memoryField((value: Header) => value.count, 4, 4));
const headerAlias = headerLayout;
function observeLayout(expectedSize: nativeUint, expectedAlignment: nativeUint,
  expectedStride: nativeUint, expectedOffset: nativeUint, expectedScalar: nativeUint): boolean {
  const localLayout = memoryLayout<uint32>(abi, 4, 4, 4);
  return sizeOf(headerAlias) === expectedSize && alignOf(headerAlias) === expectedAlignment &&
    strideOf(headerAlias) === expectedStride && fieldOffsetOf(headerAlias, value => value.count) === expectedOffset &&
    sizeOf(localLayout) === expectedScalar;
}
function pass(value: RawPointer | undefined): RawPointer | undefined { return value; }
export function run(): boolean {
  const bits: uint64 = 9007199254740993n;
  const pointer = pass(fromAddress(bits, abi));
  const offset: int64 = -4n;
  const shifted = offsetRawPointer(pointer, offset, abi);
  const positive: uint128 = 4n;
  const restored = offsetRawPointer(shifted, positive, abi);
  const backwards: nativeInt = -1;
  const forwards: nativeUint = 1;
  const nativeRestored = offsetRawPointer(offsetRawPointer(restored, backwards, abi), forwards, abi);
  const literalRestored = offsetRawPointer(offsetRawPointer(nativeRestored, 2, abi), -2, abi);
  const zero: uint64 = 0n;
  const shiftedBits: uint64 = 9007199254740989n;
  const nil = fromAddress(zero, abi);
  return observeLayout(8, 4, 8, 4, 4) && !observeLayout(16, 4, 8, 4, 4) &&
    !observeLayout(8, 8, 8, 4, 4) && !observeLayout(8, 4, 16, 4, 4) &&
    !observeLayout(8, 4, 8, 0, 4) && !observeLayout(8, 4, 8, 4, 8) &&
    address<uint64>(pointer, abi) === bits &&
    address<uint64>(shifted, abi) === shiftedBits &&
    address<uint64>(restored, abi) === bits &&
    address<uint64>(literalRestored, abi) === bits &&
    equalRawPointer(pointer, restored) && hashRawPointer(pointer) === hashRawPointer(restored) &&
    equalRawPointer(nil, undefined) && address<uint64>(nil, abi) === zero;
}
`;
export const nativeLocationProofSource = `
import { abi } from "test:abi";
import { memoryLayout, allocatePointer, addressOf, loadPointer, storePointer,
  toRawPointer, reinterpretRawPointer, equalPointer, equalRawPointer, hashPointer,
  offsetRawPointer, unsafeContext, keepAlive } from "@tsonic/core/lang.js";
import type { Pointer, RawPointer, uint32, uint8 } from "@tsonic/core/types.js";
const word = memoryLayout<uint32>(abi, 4, 4, 4);
const byte = memoryLayout<uint8>(abi, 1, 1, 1);
function pass(pointer: Pointer<uint32>): Pointer<uint32> { return pointer; }
function rawPass(pointer: RawPointer | undefined): RawPointer | undefined { return pointer; }
function create(): Pointer<uint32> { return allocatePointer<uint32>(41); }
interface PointerHolder { pointer: Pointer<uint32> }
interface RawHolder { pointer: RawPointer | undefined }
function createRaw(): RawPointer | undefined { return toRawPointer(allocatePointer<uint32>(51), word); }
export function parameterRoundTrip(value: uint32 = 71): Pointer<uint32> {
  unsafeContext();
  const original = addressOf(value);
  const view = reinterpretRawPointer(toRawPointer(original, word), word);
  if (view !== undefined) storePointer(view, 72);
  if (value !== 72) throw new Error("native parameter alias");
  value = 73;
  return original;
}
export function run(): boolean {
  unsafeContext();
  let value: uint32 = 7;
  const original = addressOf(value);
  const raw = rawPass(toRawPointer(pass(original), word));
  const restored = reinterpretRawPointer(raw, word);
  if (restored === undefined) return false;
  if (!equalPointer(original, restored) || hashPointer(original) !== hashPointer(restored)) return false;
  storePointer(restored, 9);
  if (value !== 9) return false;
  value = 17;
  if (loadPointer(restored) !== 17) return false;
  const again = addressOf(value);
  if (!equalPointer(original, again)) return false;
  const firstByte = reinterpretRawPointer(raw, byte);
  if (firstByte === undefined) return false;
  storePointer(firstByte, 33);
  if (value !== 33) return false;
  const retained = create();
  const retainedRaw = toRawPointer(retained, word);
  const retainedAlias = reinterpretRawPointer(offsetRawPointer(retainedRaw, 0, abi), word);
  if (retainedAlias === undefined) return false;
  storePointer(retainedAlias, 42);
  if (loadPointer(retained) !== 42) return false;
  const pointers: Pointer<uint32>[] = [allocatePointer<uint32>(61), allocatePointer<uint32>(62)];
  const pointerAlias = pointers;
  const arrayView = reinterpretRawPointer(toRawPointer(pointerAlias[1], word), word);
  if (arrayView === undefined) return false;
  storePointer(arrayView, 63);
  if (loadPointer(pointers[1]) !== 63) return false;
  const holder: PointerHolder = { pointer: retained };
  const holderView = reinterpretRawPointer(toRawPointer(holder.pointer, word), word);
  if (holderView === undefined) return false;
  storePointer(holderView, 44);
  if (loadPointer(retained) !== 44) return false;
  const rawValues: (RawPointer | undefined)[] = [createRaw()];
  const rawHolder: RawHolder = { pointer: rawValues[0] };
  const ownerView = reinterpretRawPointer(rawHolder.pointer, word);
  if (ownerView === undefined || loadPointer(ownerView) !== 51) return false;
  storePointer(ownerView, 52);
  const ownerAlias = reinterpretRawPointer(rawValues[0], word);
  if (ownerAlias === undefined || loadPointer(ownerAlias) !== 52) return false;
  const incoming: uint32 = 71;
  const parameter = parameterRoundTrip(incoming);
  if (incoming !== 71 || loadPointer(parameter) !== 73) return false;
  if (loadPointer(parameterRoundTrip()) !== 73) return false;
  const nil = toRawPointer<uint32>(undefined, word);
  if (!equalRawPointer(nil, undefined) || reinterpretRawPointer(nil, word) !== undefined) return false;
  keepAlive(raw);
  return equalRawPointer(toRawPointer(restored, word), raw);
}
`;
