import { hasExactObjectKeys, isClosedMetadata, isDenseDataArray, snapshotClosedMetadata } from "../metadata/closed-data.js";
import { isValidRustIdentifier } from "../names/identifiers.js";
import { isRustTargetTypeRef } from "./equality.js";
import type { TargetTypeRef } from "./model.js";
import { rustInfallibleTargetId } from "./carriers/source-types.js";

export interface RustNativeErrorSource<Type> {
  readonly identity: string;
  readonly variant: string;
  readonly errorType: Type;
}

export type RustNativeErrorJoinShape<Type> =
  | { readonly kind: "empty"; readonly sources: readonly [] }
  | { readonly kind: "single"; readonly sources: readonly [RustNativeErrorSource<Type>] }
  | { readonly kind: "joined"; readonly sources: readonly RustNativeErrorSource<Type>[] };

export function selectRustNativeErrorJoin<Type>(
  sources: readonly RustNativeErrorSource<Type>[],
  validate: (type: Type) => boolean,
): RustNativeErrorJoinShape<Type> | undefined {
  if (!isDenseDataArray(sources) || sources.length > 4096) return undefined;
  const identities = new Set<string>();
  const variants = new Set<string>();
  const selected: RustNativeErrorSource<Type>[] = [];
  for (const source of sources) {
    if (source === null || typeof source !== "object" ||
      !hasExactObjectKeys(source, ["identity", "variant", "errorType"]) ||
      typeof source.identity !== "string" || source.identity.length === 0 ||
      typeof source.variant !== "string" || !isValidRustIdentifier(source.variant) ||
      identities.has(source.identity) || !validate(source.errorType)) return undefined;
    const variant = source.variant.startsWith("r#") ? source.variant.slice(2) : source.variant;
    if (variants.has(variant)) return undefined;
    identities.add(source.identity);
    variants.add(variant);
    selected.push(Object.freeze({ ...source }));
  }
  return selected.length === 0 ? Object.freeze({ kind: "empty", sources: Object.freeze([] as const) })
    : selected.length === 1 ? Object.freeze({ kind: "single", sources: Object.freeze([selected[0]!] as const) })
      : Object.freeze({ kind: "joined", sources: Object.freeze(selected) });
}

export interface RustNativeErrorJoinReference {
  readonly fileName: string;
  readonly errors: readonly TargetTypeRef[];
}

export function rustNativeErrorJoinIdentity(fileName: string, arity: number): string {
  return `native-error-join:${fileName}:${arity}`;
}

export function rustNativeErrorJoinTargetType(
  fileName: string,
  errors: readonly TargetTypeRef[],
): TargetTypeRef | undefined {
  if (typeof fileName !== "string" || fileName.length === 0 || !isDenseDataArray(errors) || !boundedJoinData(errors)) return undefined;
  const selection = selectRustNativeErrorJoin(errors.map((errorType, index) => ({
    identity: String(index), variant: `Error${index}`, errorType,
  })), isRustTargetTypeRef);
  if (selection === undefined) return undefined;
  return selection.kind === "empty" ? Object.freeze({ kind: "target-named", id: rustInfallibleTargetId })
    : selection.kind === "single" ? snapshotClosedMetadata(selection.sources[0].errorType)
      : snapshotClosedMetadata({ kind: "target-specific", target: "rust", name: "native-error-join",
        value: { fileName, errors } });
}

export function rustNativeErrorJoinReference(type: TargetTypeRef | undefined): RustNativeErrorJoinReference | undefined {
  if (type?.kind !== "target-specific" || type.target !== "rust" || type.name !== "native-error-join") return undefined;
  const value = type.value as Partial<RustNativeErrorJoinReference> | undefined;
  return value === undefined || value === null || typeof value !== "object" || !boundedJoinData(value) ||
    !hasExactObjectKeys(value, ["fileName", "errors"]) || typeof value.fileName !== "string" || value.fileName.length === 0 ||
    !isDenseDataArray(value.errors) || value.errors.length < 2 || value.errors.length > 4096 ||
    !value.errors.every(isRustTargetTypeRef) ? undefined : value as RustNativeErrorJoinReference;
}

function boundedJoinData(value: unknown): boolean {
  const pending: { readonly value: unknown; readonly depth: number }[] = [{ value, depth: 0 }];
  let remaining = 4096;
  for (let index = 0; index < pending.length; index += 1) {
    const current = pending[index]!;
    if (remaining-- <= 0 || current.depth > 128) return false;
    if (current.value === null || typeof current.value !== "object") continue;
    const keys = Reflect.ownKeys(current.value);
    if (keys.length > remaining) return false;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(current.value, key);
      if (descriptor === undefined || descriptor.get !== undefined || descriptor.set !== undefined) return false;
      pending.push({ value: descriptor.value, depth: current.depth + 1 });
    }
  }
  return isClosedMetadata(value);
}
