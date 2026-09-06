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
