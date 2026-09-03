import { asRecord, requireExactKeys, requireRustIdentifier, validateCarrier, validateValueConversion } from "./carriers.js";
import { closedMetadataKey } from "../../../target-model/metadata/closed-data.js";
import { isRustFallibleErrorBoundary } from "../../../target-model/operations/error-boundary.js";
import {
  rustProviderOperationFormAcceptsTargetGenericArguments,
  rustProviderOperationFormContractViolation,
  rustProviderOperationFormDeclaresWritableInput,
} from "../../../policy/operations/forms.js";
import { isRustUnitCarrier, rustTargetGenericReferences } from "../../../target-model/types/index.js";
import { validateOperationForm } from "./forms.js";
import {
  genericArgumentCarriers,
  validateGenericReferences,
  validateProviderGenericParameters,
  validateTargetGenericArguments,
} from "./generics.js";
import type { ExportRecord, Fail, MemberRecord, SignatureRecord } from "./model.js";
import type { RustProviderOperationForm } from "../../../target-model/operations/model.js";
import type { RustProviderPackageDefinition } from "../model.js";
import type { RustProviderTypeParameterRequirement } from "../../../target-model/operations/model.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";

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
      "parameterCarriers", "receiverCarrier", "genericParameters", "typeRequirements", "targetGenericArguments", "resultConversion", "evaluation", "isAsync", "isFallible", "errorBoundary", "errorCarrier", "isUnsafe", "immediateCallback",
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
    const declaredGenerics = validateProviderGenericParameters(
      row.genericParameters,
      undefined,
      definition,
      `${label}.genericParameters`,
      fail,
      { alignSourceParameters: false },
    );
    validateTypeParameterRequirements(
      row.typeRequirements,
      declaredGenerics.typeNames,
      definition,
      `${label}.typeRequirements`,
      fail,
    );
    if (row.targetGenericArguments !== undefined && (
      !Array.isArray(row.targetGenericArguments) || row.targetGenericArguments.length === 0 ||
      !rustProviderOperationFormAcceptsTargetGenericArguments(row.target)
    )) {
      fail(`${label}.targetGenericArguments requires a non-empty native call or method generic-argument list`);
    }
    validateTargetGenericArguments(
      row.targetGenericArguments ?? [],
      definition,
      `${label}.targetGenericArguments`,
      fail,
    );
    for (const [index, carrier] of (row.parameterCarriers ?? []).entries()) {
      validateCarrier(
        carrier,
        definition,
        `${label}.parameterCarriers[${index}]`,
        fail,
        { allowImmediateClosure: row.immediateCallback?.sourceArgumentIndex === index },
      );
    }
    const genericCarriers = [
      row.resultCarrier,
      ...(row.receiverCarrier === undefined ? [] : [row.receiverCarrier]),
      ...(row.parameterCarriers ?? []),
      ...genericArgumentCarriers(row.targetGenericArguments),
      ...operationFormCarriers(row.target),
      ...(row.immediateCallback === undefined
        ? []
        : operationFormCarriers(row.immediateCallback.fallibleTarget)),
      ...(row.genericParameters ?? []).flatMap((parameter) =>
        parameter.kind === "lifetime" || parameter.defaultArgument === undefined
          ? []
          : genericArgumentCarriers([parameter.defaultArgument])),
      ...valueConversionCarriers(row.resultConversion),
    ];
    validateGenericReferences(
      [...genericCarriers, ...typeRequirementCarriers(row.typeRequirements)],
      declaredGenerics,
      `${label} operation contract`,
      fail,
    );
    const referenced = combineGenericReferences(genericCarriers);
    for (const name of declaredGenerics.typeNames) {
      if (!referenced.typeNames.has(name)) {
        fail(`${label}.genericParameters declares unused type parameter '${name}'`);
      }
    }
    for (const identity of declaredGenerics.lifetimeIdentities) {
      if (!referenced.lifetimeIdentities.has(identity)) {
        fail(`${label}.genericParameters declares unused lifetime parameter '${identity}'`);
      }
    }
    for (const identity of declaredGenerics.constIdentities) {
      if (!referenced.constIdentities.has(identity)) {
        fail(`${label}.genericParameters declares unused const parameter '${identity}'`);
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
      if (entry === "clone" || entry === "copy") {
        return entry;
      }
      const entryWhere = `${where}.${requirement.name}.requirements[${index}]`;
      requireExactKeys(asRecord(entry), [
        "kind",
        "path",
        "genericArguments",
        "associatedConstraints",
        "lifetimeBinder",
      ], entryWhere, fail);
      if (entry.kind !== "trait") {
        fail(`${entryWhere}.kind must be 'trait'`);
      }
      validateCarrier(typeRequirementTraitRef(entry), definition, entryWhere, fail, {
        allowUnsized: true,
      });
      return `trait:${closedMetadataKey(entry)}`;
    });
    if (keys.length === 0 || new Set(keys).size !== keys.length ||
      keys.some((entry, index) => index > 0 && entry < keys[index - 1]!)) {
      fail(`${where}.${requirement.name} must contain a non-empty canonical target requirement set`);
    }
  }
}

export function typeRequirementCarriers(
  requirements: readonly RustProviderTypeParameterRequirement[] | undefined,
): readonly TargetTypeRef[] {
  return (requirements ?? []).flatMap((parameter) =>
    parameter.requirements.flatMap((requirement) =>
      typeof requirement === "object" ? [typeRequirementTraitRef(requirement)] : []));
}

function typeRequirementTraitRef(
  requirement: Extract<RustProviderTypeParameterRequirement["requirements"][number], object>,
): import("../../../target-model/types/model.js").RustTargetTraitRef {
  return {
    kind: "trait-ref",
    id: `provider-requirement:${requirement.path}`,
    path: requirement.path,
    genericArguments: requirement.genericArguments,
    associatedConstraints: requirement.associatedConstraints,
    ...(requirement.lifetimeBinder === undefined
      ? {}
      : { lifetimeBinder: requirement.lifetimeBinder }),
  };
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
  if (form.form === "source-module-construction") {
    return form.bootstrap.errorCarrier === undefined
      ? []
      : [form.bootstrap.errorCarrier];
  }
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
    return [form.owner, ...genericArgumentCarriers(form.traitGenericArguments)];
  }
  if (form.form === "associated-value") {
    return [form.owner];
  }
  return [];
}

function valueConversionCarriers(
  conversion: import("../../../target-model/operations/model.js").RustValueConversion | undefined,
): readonly TargetTypeRef[] {
  if (conversion === undefined || conversion.kind === "semantic-conversion" ||
    conversion.kind === "numeric-promotion") return [];
  if (conversion.kind === "raw-pointer-mut-to-const") return [conversion.pointee];
  if (conversion.kind === "copy-from-reference") return [conversion.target];
  if (conversion.kind === "source-union-variant" || conversion.kind === "bottom-coercion" ||
    conversion.kind === "js-argument-vector-callback") {
    return [conversion.source, conversion.target];
  }
  if (conversion.kind === "js-value-from-closed-carrier" ||
    conversion.kind === "ts-value-from-closed-carrier") {
    return [conversion.source];
  }
  if (conversion.kind === "js-value-from-option" ||
    conversion.kind === "js-value-from-array") {
    return [
      conversion.source,
      conversion.element,
      ...valueConversionCarriers(conversion.elementConversion),
    ];
  }
  if (conversion.kind === "js-value-from-source-union") {
    return [
      conversion.source,
      ...conversion.variants.flatMap((variant) => [
        variant.carrier,
        ...valueConversionCarriers(variant.conversion),
      ]),
    ];
  }
  if (conversion.kind === "js-value-from-structural-to-json") {
    return [
      conversion.source,
      conversion.resultCarrier,
      ...valueConversionCarriers(conversion.resultConversion),
    ];
  }
  if (conversion.kind === "js-value-from-structural-object") {
    return [
      conversion.source,
      ...conversion.fields.flatMap((field) => [
        field.sourceCarrier,
        ...valueConversionCarriers(field.conversion),
      ]),
    ];
  }
  if (conversion.kind === "option-some") return [conversion.element];
  return valueConversionCarriers(conversion.elementConversion);
}

function combineGenericReferences(carriers: readonly TargetTypeRef[]): {
  readonly typeNames: ReadonlySet<string>;
  readonly lifetimeIdentities: ReadonlySet<string>;
  readonly constIdentities: ReadonlySet<string>;
} {
  const typeNames = new Set<string>();
  const lifetimeIdentities = new Set<string>();
  const constIdentities = new Set<string>();
  for (const carrier of carriers) {
    const references = rustTargetGenericReferences(carrier);
    references.typeNames.forEach((name) => typeNames.add(name));
    references.lifetimeIdentities.forEach((identity) => lifetimeIdentities.add(identity));
    references.constIdentities.forEach((identity) => constIdentities.add(identity));
  }
  return { typeNames, lifetimeIdentities, constIdentities };
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
