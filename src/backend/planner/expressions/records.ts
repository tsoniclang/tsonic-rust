import {
  createRustProjectObject,
  readRustProjectObjectIndexStorage,
  rustProjectObjectDispatchField,
  rustProjectObjectIdentityField,
  rustProjectObjectStateField,
} from "../objects/project-objects.js";
import {
  createRustStructuralObjectFromCarrier,
  readRustStoredObjectField,
  readRustStructuralObjectMethodStorage,
  rustDirectProjectFieldStoragePath,
  rustProjectObjectRepresentation,
} from "../objects/project-storage.js";
import {
  isRustIntegerCarrier,
  isRustStringCarrier,
  rustOptionElementCarrier,
  rustSourceTypeCarrierValue,
  rustStructuralMethodStorageCarrier,
} from "../../../target-model/types/index.js";
import { allocateRustSyntheticName } from "../names/synthetic.js";
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
import { planRustBoundProjectMethodCallable } from "./properties.js";
import { rustObjectLiteralRequiresDispatchImplementation } from "../objects/object-literal-implementations.js";
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

export function planRecordLiteral(node: Node, context: RustPlanContext): RustExpr | undefined {
  const fact = rustOperationFact(node, context);
  if (fact?.kind === "provider-record-literal") {
    return planProviderRecordLiteral(node, fact, context);
  }
  if (fact?.kind === "record-index-literal") {
    return planProjectIndexRecordLiteral(node, fact, context);
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
  const bindings: {
    readonly name: string;
    readonly value: RustExpr;
  }[] = [];
  const valuesByStorageIndex = new Map<number, RustExpr>();
  const accessorValuesByStorageIndex = new Map<number, {
    getter?: RustExpr;
    setter?: RustExpr;
  }>();
  const finalContributionByStorageIndex = new Map<number, number>();
  const finalContributionByMethod = new Map<Node, number>();
  fact.contributions.forEach((contribution, contributionIndex) => {
    if (contribution.kind === "property" || contribution.kind === "structural-method") {
      finalContributionByStorageIndex.set(
        contribution.targetStorageIndex,
        contributionIndex,
      );
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
    for (const field of contribution.fields) {
      finalContributionByStorageIndex.set(field.targetStorageIndex, contributionIndex);
    }
    for (const method of contribution.methods) {
      finalContributionByMethod.set(method.contractDeclaration, contributionIndex);
    }
  });
  const requiresObjectLiteralImplementation =
    rustObjectLiteralRequiresDispatchImplementation(fact, context);
  const objectLiteralImplementation = requiresObjectLiteralImplementation
    ? context.objectLiteralImplementations?.forExpression(node)
    : undefined;
  if (requiresObjectLiteralImplementation && objectLiteralImplementation === undefined) {
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
      const storageCarrier = rustStructuralMethodStorageCarrier(
        fact.resultCarrier,
        field.carrier,
        field.presence,
      );
      const rawStorageCarrier = field.presence === "optional"
        ? rustOptionElementCarrier(storageCarrier)
        : storageCarrier;
      if (rawStorageCarrier === undefined ||
        !rustTargetTypeRefEquals(
          expressionCarrier(contribution.expression, context),
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
      const plannedField = fact.storage === "object-handle"
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
        (fact.storage === "object-handle" && (
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
    const retainedFields = contribution.fields.filter((field) =>
      finalContributionByStorageIndex.get(field.targetStorageIndex) === contributionIndex);
    const retainedMethods = objectLiteralImplementation?.implementations.filter((implementation) =>
      implementation.kind === "spread" &&
        finalContributionByMethod.get(implementation.contractMethod) === contributionIndex) ?? [];
    const spreadName = allocateRustSyntheticName(
      context.syntheticNames,
      retainedFields.length === 0 && retainedMethods.length === 0
        ? "_record_spread"
        : "record_spread",
    );
    bindings.push({ name: spreadName, value: plannedSpread });
    for (const field of retainedFields) {
      const value = field.method === true
        ? contribution.sourceStorage === "object-handle"
          ? readRustStructuralObjectMethodStorage(
              contribution.sourceCarrier,
              { kind: "path", path: spreadName },
              field.sourceStorageIndex,
              context,
            )
          : undefined
        : readRustStoredObjectField(
            contribution.sourceStorage,
            contribution.sourceCarrier,
            { kind: "path", path: spreadName },
            field.sourceStorageIndex,
            field.carrier,
            context,
          );
      if (value === undefined) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, contribution.property),
          "rust.backend.record-spread-projection",
          `Object spread field '${field.sourceName}' has no exact Rust storage projection.`,
        ));
        return undefined;
      }
      const fieldName = allocateRustSyntheticName(
        context.syntheticNames,
        `record_${field.sourceName}`,
      );
      bindings.push({ name: fieldName, value });
      valuesByStorageIndex.set(
        field.targetStorageIndex,
        { kind: "path", path: fieldName },
      );
    }
    for (const implementation of retainedMethods) {
      if (implementation.kind !== "spread") {
        return undefined;
      }
      const source = contribution.methods.find((method) =>
        method.contractDeclaration === implementation.contractMethod);
      if (source === undefined) {
        return undefined;
      }
      const receiverName = allocateRustSyntheticName(
        context.syntheticNames,
        "record_method_receiver",
      );
      bindings.push({
        name: receiverName,
        value: {
          kind: "method-call",
          receiver: { kind: "path", path: spreadName },
          method: "clone",
          args: [],
        },
      });
      const callableValue = planRustBoundProjectMethodCallable(
        implementation.contractMethod,
        contribution.sourceCarrier,
        { kind: "path", path: receiverName },
        source.callableCarrier,
        context,
      );
      if (callableValue === undefined) {
        return undefined;
      }
      const callableName = allocateRustSyntheticName(
        context.syntheticNames,
        "record_method",
      );
      bindings.push({ name: callableName, value: callableValue });
      methodValues.set(
        implementation.fieldName,
        { kind: "path", path: callableName },
      );
    }
  }
  const structuralInitializers: import("../objects/project-storage.js")
    .RustStructuralObjectFieldInitializer[] = [];
  const projectFields: { name: string; value: RustExpr }[] = [];
  for (const field of [...fact.fields].sort((left, right) => left.storageIndex - right.storageIndex)) {
    if (fact.storage === "object-handle" &&
      field.storageIndex !== structuralInitializers.length) {
      return undefined;
    }
    const accessor = accessorValuesByStorageIndex.get(field.storageIndex);
    if (accessor !== undefined) {
      if (fact.storage === "object-handle") {
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
    const value = valuesByStorageIndex.get(field.storageIndex);
    if (value === undefined) {
      const storageCarrier = field.method === true
        ? rustStructuralMethodStorageCarrier(
            fact.resultCarrier,
            field.carrier,
            field.presence,
          )
        : field.carrier;
      const optionType = field.presence === "optional" &&
          rustOptionElementCarrier(storageCarrier) !== undefined
        ? rustTypeFromCarrierInContext(storageCarrier, context)
        : undefined;
      if (optionType === undefined) {
        return undefined;
      }
      structuralInitializers.push({
        kind: field.method === true ? "method" : "stored",
        value: { kind: "none" },
      });
      continue;
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
  if (fact.storage === "object-handle" || projectRepresentation?.kind !== "value") {
    context.usedAliases?.add("rt");
  }
  if (stateMarker !== undefined) {
    projectFields.push({ name: stateMarker.name, value: stateMarker.value });
  }
  let constructed: RustExpr | undefined;
  if (objectLiteralImplementation !== undefined) {
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
      : { kind: "block", bindings, value: constructed };
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

function planProjectIndexRecordLiteral(
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
  const definition = context.input.program.projectTypes.definitionForCarrier(fact.resultCarrier);
  const representation = context.input.program.objectRepresentations.representationFor(definition);
  const wrapperType = rustTypeFromCarrierInContext(fact.resultCarrier, context);
  const stateType = rustProjectStateType(fact.resultCarrier, context);
  const properties = context.input.program.source.ast.properties(node);
  if (definition?.kind !== "interface" || representation === undefined ||
    context.input.program.projectTypes.isPolymorphic(definition) ||
    wrapperType?.kind !== "named" || stateType?.kind !== "named" ||
    properties.length !== fact.contributions.length ||
    fact.contributions.some((contribution, index) => contribution.property !== properties[index])) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.record-index-literal-contract",
      "Index-backed object literal conflicts with its finalized interface, contribution order, or generated storage contract.",
    ));
    return undefined;
  }
  const mapName = allocateRustSyntheticName(context.syntheticNames, "record_index_entries");
  const bindings: {
    readonly name: string;
    readonly value: RustExpr;
  }[] = [];
  const mapPath: RustExpr = { kind: "path", path: mapName };
  let entries: RustExpr | undefined;
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
      const valueName = allocateRustSyntheticName(
        context.syntheticNames,
        `record_${contribution.sourceName}`,
      );
      bindings.push({ name: valueName, value });
      const contributionEntries: RustExpr = {
        kind: "call",
        path: "core::iter::once",
        args: [{
          kind: "tuple-literal",
          elements: [key, { kind: "path", path: valueName }],
        }],
      };
      entries = appendRustRecordEntries(entries, contributionEntries);
      continue;
    }
    const spreadExpression = SpreadAssignment_Expression(
      context.input.program.source.ast,
      contribution.property,
    );
    const spread = spreadExpression === contribution.expression
      ? planExpression(contribution.expression, context)
      : undefined;
    const sourceRepresentation = rustProjectObjectRepresentation(
      contribution.sourceCarrier,
      context,
    );
    if (spread === undefined || sourceRepresentation === undefined) {
      return undefined;
    }
    const spreadName = allocateRustSyntheticName(context.syntheticNames, "record_index_spread");
    const spreadEntriesName = allocateRustSyntheticName(
      context.syntheticNames,
      "record_index_spread_entries",
    );
    bindings.push({ name: spreadName, value: spread }, {
      name: spreadEntriesName,
      value: readRustProjectObjectIndexStorage(
        { kind: "path", path: spreadName },
        contribution.sourceStorageName,
        sourceRepresentation,
      ),
    });
    const spreadEntries: RustExpr = { kind: "path", path: spreadEntriesName };
    entries = entries === undefined
      ? {
          kind: "method-call",
          receiver: spreadEntries,
          method: "into_iter",
          args: [],
        }
      : appendRustRecordEntries(entries, spreadEntries);
  }
  bindings.push({
    name: mapName,
    value: entries === undefined
      ? { kind: "call", path: "std::collections::HashMap::new", args: [] }
      : {
          kind: "call",
          path: "std::collections::HashMap::from_iter",
          args: [entries],
        },
  });
  context.usedAliases?.add("rt");
  return {
    kind: "block",
    bindings,
    value: createRustProjectObject(
      wrapperType.path,
      stateType.path,
      [{ name: fact.storageName, value: mapPath }],
      representation,
    ),
  };
}

function appendRustRecordEntries(
  current: RustExpr | undefined,
  next: RustExpr,
): RustExpr {
  return current === undefined
    ? next
    : {
        kind: "method-call",
        receiver: current,
        method: "chain",
        args: [next],
      };
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
