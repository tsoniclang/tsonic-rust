import { rustValueBlock, type RustValueBlockEntry } from "../../target-ast/syntax/value-block.js";
import {
  createRustProjectObject,
  rustProjectObjectDispatchField,
  rustProjectObjectIdentityField,
  rustProjectObjectStateField,
} from "../objects/project-objects.js";
import {
  createRustStructuralObjectFromCarrier,
  rustDirectProjectFieldStoragePath,
} from "../objects/project-storage.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planRustIndexedRecordStorage } from "../objects/indexed-records.js";
import { failRustPlannerInvariant } from "../diagnostics.js";
import { rustOperationFact } from "./fundamentals.js";
import { planRustAbsentValue } from "./optional-storage.js";
import { planRustCallableExpressionBody } from "./callable.js";
import {
  KindSpreadAssignment,
  ObjectLiteralProperty_Value,
  SpreadAssignment_Expression,
} from "@tsonic/target-api/source";
import { planExpression } from "./entry.js";
import { planRustProviderRecordAbsentFields } from "./provider-record-absence.js";
import { planRustRecordSpread } from "./record-spreads.js";
import { rustObjectLiteralRequiresDispatchImplementation } from "../objects/object-literals/model.js";
import { constructRustStructuralLiteral } from "../objects/object-literals/structural.js";
import { rustProjectStateMarker, rustProjectStateType } from "../objects/polymorphism/names.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustTargetOperationFact } from "../../../target-model/records/operations/operations.js";

import { planRustClosedRecordLiteral } from "./closed-records.js";
import { planRustCapturedEnvironment } from "./capture-environments.js";
import { planRustReceiverFieldOwners, planRustReceiverOwners } from "./receiver-captures.js";

export function planRecordLiteral(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  if (fact?.kind === "closed-record-literal") return planRustClosedRecordLiteral(node, context);
  if (fact?.kind === "empty-object-literal") {
    return { kind: "call", path: "tsonic_rust_runtime::EmptyObject::new", args: [] };
  }
  if (fact?.kind === "provider-record-literal") {
    return planProviderRecordLiteral(node, fact, context);
  }
  if (fact?.kind === "record-index-literal") {
    return planIndexedRecordLiteral(node, fact, context);
  }
  if (fact === undefined || fact.kind !== "record-literal") {
    failRustPlannerInvariant("Object literals require a finalized record shape fact.", node);
  }
  const type = fact.storage === "project-object" ? rustTypeFromCarrierInContext(fact.resultCarrier, context) : undefined;
  const typePath = type?.kind === "named" ? type.path : undefined;
  const projectDefinition = fact.storage === "project-object"
    ? context.input.program.records.projectType.get(fact.resultCarrier)
    : undefined;
  const projectRepresentation = projectDefinition === undefined
    ? undefined
    : context.input.program.records.objectRepresentation.get(projectDefinition);
  const stateType = fact.storage === "project-object" && projectRepresentation?.kind !== "value"
    ? rustProjectStateType(fact.resultCarrier, context)
    : undefined;
  const stateMarker = projectDefinition === undefined
    ? undefined
    : rustProjectStateMarker(projectDefinition, context);
  const statePath = stateType?.kind === "named" ? stateType.path : undefined;
  if (fact.storage === "project-object" &&
    (typePath === undefined || projectRepresentation === undefined ||
      projectRepresentation.kind !== "value" && statePath === undefined)) {
    failRustPlannerInvariant("Object literal shape does not resolve to a generated Rust struct.", node);
  }
  const { ast } = context.input.program.source;
  const properties = ast.properties(node);
  const contributionEvidence = context.input.program.records.recordContribution.get(fact);
  if (contributionEvidence === undefined || context.syntheticNames === undefined || properties.length !== fact.contributions.length ||
    fact.contributions.some((contribution, index) => contribution.property !== properties[index]) ||
    new Set(fact.fields.map((field) => field.sourceName)).size !== fact.fields.length ||
    new Set(fact.fields.map((field) => field.storageIndex)).size !== fact.fields.length) {
    failRustPlannerInvariant("Object literal syntax does not match its finalized ordered contribution fact.", node);
  }
  const bindings: RustValueBlockEntry[] = [];
  const valuesByStorageIndex = new Map<number, RustExpr>();
  const accessorValuesByStorageIndex = new Map<number, {
    getter?: RustExpr;
    setter?: RustExpr;
  }>();
  const finalContributionByStorageIndex = contributionEvidence.finalFields;
  const finalContributionByMethod = contributionEvidence.finalMethods;
  const requiresObjectLiteralImplementation =
    rustObjectLiteralRequiresDispatchImplementation(node, context);
  const implementationPlan = requiresObjectLiteralImplementation
    ? context.objectLiteralImplementations?.forExpression(node)
    : undefined;
  const objectLiteralImplementation = implementationPlan?.kind === "project" ? implementationPlan : undefined;
  if (requiresObjectLiteralImplementation && implementationPlan === undefined) {
    failRustPlannerInvariant("Object literal methods require one exact finalized Rust dispatch implementation plan.", node);
  }
  const methodValues = new Map<string, RustExpr>();
  for (const [contributionIndex, contribution] of fact.contributions.entries()) {
    if (contribution.kind === "property") {
      const initializer = ObjectLiteralProperty_Value(ast, contribution.property);
      const planned = initializer === undefined ? undefined : planExpression(initializer, context);
      if (planned === undefined) {
        failRustPlannerInvariant("An admitted record requires its exact native construction evidence.", node);
      }
      const bindingName = allocateRustSyntheticName(
        context.syntheticNames,
        finalContributionByStorageIndex.get(contribution.targetStorageIndex) === contributionIndex
          ? `record_${contribution.sourceName}`
          : `_record_${contribution.sourceName}`,
      );
      bindings.push({ name: bindingName, value: planned });
      if (finalContributionByStorageIndex.get(contribution.targetStorageIndex) === contributionIndex) {
        valuesByStorageIndex.set(
          contribution.targetStorageIndex,
          { kind: "path", path: bindingName },
        );
      }
      continue;
    }
    if (contribution.kind === "structural-method") {
      const selected = context.input.program.records.structuralShape.get(fact.resultCarrier)?.fields[contribution.targetStorageIndex]?.methodPlan;
      let planned: RustExpr | undefined;
      if (selected?.kind === "fixed") {
        if (selected.declaration !== contribution.expression)
          failRustPlannerInvariant("A fixed method requires its exact checked native body and captured environment.", contribution.expression);
        const payload = selected.payload;
        const captures = planRustCapturedEnvironment(contribution.expression, payload.captures, context,
          { staticStorage: false, mutableValueCapture: false });
        const fields = planRustReceiverFieldOwners(payload.receiverFields, context, context,
          { staticStorage: false, offset: payload.captures.length }, contribution.expression);
        const receivers = planRustReceiverOwners(contribution.expression, payload.receivers, context, context,
          { staticStorage: false, offset: payload.captures.length + payload.receiverFields.length });
        if (captures === undefined || fields === undefined || receivers === undefined)
          failRustPlannerInvariant("A fixed method requires its selected native capture operations.", contribution.expression);
        const nativeBindings = [...captures.bindings, ...fields.bindings, ...receivers.bindings];
        bindings.push(...nativeBindings);
        const retainedReceivers = payload.receivers.map(capture => {
          const selected = receivers.context.expressionOverrides?.get(capture.reference);
          if (selected === undefined) failRustPlannerInvariant("A fixed method requires its exact captured native receiver.", capture.reference);
          return selected.expression;
        });
        planned = { kind: "tuple-literal", elements: [...[...captures.bindings, ...fields.bindings]
          .map(binding => ({ kind: "path" as const, path: binding.name })), ...retainedReceivers] };
      } else planned = planExpression(contribution.expression, context);
      const field = fact.fields.find((candidate) =>
        candidate.storageIndex === contribution.targetStorageIndex);
      if (planned === undefined ||
        field?.method !== true) {
        failRustPlannerInvariant("An admitted record requires its exact native construction evidence.", node);
      }
      const bindingName = allocateRustSyntheticName(
        context.syntheticNames,
        "record_method",
      );
      bindings.push({
        name: bindingName,
        value: field.presence === "optional"
          ? { kind: "call", path: "Some", args: [planned] }
          : planned,
      });
      valuesByStorageIndex.set(
        contribution.targetStorageIndex,
        { kind: "path", path: bindingName },
      );
      continue;
    }
    if (contribution.kind === "accessor") {
      const planned = planExpression(contribution.property, context);
      const field = fact.fields.find((candidate) =>
        candidate.storageIndex === contribution.targetStorageIndex);
      const plannedField = fact.storage === "structural-object"
        ? context.input.program.records.structuralShape.get(fact.resultCarrier)?.fields[contribution.targetStorageIndex]
        : undefined;
      const plannedAccessor = fact.storage === "project-object"
        ? objectLiteralImplementation?.accessors.find((candidate) =>
            candidate.storageIndex === contribution.targetStorageIndex)
        : undefined;
      if (planned === undefined ||
        field === undefined ||
        (fact.storage === "structural-object" && (
          plannedField?.storage !== "property" ||
          contribution.role === "set" &&
            plannedField.property?.setterTargetName === undefined
        )) ||
        (fact.storage === "project-object" && (
          plannedAccessor === undefined ||
          contribution.role === "set" && plannedAccessor.setter === undefined
        ))) {
        failRustPlannerInvariant("An admitted record requires its exact native construction evidence.", node);
      }
      const bindingName = allocateRustSyntheticName(
        context.syntheticNames,
        contribution.role === "get" ? "record_getter" : "record_setter",
      );
      bindings.push({ name: bindingName, value: planned });
      const existing = accessorValuesByStorageIndex.get(
        contribution.targetStorageIndex,
      ) ?? {};
      if (existing[contribution.role === "get" ? "getter" : "setter"] !== undefined) {
        failRustPlannerInvariant("An admitted record requires its exact native construction evidence.", node);
      }
      accessorValuesByStorageIndex.set(contribution.targetStorageIndex, {
        ...existing,
        [contribution.role === "get" ? "getter" : "setter"]: {
          kind: "path",
          path: bindingName,
        },
      });
      continue;
    }
    if (contribution.kind === "method") {
      const implementations = objectLiteralImplementation?.implementations.filter((implementation) =>
        implementation.kind === "authored" &&
          implementation.sourceCallable === contribution.expression) ?? [];
      if (implementations.length === 0) {
        failRustPlannerInvariant("An admitted record requires its exact native construction evidence.", node);
      }
      for (const implementation of implementations) {
        if (implementation.kind !== "authored") {
          failRustPlannerInvariant("An admitted record requires its exact native construction evidence.", node);
        }
        const bindingName = allocateRustSyntheticName(context.syntheticNames, "record_method");
        const argumentsName = allocateRustSyntheticName(context.syntheticNames, "method_arguments");
        const tupledClosure = planRustCallableExpressionBody(contribution.expression, {
          ...context, typeParameterSubstitutions: new Map(implementation.typeParameterSubstitutions),
        }, "value", "producer", { name: argumentsName, arity: implementation.parameterCount + 1 })?.expression;
        if (tupledClosure === undefined) failRustPlannerInvariant("An admitted object method requires its exact native tuple closure.", contribution.expression);
        bindings.push({
          name: bindingName,
          value: {
            kind: "associated-call",
            owner: implementation.callableType,
            method: "new",
            args: [tupledClosure],
          },
        });
        methodValues.set(implementation.fieldName, { kind: "path", path: bindingName });
      }
      continue;
    }
    const spreadExpression = SpreadAssignment_Expression(ast, contribution.property);
    const spreadEvidence = contributionEvidence.spreads.get(contribution);
    if (ast.kindName(contribution.property) !== KindSpreadAssignment ||
      spreadExpression !== contribution.expression || spreadEvidence === undefined) {
      failRustPlannerInvariant("An admitted record requires its exact native construction evidence.", node);
    }
    const plannedSpread = planExpression(spreadExpression, context);
    if (plannedSpread === undefined) {
      failRustPlannerInvariant("An admitted record requires its exact native construction evidence.", node);
    }
    const retainedFields = contribution.fields.filter(field => spreadEvidence.retained.has(field));
    const retainedMethods = objectLiteralImplementation?.implementations.filter((implementation) =>
      implementation.kind === "spread" &&
        finalContributionByMethod.get(implementation.contractMethod) === contributionIndex) ?? [];
    const spread = planRustRecordSpread(contribution, plannedSpread, retainedFields, retainedMethods,
      valuesByStorageIndex, spreadEvidence, context);
    if (spread === undefined) failRustPlannerInvariant("An admitted record requires its exact native construction evidence.", node);
    bindings.push(...spread.bindings);
    for (const [index, value] of spread.fields) valuesByStorageIndex.set(index, value);
    for (const [name, value] of spread.methods) methodValues.set(name, value);
  }
  const structuralInitializers: import("../objects/project-storage.js")
    .RustStructuralObjectFieldInitializer[] = [];
  const projectFields: { name: string; value: RustExpr }[] = [];
  for (const field of [...fact.fields].sort((left, right) => left.storageIndex - right.storageIndex)) {
    if (fact.storage === "structural-object" &&
      field.storageIndex !== structuralInitializers.length) {
      failRustPlannerInvariant("An admitted record requires its exact native construction evidence.", node);
    }
    const accessor = accessorValuesByStorageIndex.get(field.storageIndex);
    if (accessor !== undefined) {
      if (fact.storage === "structural-object") {
        const plannedField = context.input.program.records.structuralShape.get(fact.resultCarrier)?.fields[field.storageIndex];
        if (plannedField?.storage !== "property" || accessor.getter === undefined ||
          (accessor.setter !== undefined) !==
            (plannedField.property?.setterTargetName !== undefined)) {
          failRustPlannerInvariant("An admitted record requires its exact native construction evidence.", node);
        }
        structuralInitializers.push({
          kind: "accessor",
          getter: accessor.getter,
          ...(accessor.setter === undefined ? {} : { setter: accessor.setter }),
        });
      } else {
        const plannedAccessor = objectLiteralImplementation?.accessors.find((candidate) =>
          candidate.storageIndex === field.storageIndex);
        if (plannedAccessor === undefined || accessor.getter === undefined ||
          (accessor.setter !== undefined) !== (plannedAccessor.setter !== undefined)) {
          failRustPlannerInvariant("An admitted record requires its exact native construction evidence.", node);
        }
      }
      continue;
    }
    let value = valuesByStorageIndex.get(field.storageIndex);
    if (value === undefined) {
      const storageCarrier = field.method === true
        ? context.input.program.records.structuralShape.get(fact.resultCarrier)?.fields[field.storageIndex]?.methodPlan?.carrier : field.carrier;
      if (field.presence !== "optional" || storageCarrier === undefined)
        failRustPlannerInvariant("An admitted absent field requires its exact selected optional storage.", node);
      value = planRustAbsentValue(storageCarrier, context);
      valuesByStorageIndex.set(field.storageIndex, value);
    }
    structuralInitializers.push({
      kind: field.method === true ? "method" : "stored",
      value,
    });
    if (fact.storage === "project-object" && objectLiteralImplementation === undefined) {
      const storagePath = rustDirectProjectFieldStoragePath(
        fact.resultCarrier,
        field.storageIndex,
        context,
      );
      if (storagePath?.length !== 1) {
        failRustPlannerInvariant("An admitted record requires its exact native construction evidence.", node);
      }
      projectFields.push({ name: storagePath[0]!, value });
    }
  }
  if (fact.storage === "structural-object" || projectRepresentation?.kind !== "value") {
    context.usedAliases?.add("rt");
  }
  if (stateMarker !== undefined) {
    projectFields.push({ name: stateMarker.name, value: stateMarker.value });
  }
  let constructed: RustExpr | undefined;
  if (implementationPlan?.kind === "structural") {
    constructed = constructRustStructuralLiteral(implementationPlan, structuralInitializers, context);
  } else if (objectLiteralImplementation !== undefined) {
    if (objectLiteralImplementation.wrapperType.kind !== "named" ||
      objectLiteralImplementation.stateFields.length +
        objectLiteralImplementation.accessors.length !== fact.fields.length ||
      objectLiteralImplementation.implementations.some((implementation) =>
        !methodValues.has(implementation.fieldName))) {
      failRustPlannerInvariant("An admitted record requires its exact native construction evidence.", node);
    }
    const implementationFields = [...objectLiteralImplementation.stateFields]
      .sort((left, right) => left.storageIndex - right.storageIndex)
      .map((field) => ({
        name: field.targetName,
        value: valuesByStorageIndex.get(field.storageIndex),
      }));
    if (implementationFields.some((field) => field.value === undefined)) {
      failRustPlannerInvariant("An admitted record requires its exact native construction evidence.", node);
    }
    const identityName = allocateRustSyntheticName(context.syntheticNames, "record_identity");
    const rootName = allocateRustSyntheticName(context.syntheticNames, "record_root");
    const accessorImplementationFields = objectLiteralImplementation.accessors.flatMap(
      (accessor): { readonly name: string; readonly value: RustExpr | undefined }[] => {
        const values = accessorValuesByStorageIndex.get(accessor.storageIndex);
        return [{
          name: accessor.getter.fieldName,
          value: values?.getter,
        }, ...(accessor.setter === undefined
          ? []
          : [{
              name: accessor.setter.fieldName,
              value: values?.setter,
            }])];
      },
    );
    if (accessorImplementationFields.some((field) => field.value === undefined)) {
      failRustPlannerInvariant("An admitted record requires its exact native construction evidence.", node);
    }
    bindings.push({
      name: identityName,
      value: { kind: "call", path: "rt::ObjectIdentity::new", args: [] },
    }, {
      name: rootName,
      value: {
        kind: "call",
        path: "alloc::rc::Rc::new",
        args: [{
          kind: "struct-literal",
          path: objectLiteralImplementation.rootName,
          fields: [{
            name: rustProjectObjectIdentityField,
            value: {
              kind: "method-call",
              receiver: { kind: "path", path: identityName },
              method: "clone",
              args: [],
            },
          }, {
            name: rustProjectObjectStateField,
            value: {
              kind: "call",
              path: "rt::ObjectHandle::new",
              args: [{
                kind: "struct-literal",
                path: objectLiteralImplementation.stateName,
                fields: [
                  ...implementationFields.map((field) => ({
                    name: field.name,
                    value: field.value!,
                  })),
                  ...objectLiteralImplementation.methodOverrides.map((override) => ({
                    name: override.fieldName,
                    value: { kind: "none" as const },
                  })),
                ],
              }],
            },
          }, ...objectLiteralImplementation.implementations.map((implementation) => ({
            name: implementation.fieldName,
            value: methodValues.get(implementation.fieldName)!,
          })), ...accessorImplementationFields.map((field) => ({
            name: field.name,
            value: field.value!,
          }))],
        }],
      },
    });
    constructed = {
      kind: "struct-literal",
      path: objectLiteralImplementation.wrapperType.path,
      fields: [{
        name: rustProjectObjectIdentityField,
        value: { kind: "path", path: identityName },
      }, {
        name: rustProjectObjectDispatchField,
        value: { kind: "path", path: rootName },
      }],
    };
  } else {
    if (fact.storage === "project-object") {
      if (typePath === undefined || projectRepresentation === undefined) {
        failRustPlannerInvariant("An admitted record requires its exact native construction evidence.", node);
      }
      constructed = createRustProjectObject(
        typePath,
        projectRepresentation.kind === "value" ? typePath : statePath ?? failRustPlannerInvariant("An admitted project object requires its native state type.", node),
        projectFields,
        projectRepresentation,
      );
    } else {
      constructed = createRustStructuralObjectFromCarrier(
        fact.resultCarrier,
        structuralInitializers,
        context,
      );
    }
  }
  return constructed === undefined
    ? undefined
    : bindings.length === 0
      ? constructed
      : rustValueBlock(bindings, constructed);
}

function planProviderRecordLiteral(
  node: Node,
  fact: Extract<
    RustTargetOperationFact,
    { readonly kind: "provider-record-literal" }
  >,
  context: RustPlanContext,
): RustExpr | undefined {
  const type = rustTypeFromCarrierInContext(fact.resultCarrier, context);
  const properties = context.input.program.source.ast.properties(node);
  if (
    type?.kind !== "named" ||
    properties.length !== fact.fields.length ||
    fact.fields.some((field, index) => field.property !== properties[index]) ||
    new Set([...fact.fields, ...fact.absentFields].map((field) => field.targetName)).size !==
      fact.fields.length + fact.absentFields.length || fact.completion === "default" && fact.absentFields.length !== 0
  ) {
    failRustPlannerInvariant("Provider object-literal syntax conflicts with its finalized native struct construction fact.", node);
  }
  const fields = fact.fields.map(field => {
    const value = planExpression(field.expression, context);
    return value === undefined ? undefined : { name: field.targetName, value };
  });
  if (fields.some((field) => field === undefined)) {
    failRustPlannerInvariant("Provider object-literal field values conflict with their finalized storage carriers.", node);
  }
  const absentFields = planRustProviderRecordAbsentFields(fact.absentFields, context);
  if (absentFields === undefined) failRustPlannerInvariant("An admitted record requires its exact native construction evidence.", node);
  if (fields.length === 0 && fact.completion === "default") {
    return { kind: "associated-call", owner: type,
      trait: { kind: "named", path: "core::default::Default" }, method: "default", args: [] };
  }
  return {
    kind: "struct-literal",
    path: type.path,
    fields: [...fields as readonly {
      readonly name: string;
      readonly value: RustExpr;
    }[], ...absentFields],
    ...(fact.completion === "default"
      ? {
          base: {
            kind: "call" as const,
            path: "Default::default",
            args: [],
          },
        }
      : {}),
  };
}

function planIndexedRecordLiteral(
  node: Node,
  fact: Extract<RustTargetOperationFact, { readonly kind: "record-index-literal" }>,
  context: RustPlanContext,
): RustExpr | undefined {
  if (context.syntheticNames === undefined) failRustPlannerInvariant("An admitted indexed literal requires its native name scope.", node);
  const storage = planRustIndexedRecordStorage(fact.resultCarrier, fact.keyCarrier, fact.valueCarrier, fact.storage, context);
  const properties = context.input.program.source.ast.properties(node);
  if (storage === undefined ||
    properties.length !== fact.contributions.length ||
    fact.contributions.some((contribution, index) => contribution.property !== properties[index])) {
    failRustPlannerInvariant("Index-backed object literal conflicts with its finalized interface, contribution order, or generated storage contract.", node);
  }
  const entriesName = allocateRustSyntheticName(context.syntheticNames, "record_entries");
  const entries: RustExpr = { kind: "path", path: entriesName };
  const effects: { readonly expression: RustExpr; readonly discard: "unit" | "value" }[] = [];
  for (const contribution of fact.contributions) {
    if (contribution.kind === "property") {
      const initializer = ObjectLiteralProperty_Value(context.input.program.source.ast, contribution.property);
      const value = initializer === contribution.expression
        ? planExpression(contribution.expression, context)
        : undefined;
      const selectedKey = context.input.program.records.indexedRecordKey.get(contribution.property)
        ?? failRustPlannerInvariant("An admitted indexed literal requires its exact native key recipe.", contribution.property);
      const key: RustExpr = selectedKey.kind === "integer" ? { kind: "int-literal", text: selectedKey.value }
        : { kind: "call", path: "String::from", args: [{ kind: "str-literal", value: selectedKey.value }] };
      if (value === undefined || key === undefined) {
        failRustPlannerInvariant("An admitted record requires its exact native construction evidence.", node);
      }
      effects.push({ expression: { kind: "method-call", receiver: entries, receiverMode: "mut-ref", method: "insert", args: [key, value] },
        discard: "value" });
      continue;
    }
    const spreadExpression = SpreadAssignment_Expression(
      context.input.program.source.ast,
      contribution.property,
    );
    const spread = spreadExpression === contribution.expression
      ? planExpression(contribution.expression, context)
      : undefined;
    const sourceStorage = planRustIndexedRecordStorage(contribution.sourceCarrier, fact.keyCarrier, fact.valueCarrier,
      contribution.sourceStorage, context);
    if (spread === undefined || sourceStorage === undefined) {
      failRustPlannerInvariant("An admitted record requires its exact native construction evidence.", node);
    }
    effects.push({ expression: sourceStorage.copyEntries(
      spread, entries,
    ), discard: "unit" });
  }
  if (effects.length === 0) {
    return storage.construct({ kind: "call", path: "std::collections::HashMap::new", args: [] });
  }
  let value = storage.construct(entries);
  for (let index = effects.length - 1; index >= 0; index--) {
    const effect = effects[index]!;
    value = { kind: "evaluate-then", effect: effect.expression, discard: effect.discard, value };
  }
  const capacity = fact.contributions.filter((contribution) => contribution.kind === "property").length;
  return rustValueBlock([{ name: entriesName, mutable: true, value: {
      kind: "call", path: "std::collections::HashMap::with_capacity",
      args: [{ kind: "int-literal", text: capacity.toString(10) }],
    } }], value);
}


