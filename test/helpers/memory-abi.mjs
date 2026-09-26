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
import { addressintegertorawptr as fromAddress, rawptrtoaddressinteger as address,
  offsetrawptr, equalrawptr, hashrawptr, memorylayout, memoryfield,
  sizeof, alignof, strideof, fieldoffsetof } from "@tsonic/core/lang.js";
import type { RawPointer, uint8, uint32, uint64, int64, uint128, nativeInt, nativeUint } from "@tsonic/core/types.js";
interface Header { tag: uint8; count: uint32 }
const byteLayout = memorylayout<uint8>({ datalayout: abi, bytesize: 1, bytealignment: 1, stride: 1, fields: [] });
const wordLayout = memorylayout<uint32>({ datalayout: abi, bytesize: 4, bytealignment: 4, stride: 4, fields: [] });
const tagField = memoryfield({ select: (value: Header) => value.tag, byteoffset: 0, bytealignment: 1, fieldlayout: byteLayout });
const headerLayout = memorylayout<Header>({ datalayout: abi, bytesize: 8, bytealignment: 4, stride: 8, fields: [tagField,
  memoryfield({ select: (value: Header) => value.count, byteoffset: 4, bytealignment: 4, fieldlayout: wordLayout })] });
const headerAlias = headerLayout;
function observeLayout(expectedSize: nativeUint, expectedAlignment: nativeUint,
  expectedStride: nativeUint, expectedOffset: nativeUint, expectedScalar: nativeUint): boolean {
  const localLayout = memorylayout<uint32>({ datalayout: abi, bytesize: 4, bytealignment: 4, stride: 4, fields: [] });
  return sizeof(headerAlias) === expectedSize && alignof(headerAlias) === expectedAlignment &&
    strideof(headerAlias) === expectedStride && fieldoffsetof(headerAlias, value => value.count) === expectedOffset &&
    sizeof(localLayout) === expectedScalar;
}
function pass(value: RawPointer | undefined): RawPointer | undefined { return value; }
export function run(): boolean {
  const bits: uint64 = 9007199254740993n;
  const pointer = pass(fromAddress(bits, abi));
  const offset: int64 = -4n;
  const shifted = offsetrawptr(pointer, offset, abi);
  const positive: uint128 = 4n;
  const restored = offsetrawptr(shifted, positive, abi);
  const backwards: nativeInt = -1;
  const forwards: nativeUint = 1;
  const nativeRestored = offsetrawptr(offsetrawptr(restored, backwards, abi), forwards, abi);
  const literalRestored = offsetrawptr(offsetrawptr(nativeRestored, 2, abi), -2, abi);
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
    equalrawptr(pointer, restored) && hashrawptr(pointer) === hashrawptr(restored) &&
    equalrawptr(nil, undefined) && address<uint64>(nil, abi) === zero;
}
`;
export const nativeLocationProofSource = `
import { abi } from "test:abi";
import { memorylayout, allocateptr, addressof, loadptr, storeptr,
  torawptr, reinterpretrawptr, equalptr, equalrawptr, hashptr,
  offsetrawptr, unsafecontext, keepalive } from "@tsonic/core/lang.js";
import type { Pointer, RawPointer, uint32, uint8 } from "@tsonic/core/types.js";
const word = memorylayout<uint32>({ datalayout: abi, bytesize: 4, bytealignment: 4, stride: 4, fields: [] });
const byte = memorylayout<uint8>({ datalayout: abi, bytesize: 1, bytealignment: 1, stride: 1, fields: [] });
function pass(pointer: Pointer<uint32>): Pointer<uint32> { return pointer; }
function genericPass<T>(pointer: Pointer<T>): Pointer<T> { return pointer; }
function closedGeneric() { return genericPass(allocateptr<uint32>(93)); }
function rawPass(pointer: RawPointer | undefined): RawPointer | undefined { return pointer; }
function create(): Pointer<uint32> { return allocateptr<uint32>(41); }
interface PointerHolder { pointer: Pointer<uint32> }
interface RawHolder { pointer: RawPointer | undefined }
function createRaw(): RawPointer | undefined { return torawptr(allocateptr<uint32>(51), word); }
export function inferredForward(raw: RawPointer | undefined) { return inferredRead(raw); }
export function inferredRead(raw: RawPointer | undefined) {
  unsafecontext();
  const pointer = reinterpretrawptr(raw, word);
  return pointer;
}
export function inferredOptional(flag: boolean) {
  if (flag) return allocateptr<uint32>(81);
}
export function inferredChoice(flag: boolean) {
  return flag ? allocateptr<uint32>(82) : allocateptr<uint32>(83);
}
export function annotatedOptional(flag: boolean): Pointer<uint32> | undefined {
  if (flag) return allocateptr<uint32>(85);
}
export function inferredBare(flag: boolean) {
  if (!flag) return;
  return allocateptr<uint32>(86);
}
export function inferredLoop(remaining: uint32) {
  while (remaining > 0) {
    remaining--;
    if (remaining === 0) return allocateptr<uint32>(87);
  }
}
export function inferredNested(flag: boolean) {
  const skip = () => { return; };
  skip();
  if (flag) return allocateptr<uint32>(88);
}
class PointerFactory {
  make(flag: boolean) {
    if (flag) return allocateptr<uint32>(89);
  }
}
function callableResults(): boolean {
  const callback = (flag: boolean) => {
    if (flag) return allocateptr<uint32>(90);
  };
  const annotated = (flag: boolean): Pointer<uint32> | undefined => {
    if (flag) return allocateptr<uint32>(91);
  };
  const expression = function (flag: boolean) {
    if (!flag) return;
    return allocateptr<uint32>(92);
  };
  const factory = new PointerFactory();
  const methodResult = factory.make(true);
  const callbackResult = callback(true);
  const annotatedResult = annotated(true);
  const expressionResult = expression(true);
  return methodResult !== undefined && loadptr(methodResult) === 89 && factory.make(false) === undefined &&
    callbackResult !== undefined && loadptr(callbackResult) === 90 && callback(false) === undefined &&
    annotatedResult !== undefined && loadptr(annotatedResult) === 91 && annotated(false) === undefined &&
    expressionResult !== undefined && loadptr(expressionResult) === 92 && expression(false) === undefined &&
    loadptr(closedGeneric()) === 93;
}
function sameWord(actual: uint32, expected: uint32): boolean { return actual === expected; }
let nilEvaluationOrder: uint32 = 0;
function nilStep(step: uint32): uint32 {
  nilEvaluationOrder = nilEvaluationOrder * 10 + step;
  return step;
}
function nilFailure(): never { nilStep(3); throw new Error("void operand"); }
function nilUnit(): void { nilStep(4); }
function nilExpressions(): boolean {
  unsafecontext();
  nilEvaluationOrder = 0;
  const plain = torawptr<uint32>(void 0, word);
  const same = equalrawptr(torawptr<uint32>(void nilStep(1), word),
    torawptr<uint32>((void nilStep(2)), word));
  let caught = false;
  try { torawptr<uint32>(void nilFailure(), word); } catch { caught = true; }
  const unit = torawptr<uint32>(void nilUnit(), word);
  return same && caught && nilEvaluationOrder === 1234 && equalrawptr(plain, undefined) &&
    equalrawptr(unit, undefined) && reinterpretrawptr(plain, word) === undefined;
}
export function parameterRoundTrip(value: uint32 = 71): Pointer<uint32> {
  unsafecontext();
  const original = addressof(value);
  const view = reinterpretrawptr(torawptr(original, word), word);
  if (view !== undefined) storeptr(view, 72);
  if (value !== 72) throw new Error("native parameter alias");
  value = 73;
  return original;
}
export function run(): boolean {
  unsafecontext();
  let value: uint32 = 7;
  const original = addressof(value);
  const raw = rawPass(torawptr(pass(original), word));
  const restored = reinterpretrawptr(raw, word);
  if (restored === undefined) return false;
  if (!equalptr(original, restored) || hashptr(original) !== hashptr(restored)) return false;
  storeptr(restored, 9);
  if (value !== 9) return false;
  value = 17;
  if (loadptr(restored) !== 17) return false;
  const again = addressof(value);
  if (!equalptr(original, again)) return false;
  const firstByte = reinterpretrawptr(raw, byte);
  if (firstByte === undefined) return false;
  storeptr(firstByte, 33);
  if (value !== 33) return false;
  const retained = create();
  const retainedRaw = torawptr(retained, word);
  const retainedAlias = reinterpretrawptr(offsetrawptr(retainedRaw, 0, abi), word);
  if (retainedAlias === undefined) return false;
  storeptr(retainedAlias, 42);
  if (loadptr(retained) !== 42) return false;
  const pointers: Pointer<uint32>[] = [allocateptr<uint32>(61), allocateptr<uint32>(62)];
  const pointerAlias = pointers;
  const arrayView = reinterpretrawptr(torawptr(pointerAlias[1], word), word);
  if (arrayView === undefined) return false;
  storeptr(arrayView, 63);
  if (loadptr(pointers[1]) !== 63) return false;
  const previousElement = pointers[1];
  pointers[1] = allocateptr<uint32>(64);
  const changedElement = reinterpretrawptr(torawptr(pointers[1], word), word);
  if (changedElement === undefined) return false;
  storeptr(changedElement, 65);
  if (loadptr(pointers[1]) !== 65 || loadptr(previousElement) !== 63) return false;
  const holder: PointerHolder = { pointer: retained };
  const holderView = reinterpretrawptr(torawptr(holder.pointer, word), word);
  if (holderView === undefined) return false;
  storeptr(holderView, 44);
  if (loadptr(retained) !== 44) return false;
  const holderAlias = holder;
  holderAlias.pointer = allocateptr<uint32>(45);
  const changedField = reinterpretrawptr(torawptr(holder.pointer, word), word);
  if (changedField === undefined) return false;
  storeptr(changedField, 46);
  if (loadptr(holderAlias.pointer) !== 46 || loadptr(retained) !== 44) return false;
  const rawValues: (RawPointer | undefined)[] = [createRaw()];
  const rawHolder: RawHolder = { pointer: rawValues[0] };
  const ownerView = reinterpretrawptr(rawHolder.pointer, word);
  if (ownerView === undefined || loadptr(ownerView) !== 51) return false;
  storeptr(ownerView, 52);
  const ownerAlias = reinterpretrawptr(rawValues[0], word);
  if (ownerAlias === undefined || loadptr(ownerAlias) !== 52) return false;
  const incoming: uint32 = 71;
  const parameter = parameterRoundTrip(incoming);
  if (incoming !== 71 || loadptr(parameter) !== 73) return false;
  if (loadptr(parameterRoundTrip()) !== 73) return false;
  const inferred = inferredForward(raw);
  if (inferred === undefined || !equalptr(inferred, original)) return false;
  storeptr(inferred, 84);
  if (!sameWord(value, 84)) return false;
  const optional = inferredOptional(true);
  if (optional === undefined || loadptr(optional) !== 81 || inferredOptional(false) !== undefined) return false;
  if (loadptr(inferredChoice(true)) !== 82 || loadptr(inferredChoice(false)) !== 83) return false;
  const annotated = annotatedOptional(true);
  if (annotated === undefined || loadptr(annotated) !== 85 || annotatedOptional(false) !== undefined) return false;
  const bare = inferredBare(true);
  if (bare === undefined || loadptr(bare) !== 86 || inferredBare(false) !== undefined) return false;
  const loop = inferredLoop(2);
  if (loop === undefined || loadptr(loop) !== 87 || inferredLoop(0) !== undefined) return false;
  const nested = inferredNested(true);
  if (nested === undefined || loadptr(nested) !== 88 || inferredNested(false) !== undefined) return false;
  if (!callableResults()) return false;
  const nil = torawptr<uint32>(undefined, word);
  if (!equalrawptr(nil, undefined) || reinterpretrawptr(nil, word) !== undefined) return false;
  if (!nilExpressions()) return false;
  keepalive(raw);
  return equalrawptr(torawptr(restored, word), raw);
}
`;
