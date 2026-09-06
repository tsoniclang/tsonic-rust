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
const byteLayout = memoryLayout<uint8>(abi, 1, 1, 1);
const wordLayout = memoryLayout<uint32>(abi, 4, 4, 4);
const tagField = memoryField((value: Header) => value.tag, 0, 1, byteLayout);
const headerLayout = memoryLayout<Header>(abi, 8, 4, 8, tagField,
  memoryField((value: Header) => value.count, 4, 4, wordLayout));
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
function genericPass<T>(pointer: Pointer<T>): Pointer<T> { return pointer; }
function closedGeneric() { return genericPass(allocatePointer<uint32>(93)); }
function rawPass(pointer: RawPointer | undefined): RawPointer | undefined { return pointer; }
function create(): Pointer<uint32> { return allocatePointer<uint32>(41); }
interface PointerHolder { pointer: Pointer<uint32> }
interface RawHolder { pointer: RawPointer | undefined }
function createRaw(): RawPointer | undefined { return toRawPointer(allocatePointer<uint32>(51), word); }
export function inferredForward(raw: RawPointer | undefined) { return inferredRead(raw); }
export function inferredRead(raw: RawPointer | undefined) {
  unsafeContext();
  const pointer = reinterpretRawPointer(raw, word);
  return pointer;
}
export function inferredOptional(flag: boolean) {
  if (flag) return allocatePointer<uint32>(81);
}
export function inferredChoice(flag: boolean) {
  return flag ? allocatePointer<uint32>(82) : allocatePointer<uint32>(83);
}
export function annotatedOptional(flag: boolean): Pointer<uint32> | undefined {
  if (flag) return allocatePointer<uint32>(85);
}
export function inferredBare(flag: boolean) {
  if (!flag) return;
  return allocatePointer<uint32>(86);
}
export function inferredLoop(remaining: uint32) {
  while (remaining > 0) {
    remaining--;
    if (remaining === 0) return allocatePointer<uint32>(87);
  }
}
export function inferredNested(flag: boolean) {
  const skip = () => { return; };
  skip();
  if (flag) return allocatePointer<uint32>(88);
}
class PointerFactory {
  make(flag: boolean) {
    if (flag) return allocatePointer<uint32>(89);
  }
}
function callableResults(): boolean {
  const callback = (flag: boolean) => {
    if (flag) return allocatePointer<uint32>(90);
  };
  const annotated = (flag: boolean): Pointer<uint32> | undefined => {
    if (flag) return allocatePointer<uint32>(91);
  };
  const expression = function (flag: boolean) {
    if (!flag) return;
    return allocatePointer<uint32>(92);
  };
  const factory = new PointerFactory();
  const methodResult = factory.make(true);
  const callbackResult = callback(true);
  const annotatedResult = annotated(true);
  const expressionResult = expression(true);
  return methodResult !== undefined && loadPointer(methodResult) === 89 && factory.make(false) === undefined &&
    callbackResult !== undefined && loadPointer(callbackResult) === 90 && callback(false) === undefined &&
    annotatedResult !== undefined && loadPointer(annotatedResult) === 91 && annotated(false) === undefined &&
    expressionResult !== undefined && loadPointer(expressionResult) === 92 && expression(false) === undefined &&
    loadPointer(closedGeneric()) === 93;
}
function sameWord(actual: uint32, expected: uint32): boolean { return actual === expected; }
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
  const previousElement = pointers[1];
  pointers[1] = allocatePointer<uint32>(64);
  const changedElement = reinterpretRawPointer(toRawPointer(pointers[1], word), word);
  if (changedElement === undefined) return false;
  storePointer(changedElement, 65);
  if (loadPointer(pointers[1]) !== 65 || loadPointer(previousElement) !== 63) return false;
  const holder: PointerHolder = { pointer: retained };
  const holderView = reinterpretRawPointer(toRawPointer(holder.pointer, word), word);
  if (holderView === undefined) return false;
  storePointer(holderView, 44);
  if (loadPointer(retained) !== 44) return false;
  const holderAlias = holder;
  holderAlias.pointer = allocatePointer<uint32>(45);
  const changedField = reinterpretRawPointer(toRawPointer(holder.pointer, word), word);
  if (changedField === undefined) return false;
  storePointer(changedField, 46);
  if (loadPointer(holderAlias.pointer) !== 46 || loadPointer(retained) !== 44) return false;
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
  const inferred = inferredForward(raw);
  if (inferred === undefined || !equalPointer(inferred, original)) return false;
  storePointer(inferred, 84);
  if (!sameWord(value, 84)) return false;
  const optional = inferredOptional(true);
  if (optional === undefined || loadPointer(optional) !== 81 || inferredOptional(false) !== undefined) return false;
  if (loadPointer(inferredChoice(true)) !== 82 || loadPointer(inferredChoice(false)) !== 83) return false;
  const annotated = annotatedOptional(true);
  if (annotated === undefined || loadPointer(annotated) !== 85 || annotatedOptional(false) !== undefined) return false;
  const bare = inferredBare(true);
  if (bare === undefined || loadPointer(bare) !== 86 || inferredBare(false) !== undefined) return false;
  const loop = inferredLoop(2);
  if (loop === undefined || loadPointer(loop) !== 87 || inferredLoop(0) !== undefined) return false;
  const nested = inferredNested(true);
  if (nested === undefined || loadPointer(nested) !== 88 || inferredNested(false) !== undefined) return false;
  if (!callableResults()) return false;
  const nil = toRawPointer<uint32>(undefined, word);
  if (!equalRawPointer(nil, undefined) || reinterpretRawPointer(nil, word) !== undefined) return false;
  keepAlive(raw);
  return equalRawPointer(toRawPointer(restored, word), raw);
}
`;
