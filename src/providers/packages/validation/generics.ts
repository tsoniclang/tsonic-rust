import {
  asRecord,
  requireExactKeys,
  requireRustIdentifier,
  validateCarrier,
} from "./carriers.js";
import { isRustLifetimeRef } from "../../../target-model/lifetimes/index.js";
import { rustTargetGenericReferences } from "../../../target-model/types/index.js";
import type {
  ProviderTypeParameterDeclaration,
} from "@tsonic/tsts";
import type {
  RustProviderGenericParameter,
} from "../../../target-model/operations/model.js";
import type {
  RustTargetConstArgument,
  RustTargetGenericArgument,
  TargetTypeRef,
} from "../../../target-model/types/model.js";
import type { RustProviderPackageDefinition } from "../model.js";
import type { Fail } from "./model.js";

export interface RustDeclaredProviderGenerics {
  readonly typeNames: ReadonlySet<string>;
  readonly lifetimeIdentities: ReadonlySet<string>;
  readonly constIdentities: ReadonlySet<string>;
}

export function validateProviderGenericParameters(
  parameters: readonly RustProviderGenericParameter[] | undefined,
  sourceParameters: readonly ProviderTypeParameterDeclaration[] | undefined,
  definition: RustProviderPackageDefinition,
  where: string,
  fail: Fail,
  options: { readonly alignSourceParameters?: boolean } = {},
): RustDeclaredProviderGenerics {
  const target = parameters ?? [];
  const source = sourceParameters ?? [];
  const alignSource = options.alignSourceParameters !== false;
  if (alignSource && target.length !== source.length) {
    fail(`${where} must classify every source generic parameter exactly once`);
  }
  if (target.length === 0 && parameters !== undefined) {
    fail(`${where} must omit an empty genericParameters list`);
  }
  const typeNames = new Set<string>();
  const lifetimeIdentities = new Set<string>();
  const constIdentities = new Set<string>();
  const sourceNames = new Set<string>();
  for (const [index, parameter] of target.entries()) {
    const label = `${where}[${index}]`;
    const selectedSource = source[index];
    requireRustIdentifier(parameter.sourceName, `${label}.sourceName`, fail);
    if (alignSource && selectedSource?.name !== parameter.sourceName) {
      fail(`${label}.sourceName must match source generic position ${index}`);
    }
    const sourceHasDefault = selectedSource?.defaultType !== undefined;
    const targetHasDefault = parameter.kind !== "lifetime" &&
      parameter.defaultArgument !== undefined;
    if (alignSource && sourceHasDefault !== targetHasDefault) {
      fail(`${label} must preserve the source generic default boundary exactly`);
    }
    if (sourceNames.has(parameter.sourceName)) {
      fail(`${where} repeats source generic parameter '${parameter.sourceName}'`);
    }
    sourceNames.add(parameter.sourceName);
    if (parameter.kind === "type") {
      requireExactKeys(
        asRecord(parameter),
        ["kind", "sourceName", "defaultArgument"],
        label,
        fail,
      );
      typeNames.add(parameter.sourceName);
      if (parameter.defaultArgument !== undefined) {
        if (parameter.defaultArgument.kind !== "type") {
          fail(`${label}.defaultArgument must be a type generic argument`);
        }
        validateTargetGenericArgument(
          parameter.defaultArgument,
          definition,
          `${label}.defaultArgument`,
          fail,
        );
      }
      continue;
    }
    if (parameter.kind === "lifetime") {
      requireExactKeys(
        asRecord(parameter),
        ["kind", "sourceName", "targetIdentity"],
        label,
        fail,
      );
      requireIdentity(parameter.targetIdentity, `${label}.targetIdentity`, fail);
      if (lifetimeIdentities.has(parameter.targetIdentity)) {
        fail(`${where} repeats target lifetime identity '${parameter.targetIdentity}'`);
      }
      lifetimeIdentities.add(parameter.targetIdentity);
      continue;
    }
    requireExactKeys(
      asRecord(parameter),
      ["kind", "sourceName", "targetIdentity", "defaultArgument"],
      label,
      fail,
    );
    requireIdentity(parameter.targetIdentity, `${label}.targetIdentity`, fail);
    if (constIdentities.has(parameter.targetIdentity)) {
      fail(`${where} repeats target const identity '${parameter.targetIdentity}'`);
    }
    constIdentities.add(parameter.targetIdentity);
    if (parameter.defaultArgument !== undefined) {
      if (parameter.defaultArgument.kind !== "const") {
        fail(`${label}.defaultArgument must be a const generic argument`);
      }
      validateTargetGenericArgument(
        parameter.defaultArgument,
        definition,
        `${label}.defaultArgument`,
        fail,
      );
    }
  }
  return Object.freeze({ typeNames, lifetimeIdentities, constIdentities });
}

export function validateTargetGenericArguments(
  values: readonly RustTargetGenericArgument[],
  definition: RustProviderPackageDefinition,
  where: string,
  fail: Fail,
): void {
  for (const [index, value] of values.entries()) {
    validateTargetGenericArgument(value, definition, `${where}[${index}]`, fail);
  }
}

export function validateTargetGenericArgument(
  value: RustTargetGenericArgument,
  definition: RustProviderPackageDefinition,
  where: string,
  fail: Fail,
): void {
  const record = asRecord(value);
  if (value.kind === "type") {
    requireExactKeys(record, ["kind", "type"], where, fail);
    validateCarrier(value.type, definition, `${where}.type`, fail);
    return;
  }
  if (value.kind === "lifetime") {
    requireExactKeys(record, ["kind", "lifetime"], where, fail);
    if (!isRustLifetimeRef(value.lifetime)) {
      fail(`${where}.lifetime is not an exact Rust lifetime reference`);
    }
    return;
  }
  requireExactKeys(record, ["kind", "value"], where, fail);
  validateConstArgument(value.value, `${where}.value`, fail);
}

export function validateGenericReferences(
  carriers: readonly TargetTypeRef[],
  declared: RustDeclaredProviderGenerics,
  where: string,
  fail: Fail,
): void {
  const typeNames = new Set<string>();
  const lifetimeIdentities = new Set<string>();
  const constIdentities = new Set<string>();
  for (const carrier of carriers) {
    const references = rustTargetGenericReferences(carrier);
    references.typeNames.forEach((name) => typeNames.add(name));
    references.lifetimeIdentities.forEach((identity) =>
      lifetimeIdentities.add(identity));
    references.constIdentities.forEach((identity) => constIdentities.add(identity));
  }
  for (const name of typeNames) {
    if (!declared.typeNames.has(name)) {
      fail(`${where} references undeclared type parameter '${name}'`);
    }
  }
  for (const identity of lifetimeIdentities) {
    if (!declared.lifetimeIdentities.has(identity)) {
      fail(`${where} references undeclared lifetime parameter '${identity}'`);
    }
  }
  for (const identity of constIdentities) {
    if (!declared.constIdentities.has(identity)) {
      fail(`${where} references undeclared const parameter '${identity}'`);
    }
  }
}

export function genericArgumentCarriers(
  values: readonly RustTargetGenericArgument[] | undefined,
): readonly TargetTypeRef[] {
  return values === undefined
    ? Object.freeze([])
    : Object.freeze([{
        kind: "target-named",
        id: "rust.validation.generic-arguments",
        genericArguments: values,
      }]);
}

function validateConstArgument(
  value: RustTargetConstArgument,
  where: string,
  fail: Fail,
): void {
  const record = asRecord(value);
  switch (value.kind) {
    case "infer":
      requireExactKeys(record, ["kind"], where, fail);
      return;
    case "boolean":
      requireExactKeys(record, ["kind", "value"], where, fail);
      if (typeof value.value !== "boolean") fail(`${where}.value must be boolean`);
      return;
    case "integer":
      requireExactKeys(record, ["kind", "value"], where, fail);
      if (!/^-?(?:0|[1-9][0-9]*)$/u.test(value.value)) {
        fail(`${where}.value must be a canonical decimal integer`);
      }
      return;
    case "char":
      requireExactKeys(record, ["kind", "value"], where, fail);
      if ([...value.value].length !== 1) fail(`${where}.value must be one Unicode scalar`);
      return;
    case "parameter":
      requireExactKeys(record, ["kind", "identity", "name"], where, fail);
      requireIdentity(value.identity, `${where}.identity`, fail);
      requireRustIdentifier(value.name, `${where}.name`, fail);
  }
}

function requireIdentity(value: string, where: string, fail: Fail): void {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${where} must be a non-empty exact identity`);
  }
}
