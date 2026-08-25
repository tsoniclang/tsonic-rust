import { asRecord, requireExactKeys, requireRustIdentifier, validateCarrier, validateRustBound, validateRustGenerics, validateValueConversion } from "./carriers.js";
import { isRustFallibleErrorBoundary } from "../../../target-model/operations/error-boundary.js";
import {
  rustProviderOperationFormAcceptsTargetTypeArguments,
  rustProviderOperationFormContractViolation,
  rustProviderOperationFormDeclaresWritableInput,
  rustProviderOperationFormPassesSourceArgumentByReference,
} from "../../../policy/operations/forms.js";
import {
  rustGenericArgumentAssociatedProjectionKeys,
  isRustUnitCarrier,
  rustGenericArgumentOpenIdentityKeys,
  rustGenericsAssociatedProjectionKeys,
  rustGenericsDeclaredParameterIdentities,
  rustGenericsOpenGenericIdentityKeys,
  rustGenericParameterIdentity,
  rustTargetTypeAssociatedProjectionKeys,
  rustTargetTypeOpenGenericIdentityKeys,
  rustTraitAssociatedProjectionKeys,
  rustTraitOpenGenericIdentityKeys,
} from "../../../target-model/types/index.js";
import { validateOperationForm } from "./forms.js";
import type { ExportRecord, Fail, MemberRecord, SignatureRecord } from "./model.js";
import type { RustProviderOperationForm } from "../../../target-model/operations/model.js";
import type { RustProviderPackageDefinition } from "../model.js";
import type { RustProviderTypeParameterRequirement } from "../../../target-model/operations/model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { isRustGenericArgumentValue } from "../../../target-model/types/equality.js";
import {
  rustBoundSemanticKey,
  rustSemanticIdentityKey,
  rustTypeSemanticKey,
} from "../../../target-model/semantics/index.js";

export function validateOperationRows(
  definition: RustProviderPackageDefinition,
  exportsById: ReadonlyMap<string, ExportRecord>,
  membersById: ReadonlyMap<string, MemberRecord>,
  signaturesById: ReadonlyMap<string, SignatureRecord>,
  fail: Fail,
): void {
  const rowKeys = new Set<string>();
  for (const row of definition.operations) {
    requireExactKeys(asRecord(row), [
      "exportId", "memberId", "signatureId", "operationKind", "target", "resultCarrier",
      "parameterCarriers", "receiverCarrier", "targetReceiver", "sourceGenericBindings", "targetInferenceParameters", "targetGenerics", "targetCallableGenerics", "typeRequirements", "targetGenericArguments", "resultConversion", "evaluation", "isAsync", "isFallible", "errorBoundary", "errorCarrier", "isUnsafe", "immediateCallback",
    ], `operation row '${String((row as { readonly memberId?: unknown; readonly exportId?: unknown }).memberId ?? row.exportId)}'`, fail);
    const label = row.memberId ?? row.exportId;
    if (row.operationKind !== "method" && row.operationKind !== "constructor" &&
      row.operationKind !== "property" && row.operationKind !== "indexer" &&
      row.operationKind !== "property-set" && row.operationKind !== "index-set") {
      fail(`row '${String(label)}' has unsupported operation kind '${String(row.operationKind)}'`);
    }
    const exported = exportsById.get(row.exportId);
    if (exported === undefined) {
      fail(`row '${label}' targets undeclared exportId '${row.exportId}'`);
    }
    const member = row.memberId === undefined ? undefined : membersById.get(row.memberId);
    if (row.memberId !== undefined && (member === undefined || member.exportId !== row.exportId)) {
      fail(`row '${label}' targets memberId '${row.memberId}' outside export '${row.exportId}'`);
    }
    const signature = row.signatureId === undefined ? undefined : signaturesById.get(row.signatureId);
    if (row.signatureId !== undefined && (signature === undefined || signature.exportId !== row.exportId ||
      (row.memberId !== undefined && signature.memberId !== row.memberId))) {
      fail(`row '${label}' targets signatureId '${row.signatureId}' outside its selected declaration`);
    }
    if (row.memberId === undefined && row.operationKind === "property" &&
      exported?.declaration.kind !== "value") {
      fail(`row '${label}' declares a provider value operation for non-value export kind '${String(exported?.declaration.kind)}'`);
    }
    if (row.memberId === undefined && exported?.declaration.kind === "value" &&
      row.operationKind !== "property" && row.operationKind !== "property-set") {
      fail(`row '${label}' must represent provider value export '${row.exportId}' as a property read or property-set operation`);
    }
    if (row.operationKind === "property-set" || row.operationKind === "index-set") {
      const expectedMemberKind = row.operationKind === "property-set" ? "property" : "indexer";
      const selectedValueProjection = row.operationKind === "property-set" &&
        member === undefined && exported?.declaration.kind === "value";
      if (!selectedValueProjection &&
        (member?.declaration.kind !== expectedMemberKind || member.declaration.readonly === true)) {
        fail(`row '${label}' requires a writable provider ${expectedMemberKind} declaration`);
      }
      if (row.signatureId !== undefined && row.operationKind === "property-set") {
        fail(`row '${label}' cannot select a property setter by signatureId`);
      }
      if (!isRustUnitCarrier(row.resultCarrier)) {
        fail(`row '${label}' setter result carrier must be Rust unit`);
      }
    }
    const rowKey = [row.exportId, row.memberId ?? "", row.signatureId ?? "", row.operationKind].join("\u0000");
    if (rowKeys.has(rowKey)) {
      fail(`duplicate operation selector row '${label}' for '${row.operationKind}'`);
    }
    rowKeys.add(rowKey);
    if (row.evaluation !== undefined && row.evaluation !== "pure") {
      fail(`evaluation must be 'pure' when present (row '${label}').`);
    }
    if (row.evaluation === "pure" && (
      row.operationKind === "constructor" || row.operationKind === "property-set" ||
      row.operationKind === "index-set" || row.immediateCallback !== undefined ||
      rustProviderOperationFormDeclaresWritableInput(row.target)
    )) {
      fail(`pure evaluation cannot construct identity, invoke a source callback, or declare writable source inputs (row '${label}').`);
    }
    if (row.isFallible !== undefined && row.isFallible !== true) {
      fail(`isFallible must be true when present (row '${label}').`);
    }
    if (row.isFallible === true && !isRustFallibleErrorBoundary(row.errorBoundary)) {
      fail(`fallible row '${label}' requires an exact errorBoundary.`);
    }
    if (row.isFallible !== true && row.errorBoundary !== undefined) {
      fail(`infallible row '${label}' cannot declare an errorBoundary.`);
    }
    if (row.isFallible === true && row.operationKind !== "method" && row.operationKind !== "constructor" && row.operationKind !== "property") {
      fail(`isFallible is supported only on method, constructor, and property operations (row '${label}').`);
    }
    if (row.isAsync === true && row.operationKind !== "method") {
      fail(`isAsync is supported only on method operations (row '${label}').`);
    }
    if (row.errorBoundary === "provider-native") {
      if (row.errorCarrier === undefined) {
        fail(`provider-native row '${label}' requires an exact errorCarrier.`);
      } else {
        validateCarrier(row.errorCarrier, definition, `${label}.errorCarrier`, fail, {
          position: "return",
        });
      }
    } else if (row.errorCarrier !== undefined) {
      fail(`row '${label}' cannot declare an errorCarrier outside a provider-native boundary.`);
    }
    if (row.isAsync !== undefined && typeof row.isAsync !== "boolean") {
      fail(`isAsync must be boolean when present (row '${label}').`);
    }
    validateProviderCallback(row, definition, label, fail);
    validateOperationParameters(row, exported, member, signature, fail);
    validateCarrier(row.resultCarrier, definition, `${label}.resultCarrier`, fail, {
      position: "return",
    });
    if (row.receiverCarrier !== undefined) {
      validateCarrier(row.receiverCarrier, definition, `${label}.receiverCarrier`, fail);
    }
    if (row.targetReceiver !== undefined) {
      requireExactKeys(
        asRecord(row.targetReceiver),
        ["type", "explicit"],
        `${label}.targetReceiver`,
        fail,
      );
      validateCarrier(row.targetReceiver.type, definition, `${label}.targetReceiver.type`, fail);
      if (typeof row.targetReceiver.explicit !== "boolean") {
        fail(`${label}.targetReceiver.explicit must be boolean`);
      }
      if (row.operationKind !== "method") {
        fail(`${label}.targetReceiver is valid only for method operations`);
      }
    }
    const typeParameterNames = validateSourceGenericBindings(
      row.sourceGenericBindings ?? [],
      `${label}.sourceGenericBindings`,
      fail,
      definition,
    );
    if ((row.sourceGenericBindings ?? []).some((binding) =>
      binding.target.kind === "semantic-parameter")) {
      fail(`${label}.sourceGenericBindings cannot declare type-only semantic parameters`);
    }
    const inferredGenericIdentities = validateTargetOpenGenericParameters(
      row.targetInferenceParameters ?? [],
      `${label}.targetInferenceParameters`,
      fail,
      definition,
    );
    if (row.targetGenerics !== undefined) {
      validateRustGenerics(row.targetGenerics, definition, `${label}.targetGenerics`, fail);
      validateTargetGenericParameterMapping(
        row.targetGenerics,
        row.sourceGenericBindings ?? [],
        inferredGenericIdentities,
        `${label}.targetGenerics`,
        fail,
      );
    }
    if (row.targetCallableGenerics !== undefined) {
      validateRustGenerics(
        row.targetCallableGenerics,
        definition,
        `${label}.targetCallableGenerics`,
        fail,
      );
      if (row.targetGenerics === undefined) {
        fail(`${label}.targetCallableGenerics requires targetGenerics`);
      } else {
        validateCallableGenericsSubset(
          row.targetCallableGenerics,
          row.targetGenerics,
          `${label}.targetCallableGenerics`,
          fail,
        );
      }
    }
    validateTypeParameterRequirements(
      row.typeRequirements,
      typeParameterNames,
      definition,
      `${label}.typeRequirements`,
      fail,
    );
    if (row.targetGenericArguments !== undefined && (
      !Array.isArray(row.targetGenericArguments) || row.targetGenericArguments.length === 0 ||
      !rustProviderOperationFormAcceptsTargetTypeArguments(row.target)
    )) {
      fail(`${label}.targetGenericArguments requires a non-empty native call or method generic-argument list`);
    }
    for (const [index, argument] of (row.targetGenericArguments ?? []).entries()) {
      if (!isRustGenericArgumentValue(argument)) {
        fail(`${label}.targetGenericArguments[${index}] is not one closed Rust generic argument`);
      }
      if (argument.kind === "type") {
        validateCarrier(argument.value, definition, `${label}.targetGenericArguments[${index}].value`, fail);
      }
    }
    for (const [index, carrier] of (row.parameterCarriers ?? []).entries()) {
      validateCarrier(
        carrier,
        definition,
        `${label}.parameterCarriers[${index}]`,
        fail,
        {
          allowImmediateClosure: row.immediateCallback?.sourceArgumentIndex === index,
          allowUnsized: rustProviderOperationFormPassesSourceArgumentByReference(
            row.target,
            index,
            carrier,
          ),
        },
      );
    }
    const referencedGenericIdentities = new Set([
      ...rustTargetTypeOpenGenericIdentityKeys(row.resultCarrier),
      ...(row.receiverCarrier === undefined ? [] : rustTargetTypeOpenGenericIdentityKeys(row.receiverCarrier)),
      ...(row.targetReceiver === undefined ? [] : rustTargetTypeOpenGenericIdentityKeys(row.targetReceiver.type)),
      ...(row.parameterCarriers ?? []).flatMap(rustTargetTypeOpenGenericIdentityKeys),
      ...(row.targetGenericArguments ?? []).flatMap(rustGenericArgumentOpenIdentityKeys),
      ...(row.targetGenerics === undefined
        ? []
        : rustGenericsOpenGenericIdentityKeys(row.targetGenerics)),
      ...(row.targetCallableGenerics === undefined
        ? []
        : rustGenericsOpenGenericIdentityKeys(row.targetCallableGenerics)),
      ...operationFormCarriers(row.target).flatMap(rustTargetTypeOpenGenericIdentityKeys),
      ...(row.target.form === "trait-call" || row.target.form === "trait-associated-value"
        ? rustTraitOpenGenericIdentityKeys(row.target.trait)
        : []),
      ...(row.immediateCallback === undefined
        ? []
        : operationFormCarriers(row.immediateCallback.fallibleTarget)
            .flatMap(rustTargetTypeOpenGenericIdentityKeys)),
    ]);
    const sourceGenericIdentityByKey = new Map((row.sourceGenericBindings ?? []).flatMap((binding) => {
      if (binding.target.kind !== "generic-parameter") return [];
      const identity = rustGenericParameterIdentity(binding.target.parameter);
      return identity === undefined ? [] : [[identity.identityKey, binding.sourceName] as const];
    }));
    for (const identityKey of referencedGenericIdentities) {
      if (!sourceGenericIdentityByKey.has(identityKey) && !inferredGenericIdentities.has(identityKey)) {
        fail(`${label} carrier references undeclared operation target generic parameter '${identityKey}'`);
      }
    }
    for (const identityKey of inferredGenericIdentities) {
      if (!referencedGenericIdentities.has(identityKey)) {
        fail(`${label}.targetInferenceParameters declares unused target parameter '${identityKey}'`);
      }
    }
    for (const [identityKey, sourceName] of sourceGenericIdentityByKey) {
      if (!referencedGenericIdentities.has(identityKey)) {
        fail(`${label}.sourceGenericBindings declares unused '${sourceName}' target parameter '${identityKey}'`);
      }
    }
    const referencedAssociatedProjections = new Set([
      ...rustTargetTypeAssociatedProjectionKeys(row.resultCarrier),
      ...(row.receiverCarrier === undefined
        ? []
        : rustTargetTypeAssociatedProjectionKeys(row.receiverCarrier)),
      ...(row.targetReceiver === undefined
        ? []
        : rustTargetTypeAssociatedProjectionKeys(row.targetReceiver.type)),
      ...(row.parameterCarriers ?? []).flatMap(rustTargetTypeAssociatedProjectionKeys),
      ...(row.targetGenericArguments ?? []).flatMap(rustGenericArgumentAssociatedProjectionKeys),
      ...(row.targetGenerics === undefined
        ? []
        : rustGenericsAssociatedProjectionKeys(row.targetGenerics)),
      ...(row.targetCallableGenerics === undefined
        ? []
        : rustGenericsAssociatedProjectionKeys(row.targetCallableGenerics)),
      ...operationFormCarriers(row.target).flatMap(rustTargetTypeAssociatedProjectionKeys),
      ...(row.target.form === "trait-call" || row.target.form === "trait-associated-value"
        ? rustTraitAssociatedProjectionKeys(row.target.trait)
        : []),
      ...(row.immediateCallback === undefined
        ? []
        : operationFormCarriers(row.immediateCallback.fallibleTarget)
            .flatMap(rustTargetTypeAssociatedProjectionKeys)),
    ]);
    for (const binding of row.sourceGenericBindings ?? []) {
      if (binding.target.kind !== "associated-type") continue;
      const key = rustTypeSemanticKey(binding.target.projection);
      if (!referencedAssociatedProjections.has(key)) {
        fail(`${label}.sourceGenericBindings declares unused associated type '${binding.sourceName}'`);
      }
    }
    if (row.resultConversion !== undefined) {
      validateValueConversion(row.resultConversion, definition, `${label}.resultConversion`, undefined, row.resultCarrier, fail);
    }
    validateOperationForm(row.operationKind, row.target, definition, label, row.parameterCarriers, fail);
    const operationFormContractViolation = rustProviderOperationFormContractViolation(
      row.operationKind,
      row.target,
      row.target.form === "call-value-slice" || row.target.form === "call-value-array" ||
          row.target.form === "receiver-value-array" || row.target.form === "receiver-tagged-array"
        ? row.target.leadingArguments.length
        : row.parameterCarriers?.length ?? 0,
    );
    if (operationFormContractViolation !== undefined) {
      fail(`${label}.target violates the closed Rust operation-form contract: ${operationFormContractViolation}`);
    }
  }
}

export function validateTargetGenericParameterMapping(
  generics: import("../../../target-model/semantics/index.js").RustGenerics,
  sourceBindings: readonly import("../../../target-model/operations/model.js").RustProviderSourceGenericBinding[],
  inferredIdentities: ReadonlySet<string>,
  where: string,
  fail: Fail,
): void {
  const declared = rustGenericsDeclaredParameterIdentities(generics);
  const source = {
    lifetimes: new Set<string>(),
    types: new Set<string>(),
    consts: new Set<string>(),
  };
  const declaredAll = new Set([
    ...declared.lifetimes,
    ...declared.types,
    ...declared.consts,
  ]);
  const defaulted = new Set(generics.parameters.flatMap((parameter) => {
    const hasDefault = parameter.kind === "type"
      ? parameter.defaultType !== undefined
      : parameter.kind === "const" && parameter.defaultValue !== undefined;
    if (!hasDefault) return [];
    const argument = parameter.kind === "lifetime"
      ? { kind: "lifetime" as const, value: parameter.identity }
      : parameter.kind === "type"
        ? {
            kind: "type" as const,
            value: {
              kind: "type-parameter" as const,
              identity: parameter.identity,
              displayName: parameter.displayName,
            },
          }
        : {
            kind: "const" as const,
            value: {
              kind: "parameter" as const,
              identity: parameter.identity,
              displayName: parameter.displayName,
            },
          };
    const identity = rustGenericParameterIdentity(argument);
    return identity === undefined ? [] : [identity.identityKey];
  }));
  for (const identity of inferredIdentities) {
    if (!declaredAll.has(identity)) {
      fail(`${where} marks undeclared target parameter '${identity}' as target-inferred or implicit`);
    }
  }
  for (const binding of sourceBindings) {
    if (binding.target.kind === "semantic-parameter") {
      continue;
    }
    if (binding.target.kind === "associated-type") {
      for (const identity of rustTargetTypeOpenGenericIdentityKeys(binding.target.projection)) {
        if (!declaredAll.has(identity)) {
          fail(`${where} associated source binding references undeclared target generic parameter '${identity}'`);
        }
      }
      continue;
    }
    const identity = rustGenericParameterIdentity(binding.target.parameter);
    if (identity === undefined) continue;
    const selected = identity.kind === "lifetime"
      ? source.lifetimes
      : identity.kind === "type"
        ? source.types
        : source.consts;
    selected.add(identity.identityKey);
    if (inferredIdentities.has(identity.identityKey)) {
      fail(`${where} maps target parameter '${identity.identityKey}' from both source and target inference`);
    }
  }
  for (const kind of ["lifetimes", "types", "consts"] as const) {
    for (const identity of source[kind]) {
      if (!declared[kind].has(identity)) {
        fail(`${where} has no declared ${kind.slice(0, -1)} parameter for source mapping '${identity}'`);
      }
    }
    for (const identity of declared[kind]) {
      if (!source[kind].has(identity) && !inferredIdentities.has(identity) &&
        !defaulted.has(identity)) {
        fail(`${where} declares unmapped ${kind.slice(0, -1)} parameter '${identity}'`);
      }
    }
  }
  for (const identity of rustGenericsOpenGenericIdentityKeys(generics)) {
    if (!declaredAll.has(identity)) {
      fail(`${where} references undeclared target generic parameter '${identity}'`);
    }
  }
}

export function validateTargetOpenGenericParameters(
  parameters: readonly import("../../../target-model/semantics/index.js").RustGenericArgument[],
  where: string,
  fail: Fail,
  definition: RustProviderPackageDefinition,
): ReadonlySet<string> {
  if (!Array.isArray(parameters)) {
    fail(`${where} must be a dense array`);
    return new Set();
  }
  const identities = new Set<string>();
  for (const [index, parameter] of parameters.entries()) {
    if (!isRustGenericArgumentValue(parameter)) {
      fail(`${where}[${index}] is not one exact Rust generic parameter argument`);
      continue;
    }
    if (parameter.kind === "type") {
      validateCarrier(parameter.value, definition, `${where}[${index}].value`, fail);
    }
    const identity = rustGenericParameterIdentity(parameter);
    if (identity === undefined) {
      fail(`${where}[${index}] must identify an open lifetime, type, or const parameter`);
      continue;
    }
    if (identities.has(identity.identityKey)) {
      fail(`${where} contains duplicate target identity '${identity.identityKey}'`);
    }
    identities.add(identity.identityKey);
  }
  return identities;
}

function validateCallableGenericsSubset(
  callable: import("../../../target-model/semantics/index.js").RustGenerics,
  operation: import("../../../target-model/semantics/index.js").RustGenerics,
  where: string,
  fail: Fail,
): void {
  const available = rustGenericsDeclaredParameterIdentities(operation);
  const selected = rustGenericsDeclaredParameterIdentities(callable);
  for (const kind of ["lifetimes", "types", "consts"] as const) {
    for (const identity of selected[kind]) {
      if (!available[kind].has(identity)) {
        fail(`${where} references target ${kind.slice(0, -1)} parameter '${identity}' outside operation generics`);
      }
    }
  }
}

export function validateSourceGenericBindings(
  bindings: readonly import("../../../target-model/operations/model.js").RustProviderSourceGenericBinding[],
  where: string,
  fail: Fail,
  definition: RustProviderPackageDefinition,
): Set<string> {
  if (!Array.isArray(bindings)) {
    fail(`${where} must be a dense array`);
    return new Set();
  }
  const names = new Set<string>();
  const identities = new Set<string>();
  for (const [index, binding] of bindings.entries()) {
    const label = `${where}[${index}]`;
    const record = asRecord(binding);
    requireExactKeys(record, ["sourceName", "target"], label, fail);
    requireRustIdentifier(binding.sourceName, `${label}.sourceName`, fail);
    if (names.has(binding.sourceName)) {
      fail(`${where} contains duplicate source name '${binding.sourceName}'`);
    }
    names.add(binding.sourceName);
    const target = asRecord(binding.target);
    if (binding.target.kind !== "generic-parameter" && binding.target.kind !== "associated-type" &&
      binding.target.kind !== "semantic-parameter") {
      fail(`${label}.target.kind must be 'generic-parameter', 'associated-type', or 'semantic-parameter'`);
      continue;
    }
    if (binding.target.kind === "semantic-parameter") {
      requireExactKeys(target, ["kind", "role"], `${label}.target`, fail);
      if (binding.target.role !== "callable-result") {
        fail(`${label}.target.role must be 'callable-result'`);
        continue;
      }
      const key = `semantic:${binding.target.role}`;
      if (identities.has(key)) {
        fail(`${where} contains duplicate semantic parameter role '${binding.target.role}'`);
      }
      identities.add(key);
      continue;
    }
    if (binding.target.kind === "associated-type") {
      requireExactKeys(target, ["kind", "projection"], `${label}.target`, fail);
      if (binding.target.projection.kind !== "associated-type") {
        fail(`${label}.target.projection must be one exact Rust associated type`);
        continue;
      }
      validateCarrier(
        binding.target.projection,
        definition,
        `${label}.target.projection`,
        fail,
      );
      const key = `associated:${rustTypeSemanticKey(binding.target.projection)}`;
      if (identities.has(key)) {
        fail(`${where} contains duplicate associated type projection '${key}'`);
      }
      identities.add(key);
      continue;
    }
    requireExactKeys(target, ["kind", "parameter"], `${label}.target`, fail);
    const argument = binding.target.parameter;
    if (!isRustGenericArgumentValue(argument)) {
      fail(`${label}.target.parameter must be one exact Rust generic parameter argument`);
      continue;
    }
    const identity = argument.kind === "lifetime" && argument.value.kind === "parameter"
      ? argument.value.identity
      : argument.kind === "type" && argument.value.kind === "type-parameter"
        ? argument.value.identity
        : argument.kind === "const" && argument.value.kind === "parameter"
          ? argument.value.identity
          : undefined;
    if (identity === undefined) {
      fail(`${label}.target.parameter must identify a lifetime, type, or const parameter`);
      continue;
    }
    const identityKey = rustSemanticIdentityKey(identity);
    if (identities.has(identityKey)) {
      fail(`${where} contains duplicate target generic parameter identity '${identityKey}'`);
    }
    identities.add(identityKey);
  }
  return names;
}

export function validateTypeParameterRequirements(
  requirements: readonly RustProviderTypeParameterRequirement[] | undefined,
  typeParameterNames: ReadonlySet<string>,
  definition: RustProviderPackageDefinition,
  where: string,
  fail: Fail,
): void {
  const seen = new Set<string>();
  let previous = "";
  for (const requirement of requirements ?? []) {
    requireExactKeys(asRecord(requirement), ["name", "requirements"], where, fail);
    requireRustIdentifier(requirement.name, `${where}.name`, fail);
    if (!typeParameterNames.has(requirement.name)) {
      fail(`${where} references undeclared type parameter '${requirement.name}'`);
    }
    if (seen.has(requirement.name) || (previous.length > 0 && requirement.name < previous)) {
      fail(`${where} must contain unique rows in type-parameter order`);
    }
    seen.add(requirement.name);
    previous = requirement.name;
    const keys = requirement.requirements.map((entry, index) => {
      validateRustBound(
        entry,
        definition,
        `${where}.${requirement.name}.requirements[${index}]`,
        fail,
      );
      return rustBoundSemanticKey(entry);
    });
    if (keys.length === 0 || new Set(keys).size !== keys.length ||
      keys.some((entry, index) => index > 0 && entry < keys[index - 1]!)) {
      fail(`${where}.${requirement.name} must contain a non-empty canonical target requirement set`);
    }
  }
}

function validateProviderCallback(
  row: RustProviderPackageDefinition["operations"][number],
  definition: RustProviderPackageDefinition,
  label: string,
  fail: Fail,
): void {
  const callback = row.immediateCallback;
  if (callback === undefined) {
    return;
  }
  requireExactKeys(
    asRecord(callback),
    ["sourceArgumentIndex", "fallibleTarget"],
    `${label}.immediateCallback`,
    fail,
  );
  if (row.operationKind !== "method" && row.operationKind !== "constructor") {
    fail(`${label}.immediateCallback is supported only on checked call operations`);
  }
  if (!Number.isSafeInteger(callback.sourceArgumentIndex) || callback.sourceArgumentIndex < 0 ||
    callback.sourceArgumentIndex >= (row.parameterCarriers?.length ?? 0)) {
    fail(`${label}.immediateCallback.sourceArgumentIndex must select one declared parameter carrier`);
  }
  const callbackCarrier = row.parameterCarriers?.[callback.sourceArgumentIndex];
  if (callbackCarrier?.kind !== "closure") {
    fail(`${label}.immediateCallback.sourceArgumentIndex must select one exact native closure carrier`);
  }
  validateOperationForm(
    row.operationKind,
    callback.fallibleTarget,
    definition,
    `${label}.immediateCallback.fallibleTarget`,
    row.parameterCarriers,
    fail,
  );
  const violation = rustProviderOperationFormContractViolation(
    row.operationKind,
    callback.fallibleTarget,
    callback.fallibleTarget.form === "call-value-slice" ||
        callback.fallibleTarget.form === "call-value-array" ||
        callback.fallibleTarget.form === "receiver-value-array" ||
        callback.fallibleTarget.form === "receiver-tagged-array"
      ? callback.fallibleTarget.leadingArguments.length
      : row.parameterCarriers?.length ?? 0,
  );
  if (violation !== undefined) {
    fail(`${label}.immediateCallback.fallibleTarget violates the closed Rust operation-form contract: ${violation}`);
  }
}

function operationFormCarriers(form: RustProviderOperationForm): readonly TargetTypeRef[] {
  if (form.form === "call-value-slice" || form.form === "call-value-array" ||
    form.form === "receiver-value-array") {
    return [...form.leadingArguments.map((argument) => argument.carrier), form.elementCarrier];
  }
  if (form.form === "receiver-tagged-array") {
    return [
      ...form.leadingArguments.map((argument) => argument.carrier),
      form.elementCarrier,
      ...form.alternatives.map((alternative) => alternative.inputCarrier),
    ];
  }
  if (form.form === "trait-call" || form.form === "trait-associated-value") {
    return [form.owner, ...traitCarriers(form.trait)];
  }
  return [];
}

function traitCarriers(
  trait: import("../../../target-model/semantics/index.js").RustTraitRef,
): readonly TargetTypeRef[] {
  const selected: TargetTypeRef[] = [];
  const visitArgument = (
    argument: import("../../../target-model/semantics/index.js").RustGenericArgument,
  ): void => {
    if (argument.kind === "type") selected.push(argument.value);
  };
  trait.arguments.forEach(visitArgument);
  for (const constraint of trait.associatedConstraints) {
    constraint.arguments.forEach(visitArgument);
    if (constraint.kind === "equality") selected.push(constraint.type);
  }
  return selected;
}

function validateOperationParameters(
  row: RustProviderPackageDefinition["operations"][number],
  exported: ExportRecord | undefined,
  member: MemberRecord | undefined,
  signature: SignatureRecord | undefined,
  fail: Fail,
): void {
  if (row.operationKind === "property-set") {
    if (row.parameterCarriers?.length !== 1) {
      fail(`row '${row.memberId ?? row.exportId}' property setter must declare exactly one value carrier`);
    }
    return;
  }
  if (row.operationKind === "index-set") {
    const ownerSignatures = signature === undefined
      ? member?.declaration.signatures ?? []
      : [signature.declaration];
    if (ownerSignatures.length === 0) {
      fail(`row '${row.memberId ?? row.exportId}' index setter requires an exact index signature`);
    }
    const counts = new Set(ownerSignatures.map((candidate) => candidate.parameters.length + 1));
    if (counts.size !== 1) {
      fail(`row '${row.memberId ?? row.exportId}' spans index signatures with different parameter counts; declare exact signatureId rows`);
    }
    const [expectedCount] = counts;
    if ((row.parameterCarriers?.length ?? 0) !== expectedCount) {
      fail(`row '${row.memberId ?? row.exportId}' declares ${row.parameterCarriers?.length ?? 0} target parameter carriers for ${expectedCount} selected index/value inputs`);
    }
    return;
  }
  if (row.operationKind === "property" || row.target.form === "call-str-slice" ||
    row.target.form === "free-call-str-slice") {
    return;
  }
  const ownerSignatures = signature === undefined
    ? row.memberId === undefined
      ? exported?.declaration.signatures ?? []
      : member?.declaration.signatures ?? []
    : [signature.declaration];
  if (ownerSignatures.length === 0) {
    return;
  }
  if (row.target.form === "call-value-slice" || row.target.form === "call-value-array" ||
    row.target.form === "receiver-value-array" || row.target.form === "receiver-tagged-array") {
    const leadingArgumentCount = row.target.leadingArguments.length;
    if (ownerSignatures.some((candidate) => candidate.parameters.length < leadingArgumentCount)) {
      fail(`row '${row.memberId ?? row.exportId}' declares ${leadingArgumentCount} leading target arguments but its selected source signature has fewer parameters`);
    }
    return;
  }
  if (row.target.form === "call-c-variadic") {
    if (ownerSignatures.length !== 1) {
      fail(`row '${row.memberId ?? row.exportId}' C-variadic operation requires one exact selected source signature`);
      return;
    }
    const parameters = ownerSignatures[0]!.parameters;
    const restIndex = parameters.findIndex((parameter) => parameter.rest === true);
    if (restIndex !== parameters.length - 1 || restIndex < 0 ||
      parameters.slice(0, -1).some((parameter) => parameter.rest === true)) {
      fail(`row '${row.memberId ?? row.exportId}' C-variadic operation requires one trailing source rest parameter`);
    }
    if ((row.parameterCarriers?.length ?? 0) !== restIndex ||
      row.target.fixedArgumentModes.length !== restIndex) {
      fail(`row '${row.memberId ?? row.exportId}' C-variadic operation must exactly describe every fixed source parameter`);
    }
    return;
  }
  const counts = new Set(ownerSignatures.map((candidate) => candidate.parameters.length));
  if (counts.size !== 1) {
    fail(`row '${row.memberId ?? row.exportId}' spans signatures with different parameter counts; declare exact signatureId rows`);
  }
  const [expectedCount] = counts;
  const actualCount = row.parameterCarriers?.length ?? 0;
  if (actualCount !== expectedCount) {
    fail(`row '${row.memberId ?? row.exportId}' declares ${actualCount} target parameter carriers for ${expectedCount} selected source parameters`);
  }
}
