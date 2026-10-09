import { rustValueBlock, type RustValueBlockEntry } from "../../target-ast/value-block.js";
import { rustRecordFinalFieldContributions, rustRecordSpreadRetainsField } from "../objects/record-contributions.js";
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
import {
  isRustIntegerCarrier,
  rustEmptyObjectTargetId,
  isRustStringCarrier,
  rustOptionElementCarrier,
  rustSourceTypeCarrierValue,
} from "../../../target-model/types/index.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
import { planRustIndexedRecordStorage } from "../objects/indexed-records.js";
import { diagnosticInput, sourceTypePath } from "../program/plan-context.js";
import { expressionCarrier, requireExpressionCarrier, rustOperationFact } from "./fundamentals.js";
import {
  KindSpreadAssignment,
  ObjectLiteralProperty_Value,
  SpreadAssignment_Expression,
} from "@tsonic/target-api/source";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { parseSourceIntegerLiteral } from "../../../target-model/syntax/literals.js";
import { planExpression } from "./entry.js";
import { planRustNonConsumingValue } from "./typed-locations.js";
import { planRustRecordSpread } from "./record-spreads.js";
import { rustObjectLiteralRequiresDispatchImplementation } from "../objects/object-literal-implementations.js";
import { constructRustStructuralLiteral } from "../objects/object-literals/structural.js";
import { rustProjectStateMarker, rustProjectStateType } from "../objects/polymorphism/names.js";
import { rustTargetTypeRefEquals } from "../../../target-model/types/equality.js";
import { rustEffectiveValueCarrier } from "../../../analysis/facts/value-carrier-queries.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { tupleRustClosureArguments } from "../../target-ast/expressions.js";
import type { Node } from "@tsonic/tsts";
import type { RustExpr } from "../../target-ast/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustTargetOperationFact } from "../../../analysis/facts/keys.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import { rustReceiverIndependentMethodFactKey } from "../../../analysis/facts/operations/keys.js";
import { planRustClosedRecordLiteral } from "./closed-records.js";

export function planRecordLiteral(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  if (fact?.kind === "closed-record-literal") return planRustClosedRecordLiteral(node, fact, context);
  if (fact?.kind === "empty-object-literal") {
    if (fact.resultCarrier.kind !== "target-named" || fact.resultCarrier.id !== rustEmptyObjectTargetId ||
      context.input.program.source.ast.properties(node).length !== 0 ||
      !requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.empty-object")) {
      context.diagnostics.push(missingFactDiagnostic(diagnosticInput(context, node),
        "rust.backend.empty-object", "Empty object construction requires exact finalized empty syntax and identity storage."));
      return undefined;
    }
    return { kind: "call", path: "tsonic_rust_runtime::EmptyObject::new", args: [] };
  }
  if (fact?.kind === "provider-record-literal") {
    return planProviderRecordLiteral(node, fact, context);
  }
  if (fact?.kind === "record-index-literal") {
    return planIndexedRecordLiteral(node, fact, context);
  }
  if (fact === undefined || fact.kind !== "record-literal") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.record",
      "Object literals require a finalized record shape fact.",
    ));
    return undefined;
  }
  if (!requireExpressionCarrier(node, fact.resultCarrier, context, "rust.backend.record-literal-carrier")) {
    return undefined;
  }
  const value = fact.storage === "project-object"
    ? rustSourceTypeCarrierValue(fact.resultCarrier)
    : undefined;
  const typePath = value === undefined ? undefined : sourceTypePath(context, value);
  const projectDefinition = fact.storage === "project-object"
    ? context.input.program.projectTypes.definitionForCarrier(fact.resultCarrier)
    : undefined;
  const projectRepresentation = projectDefinition === undefined
    ? undefined
    : context.input.program.objectRepresentations.representationFor(projectDefinition);
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
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.record",
      "Object literal shape does not resolve to a generated Rust struct.",
    ));
    return undefined;
  }
  const { ast } = context.input.program.source;
  const properties = ast.properties(node);
  if (context.syntheticNames === undefined || properties.length !== fact.contributions.length ||
    fact.contributions.some((contribution, index) => contribution.property !== properties[index]) ||
    new Set(fact.fields.map((field) => field.sourceName)).size !== fact.fields.length ||
    new Set(fact.fields.map((field) => field.storageIndex)).size !== fact.fields.length) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.record-fields",
      "Object literal syntax does not match its finalized ordered contribution fact.",
    ));
    return undefined;
  }
  const bindings: RustValueBlockEntry[] = [];
  const valuesByStorageIndex = new Map<number, RustExpr>();
  const accessorValuesByStorageIndex = new Map<number, {
    getter?: RustExpr;
    setter?: RustExpr;
  }>();
  const finalContributionByStorageIndex = rustRecordFinalFieldContributions(fact);
  const finalContributionByMethod = new Map<Node, number>();
  fact.contributions.forEach((contribution, contributionIndex) => {
    if (contribution.kind === "property" || contribution.kind === "structural-method") {
      return;
    }
    if (contribution.kind === "method") {
      for (const declaration of contribution.contractDeclarations) {
        finalContributionByMethod.set(declaration, contributionIndex);
      }
      return;
    }
    if (contribution.kind === "accessor") {
      return;
    }
    for (const method of contribution.methods) {
      finalContributionByMethod.set(method.contractDeclaration, contributionIndex);
    }
  });
  const requiresObjectLiteralImplementation =
    rustObjectLiteralRequiresDispatchImplementation(fact, context);
  const implementationPlan = requiresObjectLiteralImplementation
    ? context.objectLiteralImplementations?.forExpression(node)
    : undefined;
  const objectLiteralImplementation = implementationPlan?.kind === "project" ? implementationPlan : undefined;
  if (requiresObjectLiteralImplementation && implementationPlan === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.object-literal-method-implementation",
      "Object literal methods require one exact finalized Rust dispatch implementation plan.",
    ));
    return undefined;
  }
  const methodValues = new Map<string, RustExpr>();
  for (const [contributionIndex, contribution] of fact.contributions.entries()) {
    if (contribution.kind === "property") {
      const nameNode = ast.name(contribution.property);
      const sourceName = nameNode === undefined ? "" : ast.text(nameNode);
      const initializer = ObjectLiteralProperty_Value(ast, contribution.property);
      const planned = initializer === undefined ? undefined : planExpression(initializer, context);
      if (sourceName !== contribution.sourceName || planned === undefined) {
        return undefined;
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
      const sourceNameNode = ast.name(contribution.property);
      const sourceName = sourceNameNode === undefined ? "" : ast.text(sourceNameNode);
      const planned = planExpression(contribution.expression, context);
      const field = fact.fields.find((candidate) =>
        candidate.storageIndex === contribution.targetStorageIndex);
      if (sourceName !== contribution.sourceName || planned === undefined ||
        field?.method !== true) {
        return undefined;
      }
      const independent = context.input.program.facts.getFact(contribution.expression, rustReceiverIndependentMethodFactKey);
      const storageCarrier = independent?.carrier ?? context.input.program.structuralShapes.field(
        fact.resultCarrier, field.storageIndex,
      )?.methodStorageCarrier;
      const rawStorageCarrier = field.presence === "optional"
        ? rustOptionElementCarrier(storageCarrier)
        : storageCarrier;
      if (rawStorageCarrier === undefined ||
        !rustTargetTypeRefEquals(
          independent?.carrier ?? expressionCarrier(contribution.expression, context),
          rawStorageCarrier,
        )) {
        return undefined;
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
      const sourceNameNode = ast.name(contribution.property);
      const sourceName = sourceNameNode === undefined ? "" : ast.text(sourceNameNode);
      const planned = planExpression(contribution.property, context);
      const field = fact.fields.find((candidate) =>
        candidate.storageIndex === contribution.targetStorageIndex);
      const plannedField = fact.storage === "structural-object"
        ? context.input.program.structuralShapes.field(
            fact.resultCarrier,
            contribution.targetStorageIndex,
          )
        : undefined;
      const plannedAccessor = fact.storage === "project-object"
        ? objectLiteralImplementation?.accessors.find((candidate) =>
            candidate.storageIndex === contribution.targetStorageIndex)
        : undefined;
      if (sourceName !== contribution.sourceName || planned === undefined ||
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
        return undefined;
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
        return undefined;
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
        return undefined;
      }
      for (const implementation of implementations) {
        if (implementation.kind !== "authored") {
          return undefined;
        }
        const closure = planExpression(contribution.expression, {
          ...context,
          typeParameterSubstitutions: new Map(implementation.typeParameterSubstitutions),
        });
        if (closure === undefined) {
          return undefined;
        }
        const bindingName = allocateRustSyntheticName(
          context.syntheticNames,
          "record_method",
        );
        const argumentsName = allocateRustSyntheticName(
          context.syntheticNames,
          "method_arguments",
        );
        const tupledClosure = tupleRustClosureArguments(
          closure,
          argumentsName,
          implementation.parameterCount + 1,
        );
        if (tupledClosure === undefined) {
          return undefined;
        }
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
    if (ast.kindName(contribution.property) !== KindSpreadAssignment ||
      spreadExpression !== contribution.expression) {
      return undefined;
    }
    const plannedSpread = planExpression(spreadExpression, context);
    if (plannedSpread === undefined) {
      return undefined;
    }
    const retainedFields = contribution.fields.filter(field =>
      rustRecordSpreadRetainsField(contribution, field, contributionIndex, finalContributionByStorageIndex));
    const retainedMethods = objectLiteralImplementation?.implementations.filter((implementation) =>
      implementation.kind === "spread" &&
        finalContributionByMethod.get(implementation.contractMethod) === contributionIndex) ?? [];
    const spread = planRustRecordSpread(contribution, plannedSpread, retainedFields, retainedMethods,
      valuesByStorageIndex, context);
    if (spread === undefined) return undefined;
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
      return undefined;
    }
    const accessor = accessorValuesByStorageIndex.get(field.storageIndex);
    if (accessor !== undefined) {
      if (fact.storage === "structural-object") {
        const plannedField = context.input.program.structuralShapes.field(
          fact.resultCarrier,
          field.storageIndex,
        );
        if (plannedField?.storage !== "property" || accessor.getter === undefined ||
          (accessor.setter !== undefined) !==
            (plannedField.property?.setterTargetName !== undefined)) {
          return undefined;
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
          return undefined;
        }
      }
      continue;
    }
    let value = valuesByStorageIndex.get(field.storageIndex);
    if (value === undefined) {
      const storageCarrier = field.method === true
        ? context.input.program.structuralShapes.field(fact.resultCarrier, field.storageIndex)?.methodStorageCarrier
        : field.carrier;
      const optionType = field.presence === "optional" &&
          rustOptionElementCarrier(storageCarrier) !== undefined
        ? rustTypeFromCarrierInContext(storageCarrier, context)
        : undefined;
      if (optionType === undefined) {
        return undefined;
      }
      value = { kind: "none" };
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
        return undefined;
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
    constructed = constructRustStructuralLiteral(implementationPlan, structuralInitializers);
  } else if (objectLiteralImplementation !== undefined) {
    if (objectLiteralImplementation.wrapperType.kind !== "named" ||
      objectLiteralImplementation.stateFields.length +
        objectLiteralImplementation.accessors.length !== fact.fields.length ||
      objectLiteralImplementation.implementations.some((implementation) =>
        !methodValues.has(implementation.fieldName))) {
      return undefined;
    }
    const implementationFields = [...objectLiteralImplementation.stateFields]
      .sort((left, right) => left.storageIndex - right.storageIndex)
      .map((field) => ({
        name: field.targetName,
        value: valuesByStorageIndex.get(field.storageIndex),
      }));
    if (implementationFields.some((field) => field.value === undefined)) {
      return undefined;
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
      return undefined;
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
        return undefined;
      }
      constructed = createRustProjectObject(
        typePath,
        statePath ?? typePath,
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
  if (!requireExpressionCarrier(
    node,
    fact.resultCarrier,
    context,
    "rust.backend.provider-record-literal-carrier",
  )) {
    return undefined;
  }
  const type = rustTypeFromCarrierInContext(fact.resultCarrier, context);
  const properties = context.input.program.source.ast.properties(node);
  if (
    type?.kind !== "named" ||
    properties.length !== fact.fields.length ||
    fact.fields.some((field, index) => field.property !== properties[index]) ||
    new Set(fact.fields.map((field) => field.targetName)).size !== fact.fields.length
  ) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.provider-record-literal",
      "Provider object-literal syntax conflicts with its finalized native struct construction fact.",
    ));
    return undefined;
  }
  const fields = fact.fields.map((field) => {
    const carrier = rustEffectiveValueCarrier(
      context.input.program.facts,
      field.expression,
    );
    const value = planExpression(field.expression, context);
    return carrier === undefined ||
        !rustTargetTypeRefEquals(carrier, field.storageCarrier) ||
        value === undefined
      ? undefined
      : { name: field.targetName, value };
  });
  if (fields.some((field) => field === undefined)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.provider-record-field",
      "Provider object-literal field values conflict with their finalized storage carriers.",
    ));
    return undefined;
  }
  if (fields.length === 0 && fact.completion === "default") {
    return { kind: "associated-call", owner: type,
      trait: { kind: "named", path: "core::default::Default" }, method: "default", args: [] };
  }
  return {
    kind: "struct-literal",
    path: type.path,
    fields: fields as readonly {
      readonly name: string;
      readonly value: RustExpr;
    }[],
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
  if (!requireExpressionCarrier(
    node,
    fact.resultCarrier,
    context,
    "rust.backend.record-index-literal-carrier",
  ) || context.syntheticNames === undefined) {
    return undefined;
  }
  const storage = planRustIndexedRecordStorage(fact.resultCarrier, fact.keyCarrier, fact.valueCarrier, fact.storage, context);
  const properties = context.input.program.source.ast.properties(node);
  if (storage === undefined ||
    properties.length !== fact.contributions.length ||
    fact.contributions.some((contribution, index) => contribution.property !== properties[index])) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.record-index-literal-contract",
      "Index-backed object literal conflicts with its finalized interface, contribution order, or generated storage contract.",
    ));
    return undefined;
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
      const key = rustProjectIndexLiteralKey(contribution.sourceName, fact.keyCarrier);
      if (value === undefined || key === undefined) {
        return undefined;
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
      return undefined;
    }
    effects.push({ expression: sourceStorage.copyEntries(
      planRustNonConsumingValue(contribution.expression, spread, context), entries,
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

function rustProjectIndexLiteralKey(
  sourceName: string,
  keyCarrier: TargetTypeRef,
): RustExpr | undefined {
  if (isRustStringCarrier(keyCarrier)) {
    return {
      kind: "call",
      path: "String::from",
      args: [{ kind: "str-literal", value: sourceName }],
    };
  }
  if (isRustIntegerCarrier(keyCarrier)) {
    const value = parseSourceIntegerLiteral(sourceName);
    return value === undefined
      ? undefined
      : { kind: "int-literal", text: value.toString(10) };
  }
  return undefined;
}
