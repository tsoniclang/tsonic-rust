import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { applyFallibleShape } from "../types/fallible-shape.js";
import { createRustProjectObject, rustProjectObjectStateField, rustProjectObjectType } from "../objects/project-objects.js";
import {
  diagnosticInput,
  isValidRustIdentifier,
  rustErrorBoundaryForDeclaration,
  rustErrorType,
  rustLocalBindingName,
  rustProjectTypeHasPublicImplementationAbi,
} from "../program/plan-context.js";
import {
  rustAuthoredFieldDeadCodeDisposition,
  rustProjectConstructorDeadCodeDisposition,
} from "../liveness/directives.js";
import {
  KindClassStaticBlockDeclaration,
  Node_Initializer,
  Node_Type,
} from "@tsonic/target-api/source";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "../diagnostics.js";
import { planExpression } from "../expressions/index.js";
import { planProjectMethod, planProjectMethodVariants } from "./methods.js";
import { planRustCallableParameterPrelude, planRustCallableParameters } from "./callable-parameters.js";
import type { RustCallableParameterPlan } from "./callable-parameters.js";
import { planStatementSequence } from "../statements/index.js";
import { prepareRustPreconstructionNode } from "./preconstruction-fields.js";
import type { RustPreconstructionFieldValue } from "./preconstruction-fields.js";
import { projectOwnMethodProperties } from "../objects/polymorphism/model.js";
import type { ProjectMethodPropertyPlan } from "../objects/polymorphism/model.js";
import { rustDeclarationRequiresUnsafe, rustSafetyAttributesForDeclaration } from "../safety/explicit-safety.js";
import { rustDefaultImplementation } from "./default-implementation.js";
import { rustFallibleFactKey } from "../../../analysis/facts/keys.js";
import { rustProjectObjectLayout } from "../../../analysis/project-types/object-layout.js";
import { rustProjectGenerics, rustProjectStateType, rustProjectStateMarker } from "../objects/polymorphism/names.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { structAttributes } from "./types.js";
import type {
  RustType,
  RustExpr,
  RustImplFunction,
  RustItem,
  RustStmt,
  RustStructField,
} from "../../target-ast/nodes.js";
import { emptyRustGenerics } from "../../target-ast/nodes.js";
import type { Node } from "@tsonic/tsts";
import type { RustPlanContext } from "../program/plan-context.js";
import type { TargetTypeRef } from "../../../target-model/types/model.js";
import type { RustObjectRepresentation } from "../../../analysis/project-types/object-representation.js";
import {
  rustProjectImplementationVisibility,
  rustProjectMemberStorageVisibility,
} from "../objects/project-storage-abi.js";
import { rustProjectObjectIdentityImplementation } from "../objects/project-identity.js";

export interface PlannedProjectObjectField {
  readonly declaration: Node;
  readonly sourceName: string;
  readonly targetName: string;
  readonly storageIndex: number;
  readonly carrier: TargetTypeRef;
  readonly type: RustType;
  readonly visibility: import("../../target-ast/nodes.js").RustVisibility;
  readonly initializer?: Node;
}

export function carrierOf(context: RustPlanContext, node: Node | undefined) {
  return node === undefined ? undefined : context.input.program.facts.getRuntimeCarrierFact(node)?.carrier;
}

export function planClassDeclaration(node: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const { ast } = context.input.program.source;
  const definition = context.input.program.projectTypes.definitionForDeclaration(node);
  const className = context.input.program.names.nameForDeclaration(node) ?? "";
  if (!isValidRustIdentifier(className)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.class",
      "Class names must be valid Rust identifiers.",
    ));
    return undefined;
  }
  const exported = ast.hasModifierKind(node, "export");
  const publiclyReachable = rustProjectTypeHasPublicImplementationAbi(context, className);
  const storageVisibility = rustProjectImplementationVisibility(publiclyReachable);
  const structVisibility = exported || publiclyReachable ? "public" as const : "crate" as const;
  if (ast.extendsHeritageElements(node).length > 0 || ast.implementsHeritageElements(node).length > 0) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.class",
      "Class inheritance and interface implementation are not supported by the Rust target.",
    ));
    return undefined;
  }
  if (definition?.kind !== "class") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.class-definition",
      "Class declaration has no exact project-type definition.",
    ));
    return undefined;
  }
  const representation = context.input.program.objectRepresentations.representationFor(definition);
  if (representation === undefined || representation.kind === "open-hierarchy" ||
    representation.kind === "closed-hierarchy") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.class-representation",
      "Non-polymorphic class declaration has no exact Rust object representation.",
    ));
    return undefined;
  }
  const openType = rustTypeFromCarrierInContext(
    context.input.program.projectTypes.openCarrier(definition),
    context,
  );
  if (openType === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.class-carrier",
      "Class declaration has no renderable open Rust carrier.",
    ));
    return undefined;
  }
  const stateType = representation.kind === "value"
    ? undefined
    : rustProjectStateType(
        context.input.program.projectTypes.openCarrier(definition),
        context,
      );
  if (representation.kind !== "value" && stateType === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.class-state-carrier",
      "Class declaration has no renderable named Rust state carrier.",
    ));
    return undefined;
  }
  const generics = rustProjectGenerics(definition);
  const stateMarker = rustProjectStateMarker(definition, context);

  const layout = rustProjectObjectLayout(node, ast);
  if (layout?.kind !== "class") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.class-layout",
      "Class declaration has no deterministic Rust project-object layout.",
    ));
    return undefined;
  }
  const fields: PlannedProjectObjectField[] = [];
  const constructorMembers: Node[] = [];
  const methods: Node[] = [];
  const accessors: { readonly declaration: Node; readonly role: "read" | "write" }[] = [];
  let failed = false;
  for (const member of ast.members(node)) {
    if (member === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.class-member",
        "Class declaration contains an undefined member slot.",
      ));
      failed = true;
      continue;
    }
    const memberKind = ast.kindName(member);
    if (memberKind === KindClassStaticBlockDeclaration) {
      continue;
    }
    if (memberKind === "KindPropertyDeclaration") {
      if (ast.hasModifierKind(member, "static")) {
        continue;
      }
      const fieldNameNode = ast.name(member);
      const sourceFieldName = ast.text(fieldNameNode ?? member);
      const fieldName = context.input.program.projectTypes.fieldStorageName(definition, member) ?? "";
      const fieldCarrier = carrierOf(context, member) ?? carrierOf(context, Node_Type(ast, member));
      const fieldType = rustTypeFromCarrierInContext(fieldCarrier, context);
      if (!isValidRustIdentifier(fieldName) || fieldCarrier === undefined || fieldType === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, member),
          "rust.backend.class",
          `Class field '${sourceFieldName}' has no supported Rust storage identity or carrier fact.`,
        ));
        failed = true;
        continue;
      }
      const layoutField = layout.fields.find((field) => field.declaration === member);
      if (layoutField === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, member),
          "rust.backend.class-field-layout",
          `Class field '${fieldName}' has no exact project-object storage slot.`,
        ));
        failed = true;
        continue;
      }
      const initializer = Node_Initializer(ast, member);
      fields.push({
        declaration: member,
        sourceName: layoutField.sourceName,
        targetName: fieldName,
        storageIndex: layoutField.storageIndex,
        carrier: fieldCarrier,
        type: fieldType,
        visibility: rustProjectMemberStorageVisibility(ast, member, publiclyReachable),
        ...(initializer === undefined ? {} : { initializer }),
      });
      continue;
    }
    if (memberKind === "KindConstructor") {
      constructorMembers.push(member);
      continue;
    }
    if (memberKind === "KindMethodDeclaration") {
      if (ast.body(member) === undefined) {
        const implementation = context.input.program.sourceNavigation
          .callableImplementation(member);
        if (implementation.kind !== "resolved" ||
          implementation.implementation.declaration === member) {
          context.diagnostics.push(missingFactDiagnostic(
            diagnosticInput(context, member),
            "rust.backend.method-implementation",
            implementation.kind === "unresolved"
              ? implementation.reason
              : "Method overload declaration has no distinct concrete implementation.",
          ));
          failed = true;
        }
        continue;
      }
      methods.push(member);
      continue;
    }
    if (memberKind === "KindGetAccessor" || memberKind === "KindSetAccessor") {
      accessors.push({
        declaration: member,
        role: memberKind === "KindGetAccessor" ? "read" : "write",
      });
      continue;
    }
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, member),
      "rust.backend.class",
      "This class member is not supported by the Rust target.",
    ));
    failed = true;
  }
  const constructorImplementations = constructorMembers.filter((member) =>
    ast.body(member) !== undefined);
  if (constructorImplementations.length > 1 ||
    (constructorMembers.length > 0 && constructorImplementations.length !== 1)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.constructor-implementation",
      "Class constructor signatures must resolve to one concrete implementation body.",
    ));
    failed = true;
  }
  const constructorMember = constructorImplementations[0];
  const methodProperties = projectOwnMethodProperties(
    definition,
    context.input.program.projectTypes.openCarrier(definition),
    context,
  );
  if (methodProperties === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.method-property-layout",
      "Class method properties have no exact mutable callable storage plan.",
    ));
    return undefined;
  }
  const constructorFn = planConstructor(
    node,
    constructorMember,
    className,
    openType,
    definition.stateName,
    stateMarker,
    fields,
    methodProperties,
    representation,
    publiclyReachable,
    context,
  );
  if (failed || constructorFn === undefined) {
    return undefined;
  }
  const implFunctions: RustImplFunction[] = [constructorFn];
  for (const method of methods) {
    const planned = planProjectMethodVariants(method, context);
    if (planned === undefined) {
      return undefined;
    }
    implFunctions.push(...planned);
  }
  for (const accessor of accessors) {
    const targetName = context.input.program.projectTypes.memberSlotName(
      accessor.declaration,
      accessor.role,
    );
    if (targetName === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, accessor.declaration),
        "rust.backend.accessor-slot",
        "Class accessor has no deterministic Rust declaration slot.",
      ));
      return undefined;
    }
    const planned = planProjectMethod(accessor.declaration, context, {
      targetName,
      safetyPlacement: accessor.role === "read" ? "getter" : "setter",
    });
    if (planned === undefined) {
      return undefined;
    }
    implFunctions.push(planned);
  }

  if (fields.length !== layout.fields.length) {
    return undefined;
  }
  if (representation.kind !== "value") {
    context.usedAliases?.add("rt");
  }
  const generatedStructAttributes = structAttributes(className) ?? [];
  const stateCarrier = stateType === undefined
    ? undefined
    : rustProjectObjectType(stateType, representation);
  const valueFields: readonly RustStructField[] = [
    ...fields.map((field): RustStructField => {
      const deadCode = rustAuthoredFieldDeadCodeDisposition(
        context,
        node,
        field.declaration,
        field.visibility === "public",
      );
      return {
        name: field.targetName,
        type: field.type,
        visibility: field.visibility,
        ...(deadCode === undefined ? {} : { deadCode }),
      };
    }),
    ...methodProperties.map((property) => ({
        name: property.targetName,
        type: {
          kind: "named" as const,
          path: "Option",
          genericArguments: [{ kind: "type" as const, type: property.callableType }],
        },
        visibility: storageVisibility,
        ...(publiclyReachable ? { attrs: ["#[doc(hidden)]"] } : {}),
      })),
    ...(stateMarker === undefined
      ? []
      : [{
          name: stateMarker.name,
          type: stateMarker.type,
          visibility: storageVisibility,
          ...(publiclyReachable ? { attrs: ["#[doc(hidden)]"] } : {}),
        }]),
  ];
  if (representation.kind !== "value" && stateCarrier === undefined) {
    return undefined;
  }
  const stateField: RustStructField | undefined = stateCarrier === undefined
    ? undefined
    : {
        name: rustProjectObjectStateField,
        type: stateCarrier,
        visibility: storageVisibility,
        ...(publiclyReachable ? { attrs: ["#[doc(hidden)]"] } : {}),
      };
  const stateItem: RustItem = {
    kind: "struct",
    name: definition.stateName,
    visibility: storageVisibility,
    ...(publiclyReachable ? { attrs: ["#[doc(hidden)]"] } : {}),
    derives: [],
    generics,
    fields: valueFields,
  };
  const structFields = representation.kind === "value"
    ? valueFields
    : stateField === undefined
      ? undefined
      : [stateField];
  if (structFields === undefined) {
    return undefined;
  }
  const structItem: RustItem = {
    kind: "struct",
    name: className,
    ...(generatedStructAttributes.length === 0 ? {} : { attrs: generatedStructAttributes }),
    visibility: structVisibility,
    derives: ["Clone", "Debug", "PartialEq"],
    generics,
    fields: structFields,
  };
  const defaultImplementation = rustDefaultImplementation(openType, generics, constructorFn);
  const implementation: RustItem = {
    kind: "impl",
    generics,
    target: openType,
    functions: implFunctions,
  };
  return [
    ...(representation.kind === "value" ? [] : [stateItem]),
    structItem,
    ...(representation.kind === "value"
      ? []
      : [rustProjectObjectIdentityImplementation(openType, generics, {
          kind: "method-call",
          receiver: {
            kind: "field",
            receiver: { kind: "path", path: "self" },
            name: rustProjectObjectStateField,
          },
          method: "object_identity",
          args: [],
        })]),
    implementation,
    ...(defaultImplementation === undefined ? [] : [defaultImplementation]),
  ];
}

function planConstructor(
  classDeclaration: Node,
  member: Node | undefined,
  className: string,
  classType: RustType,
  stateName: string,
  stateMarker: ReturnType<typeof rustProjectStateMarker>,
  fields: readonly PlannedProjectObjectField[],
  methodProperties: readonly ProjectMethodPropertyPlan[],
  representation: RustObjectRepresentation,
  publiclyReachable: boolean,
  context: RustPlanContext,
): RustImplFunction | undefined {
  const { ast } = context.input.program.source;
  const isUnsafe = rustDeclarationRequiresUnsafe(
    classDeclaration,
    "constructor",
    context.input,
    member,
  );
  const safetyAttributes = rustSafetyAttributesForDeclaration(
    member ?? classDeclaration,
    isUnsafe,
    context.input,
  );
  const body = member === undefined ? undefined : ast.body(member);
  if (member !== undefined && body === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, member),
      "rust.backend.constructor-body",
      "Constructor declaration has no concrete source body.",
    ));
    return undefined;
  }
  const syntheticNames = createRustSyntheticNameState(
    ast,
    member ?? classDeclaration,
    [],
  );
  const parameterPlan = member === undefined
    ? { params: [], prelude: [] } satisfies RustCallableParameterPlan
    : planRustCallableParameters(member, context, syntheticNames);
  if (parameterPlan === undefined) {
    return undefined;
  }
  const params = parameterPlan.params;
  const fallible = context.input.program.facts.getFact(
    member ?? classDeclaration,
    rustFallibleFactKey,
  ) !== undefined;
  const errorBoundary = fallible
    ? rustErrorBoundaryForDeclaration(member ?? classDeclaration, context)
    : undefined;
  if (fallible && errorBoundary === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, member ?? classDeclaration),
      "rust.backend.constructor-error-boundary",
      "Constructor has no exact source-package error boundary.",
    ));
    return undefined;
  }
  if (fallible) {
    context.usedAliases?.add("rt");
  }
  const constructorContext: RustPlanContext = {
    ...context,
    syntheticNames,
    controlFlow: { nextLoopId: 0 },
    functionReturnType: classType,
    functionUndefinedReturn: false,
    ...(errorBoundary === undefined ? {} : { fallibleBoundary: errorBoundary }),
  };
  const parameterStatements = planRustCallableParameterPrelude(
    parameterPlan,
    constructorContext,
    planExpression,
  );
  if (parameterStatements === undefined) {
    return undefined;
  }
  const values = new Map<Node, RustExpr>();
  const fieldSlots: RustPreconstructionFieldValue[] = [];
  const availableFields: RustPreconstructionFieldValue[] = [];
  const statements: RustStmt[] = [...parameterStatements];
  for (const field of fields) {
    const valueName = allocateRustSyntheticName(
      syntheticNames,
      `field_${rustLocalBindingName(field.targetName)}`,
    );
    const expression: RustExpr = { kind: "path", path: valueName };
    const slot = {
      declaration: field.declaration,
      storageIndex: field.storageIndex,
      carrier: field.carrier,
      expression,
    };
    statements.push({
      kind: "let",
      name: valueName,
      mutable: true,
      type: field.type,
    });
    values.set(field.declaration, expression);
    fieldSlots.push(slot);
  }
  const evaluateField = (field: PlannedProjectObjectField, expression: Node): boolean => {
    const expressionContext = prepareRustPreconstructionNode(
      expression,
      availableFields,
      constructorContext,
    );
    if (expressionContext === undefined) {
      return false;
    }
    const value = planExpression(expression, expressionContext);
    if (value === undefined) {
      return false;
    }
    const slot = fieldSlots.find((candidate) => candidate.declaration === field.declaration);
    if (slot === undefined) {
      return false;
    }
    statements.push({ kind: "assign", target: slot.expression, operator: "=", value });
    const existing = availableFields.findIndex((candidate) =>
      candidate.declaration === field.declaration);
    if (existing < 0) {
      availableFields.push(slot);
    } else {
      availableFields[existing] = slot;
    }
    return true;
  };
  for (const field of fields) {
    if (field.initializer !== undefined && !evaluateField(field, field.initializer)) {
      return undefined;
    }
  }
  const bodyStatements = body === undefined ? [] : ast.statements(body);
  if (body !== undefined) {
    const bodyContext = prepareRustPreconstructionNode(
      body,
      fieldSlots,
      constructorContext,
    );
    if (bodyContext === undefined) {
      return undefined;
    }
    const bodyPlan = planStatementSequence(bodyStatements, body, bodyContext);
    if (bodyPlan === undefined) {
      return undefined;
    }
    statements.push(...bodyPlan.statements);
  }
  const fieldValues: RustExpr[] = [];
  for (const field of fields) {
    const value = values.get(field.declaration);
    if (value === undefined) {
      return undefined;
    }
    fieldValues.push(value);
  }
  statements.push({
    kind: "tail",
    expr: createRustProjectObject(
      className,
      stateName,
      fields.map((field, index) => ({
        name: field.targetName,
        value: fieldValues[index]!,
      })).concat(
        methodProperties.map((property) => ({
          name: property.targetName,
          value: { kind: "none" as const },
        })),
        stateMarker === undefined
          ? []
          : [{ name: stateMarker.name, value: stateMarker.value }],
      ),
      representation,
    ),
  });
  const constructorDeadCode = rustProjectConstructorDeadCodeDisposition(
    context,
    classDeclaration,
    member ?? classDeclaration,
    publiclyReachable,
  );
  const constructorAttributes = safetyAttributes;
  return {
    name: "new",
    ...(constructorDeadCode === undefined ? {} : { deadCode: constructorDeadCode }),
    generics: emptyRustGenerics,
    ...(isUnsafe ? { isUnsafe: true } : {}),
    visibility: member === undefined ||
        (!ast.hasModifierKind(member, "private") && !ast.hasModifierKind(member, "protected"))
      ? "public"
      : "private",
    ...(constructorAttributes.length === 0 ? {} : { attrs: constructorAttributes }),
    ...(errorBoundary === undefined ? {} : { errorType: rustErrorType(errorBoundary) }),
    params,
    returnType: classType,
    body: {
      ...applyFallibleShape(
        { statements },
        fallible
          ? {
              fallible: true,
              hasReturnValue: true,
              errorType: rustErrorType(errorBoundary!),
              inferErrorTypeFromReturnType: true,
            }
          : { fallible: false, hasReturnValue: true },
      ),
    },
  };
}
