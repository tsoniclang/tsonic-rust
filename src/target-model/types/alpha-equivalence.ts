import type { RustBinder, RustBound } from "../semantics/index.js";
import {
  compareRustSemanticKeys,
  rustBinderSemanticKey,
  rustBoundSemanticKey,
  rustLifetimeSemanticKey,
  rustTypeSemanticKey,
} from "../semantics/index.js";
import {
  closedMetadataKey,
} from "../metadata/closed-data.js";
import {
  isRustBinderValue,
  isRustBoundValue,
  isRustLifetimeValue,
  isRustTargetTypeRef,
} from "./equality.js";
import type { TargetTypeRef } from "./model.js";

export interface RustAlphaCallableSignature {
  readonly binder?: RustBinder;
  readonly parameters: readonly TargetTypeRef[];
  readonly result: TargetTypeRef;
}

export function rustCallableSignaturesAlphaEquivalent(
  left: RustAlphaCallableSignature,
  right: RustAlphaCallableSignature,
): boolean {
  if (left.parameters.length !== right.parameters.length) return false;
  const leftNormalized = normalizeRustBoundSemanticRoot(left);
  const rightNormalized = normalizeRustBoundSemanticRoot(right);
  const leftKey = leftNormalized.valid
    ? normalizedCallableSignatureKey(leftNormalized.value)
    : undefined;
  const rightKey = rightNormalized.valid
    ? normalizedCallableSignatureKey(rightNormalized.value)
    : undefined;
  return leftKey !== undefined && leftKey === rightKey;
}

export function rustCallableBindersAlphaEquivalent(
  left: RustBinder,
  right: RustBinder,
): boolean {
  const leftNormalized = normalizeRustBoundSemanticRoot({ binder: left });
  const rightNormalized = normalizeRustBoundSemanticRoot({ binder: right });
  const leftKey = leftNormalized.valid
    ? normalizedBinderKey(leftNormalized.value)
    : undefined;
  const rightKey = rightNormalized.valid
    ? normalizedBinderKey(rightNormalized.value)
    : undefined;
  return leftKey !== undefined && leftKey === rightKey;
}

export function rustBoundSemanticValuesAlphaEquivalent(
  left: TargetTypeRef,
  leftBinder: RustBinder,
  right: TargetTypeRef,
  rightBinder: RustBinder,
): boolean {
  const leftNormalized = normalizeRustBoundSemanticRoot({ binder: leftBinder, value: left });
  const rightNormalized = normalizeRustBoundSemanticRoot({ binder: rightBinder, value: right });
  const leftKey = leftNormalized.valid
    ? normalizedBoundTypeKey(leftNormalized.value)
    : undefined;
  const rightKey = rightNormalized.valid
    ? normalizedBoundTypeKey(rightNormalized.value)
    : undefined;
  return leftKey !== undefined && leftKey === rightKey;
}

export function rustBoundsAlphaEquivalent(left: RustBound, right: RustBound): boolean {
  const leftNormalized = normalizeRustBoundSemanticRoot(left);
  const rightNormalized = normalizeRustBoundSemanticRoot(right);
  return leftNormalized.valid && rightNormalized.valid &&
    isRustBoundValue(leftNormalized.value) && isRustBoundValue(rightNormalized.value) &&
    rustBoundSemanticKey(leftNormalized.value) === rustBoundSemanticKey(rightNormalized.value);
}

function normalizedCallableSignatureKey(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const signature = value as RustAlphaCallableSignature;
  if (!Array.isArray(signature.parameters) ||
    !signature.parameters.every(isRustTargetTypeRef) ||
    !isRustTargetTypeRef(signature.result) ||
    (signature.binder !== undefined && !isRustBinderValue(signature.binder))) {
    return undefined;
  }
  return closedMetadataKey({
    binder: rustBinderSemanticKey(signature.binder),
    parameters: signature.parameters.map(rustTypeSemanticKey),
    result: rustTypeSemanticKey(signature.result),
  });
}

function normalizedBinderKey(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const binder = (value as { readonly binder?: RustBinder }).binder;
  return binder === undefined || !isRustBinderValue(binder)
    ? undefined
    : rustBinderSemanticKey(binder);
}

function normalizedBoundTypeKey(value: unknown): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const normalized = value as {
    readonly binder?: RustBinder;
    readonly value?: TargetTypeRef;
  };
  return normalized.binder === undefined || !isRustBinderValue(normalized.binder) ||
    !isRustTargetTypeRef(normalized.value)
    ? undefined
    : closedMetadataKey({
        binder: rustBinderSemanticKey(normalized.binder),
        value: rustTypeSemanticKey(normalized.value),
      });
}

interface RustBoundNormalizationScope {
  readonly canonicalBinderId: string;
  readonly parameters: ReadonlyMap<string, string>;
}

interface RustBoundNormalizationState {
  readonly scopes: ReadonlyMap<string, RustBoundNormalizationScope>;
  readonly counter: { value: number };
  readonly validity: { valid: boolean };
  readonly budget: {
    valueCount: number;
    scalarUnits: number;
    readonly active: WeakSet<object>;
  };
}

interface RustBoundNormalizationResult {
  readonly valid: boolean;
  readonly value: unknown;
}

const maximumRustBoundNormalizationDepth = 256;
const maximumRustBoundNormalizationValues = 65_536;
const maximumRustBoundNormalizationScalarUnits = 1_048_576;

function normalizeRustBoundSemanticRoot(value: unknown): RustBoundNormalizationResult {
  const validity = { valid: true };
  const state: RustBoundNormalizationState = {
    scopes: new Map(),
    counter: { value: 0 },
    validity,
    budget: { valueCount: 0, scalarUnits: 0, active: new WeakSet<object>() },
  };
  const normalized = normalizeRustBoundSemanticValue(value, state, 0);
  return { valid: validity.valid, value: normalized };
}

function normalizeRustBoundSemanticValue(
  value: unknown,
  state: RustBoundNormalizationState,
  depth: number,
): unknown {
  if (typeof value === "string") {
    chargeRustBoundNormalizationScalars(state, value.length);
    return state.validity.valid ? value : undefined;
  }
  if (value === null || typeof value !== "object") return value;
  state.budget.valueCount += 1;
  if (!Number.isSafeInteger(state.budget.valueCount) ||
    state.budget.valueCount > maximumRustBoundNormalizationValues ||
    depth > maximumRustBoundNormalizationDepth ||
    state.budget.active.has(value)) {
    state.validity.valid = false;
    return undefined;
  }
  state.budget.active.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > maximumRustBoundNormalizationValues - state.budget.valueCount) {
        state.validity.valid = false;
        return undefined;
      }
      return value.map((entry) => normalizeRustBoundSemanticValue(entry, state, depth + 1));
    }
    const record = value as Readonly<Record<string, unknown>>;
    const keys = Object.keys(record);
    chargeRustBoundNormalizationScalars(
      state,
      keys.reduce((total, key) => total + key.length, 0),
    );
    if (!state.validity.valid) return undefined;
    if (keys.length > maximumRustBoundNormalizationValues - state.budget.valueCount) {
      state.validity.valid = false;
      return undefined;
    }
    if (record.kind === "bound" && typeof record.binderId === "string" &&
      typeof record.parameterId === "string") {
      const scope = state.scopes.get(record.binderId);
      if (scope === undefined) return normalizeRustSemanticRecord(record, state, depth + 1);
      const parameterId = scope.parameters.get(record.parameterId);
      if (parameterId === undefined) {
        state.validity.valid = false;
        return normalizeRustSemanticRecord(record, state, depth + 1);
      }
      return Object.freeze({
        kind: "bound",
        binderId: scope.canonicalBinderId,
        parameterId,
        displayName: "_",
      });
    }
    return normalizeRustSemanticRecord(record, state, depth + 1);
  } finally {
    state.budget.active.delete(value);
  }
}

function chargeRustBoundNormalizationScalars(
  state: RustBoundNormalizationState,
  count: number,
): void {
  state.budget.scalarUnits += count;
  if (!Number.isSafeInteger(state.budget.scalarUnits) ||
    state.budget.scalarUnits > maximumRustBoundNormalizationScalarUnits) {
    state.validity.valid = false;
  }
}

function normalizeRustSemanticRecord(
  record: Readonly<Record<string, unknown>>,
  state: RustBoundNormalizationState,
  depth: number,
): unknown {
  const binderValue = Object.prototype.hasOwnProperty.call(record, "binder")
    ? record.binder
    : undefined;
  const binder = binderValue === undefined ? undefined : rustBinderFromClosedValue(binderValue);
  if (binderValue !== undefined && binder === undefined) state.validity.valid = false;
  const scopedState = binder === undefined ? state : registerRustBinderScope(binder, state);
  return Object.freeze(Object.fromEntries(Object.keys(record).sort().map((key) => [
    key,
    key === "binder" && binder !== undefined
      ? normalizeRustBinder(binder, scopedState, depth)
      : normalizeRustBoundSemanticValue(record[key], scopedState, depth),
  ])));
}

function registerRustBinderScope(
  binder: RustBinder,
  state: RustBoundNormalizationState,
): RustBoundNormalizationState {
  if (state.scopes.has(binder.id)) {
    state.validity.valid = false;
    return state;
  }
  if (binder.lifetimes.length > maximumRustBoundNormalizationValues - state.budget.valueCount) {
    state.validity.valid = false;
    return state;
  }
  const parameters = new Map<string, string>();
  for (let index = 0; index < binder.lifetimes.length; index += 1) {
    const identity = binder.lifetimes[index]!.identity;
    if (identity.kind !== "bound" || identity.binderId !== binder.id ||
      parameters.has(identity.parameterId)) {
      state.validity.valid = false;
      continue;
    }
    parameters.set(identity.parameterId, `${index}`);
  }
  const canonicalBinderId = `binder:${state.counter.value}`;
  state.counter.value += 1;
  const scopes = new Map(state.scopes);
  scopes.set(binder.id, { canonicalBinderId, parameters });
  return { ...state, scopes };
}

function normalizeRustBinder(
  binder: RustBinder,
  state: RustBoundNormalizationState,
  depth: number,
): unknown {
  const scope = state.scopes.get(binder.id);
  if (scope === undefined) {
    state.validity.valid = false;
    return binder;
  }
  return Object.freeze({
    id: scope.canonicalBinderId,
    lifetimes: Object.freeze(binder.lifetimes.map((parameter) => {
      const identity = normalizeRustBoundSemanticValue(parameter.identity, state, depth + 1);
      const bounds = parameter.bounds.map((bound) =>
        normalizeRustBoundSemanticValue(bound, state, depth + 1));
      if (!isRustLifetimeValue(identity) || !bounds.every(isRustLifetimeValue)) {
        state.validity.valid = false;
      } else {
        bounds.sort((left, right) => compareRustSemanticKeys(
          rustLifetimeSemanticKey(left),
          rustLifetimeSemanticKey(right),
        ));
      }
      return Object.freeze({
        kind: "lifetime",
        identity,
        bounds: Object.freeze(bounds),
      });
    })),
  });
}

function rustBinderFromClosedValue(value: unknown): RustBinder | undefined {
  return isRustBinderValue(value) ? value : undefined;
}
