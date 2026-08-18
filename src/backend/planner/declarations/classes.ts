import { allocateRustSyntheticName, createRustSyntheticNameState } from "../names/synthetic.js";
import { applyFallibleShape } from "../types/fallible-shape.js";
import { createRustProjectObject, rustProjectObjectStateField, rustProjectObjectType } from "../objects/project-objects.js";
import { diagnosticInput, isValidRustIdentifier, rustLocalBindingName } from "../program/plan-context.js";
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
import { rustLintAttributes } from "../../rust-ast/lint-policy.js";
import { rustProjectObjectLayout } from "../../../analysis/project-types/object-layout.js";
import { rustProjectStateType, rustProjectStateMarker, rustProjectTypeParameters } from "../objects/polymorphism/names.js";
import { rustTypeFromCarrierInContext } from "../types/render.js";
import { structAttributes } from "./types.js";
import type {
  RustType,
  RustExpr,
  RustImplFunction,
  RustItem,
  RustStmt,
  RustStructField,
} from "../../rust-ast/nodes.js";
import type { Node } from "@tsonic/tsts";
import type { RustPlanContext } from "../program/plan-context.js";
import type { TargetTypeRef } from "../../../policy/types/model.js";

export interface PlannedProjectObjectField {
  readonly declaration: Node;
  readonly sourceName: string;
  readonly targetName: string;
  readonly storageIndex: number;
  readonly carrier: TargetTypeRef;
  readonly type: RustType;
  readonly initializer?: Node;
}

export function carrierOf(context: RustPlanContext, node: Node | undefined) {
  return node === undefined ? undefined : context.input.facts.getRuntimeCarrierFact(node)?.carrier;
}

export function planClassDeclaration(node: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const { ast } = context.input;
  const definition = context.input.projectTypes.definitionForDeclaration(node);
  const className = context.input.names.nameForDeclaration(node) ?? "";
  if (!isValidRustIdentifier(className)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.class",
      "Class names must be valid Rust identifiers.",
    ));
    return undefined;
  }
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
  const openType = rustTypeFromCarrierInContext(
    context.input.projectTypes.openCarrier(definition),
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
  const stateType = rustProjectStateType(
    context.input.projectTypes.openCarrier(definition),
    context,
  );
  if (stateType === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.class-state-carrier",
      "Class declaration has no renderable named Rust state carrier.",
    ));
    return undefined;
  }
  const typeParams = rustProjectTypeParameters(definition);
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
      const fieldName = context.input.projectTypes.fieldStorageName(definition, member) ?? "";
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
        const implementation = context.input.source.navigation
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
    context.input.projectTypes.openCarrier(definition),
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
    const targetName = context.input.projectTypes.memberSlotName(
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
  context.usedAliases?.add("rt");
  const exported = ast.hasModifierKind(node, "export");
  const generatedStructAttributes = [
    ...(structAttributes(className) ?? []),
    ...(exported ? [] : [rustLintAttributes.deadCode]),
  ];
  const stateField: RustStructField = {
    name: rustProjectObjectStateField,
    type: rustProjectObjectType(stateType),
    visibility: "crate",
  };
  const stateItem: RustItem = {
    kind: "struct",
    name: definition.stateName,
    visibility: "crate",
    attrs: [rustLintAttributes.deadCode],
    derives: [],
    ...(typeParams.length === 0 ? {} : { typeParams }),
    fields: [
      ...fields.map((field) => ({
        name: field.targetName,
        type: field.type,
        visibility: "crate" as const,
      })),
      ...methodProperties.map((property) => ({
        name: property.targetName,
        type: {
          kind: "named" as const,
          path: "Option",
          typeArguments: [property.callableType],
        },
        visibility: "crate" as const,
      })),
      ...(stateMarker === undefined
        ? []
        : [{ name: stateMarker.name, type: stateMarker.type, visibility: "crate" as const }]),
    ],
  };
  const structItem: RustItem = {
    kind: "struct",
    name: className,
    ...(generatedStructAttributes.length === 0 ? {} : { attrs: generatedStructAttributes }),
    visibility: exported ? "public" : "crate",
    derives: ["Clone", "Debug", "PartialEq"],
    ...(typeParams.length === 0 ? {} : { typeParams }),
    fields: [stateField],
  };
  const implementation: RustItem = {
    kind: "impl",
    ...(typeParams.length === 0 ? {} : { typeParams }),
    target: openType,
    functions: implFunctions,
  };
  const defaultImplementation = rustDefaultImplementation(openType, typeParams, constructorFn);
  return [
    stateItem,
    structItem,
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
  context: RustPlanContext,
): RustImplFunction | undefined {
  const { ast } = context.input;
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
    : planRustCallableParameters(member, context, syntheticNames, { requireStatic: false });
  if (parameterPlan === undefined) {
    return undefined;
  }
  const params = parameterPlan.params;
  const fallible = context.input.facts.getFact(
    member ?? classDeclaration,
    rustFallibleFactKey,
  ) !== undefined;
  if (fallible) {
    context.usedAliases?.add("rt");
  }
  const constructorContext: RustPlanContext = {
    ...context,
    syntheticNames,
    controlFlow: { nextLoopId: 0 },
    functionReturnType: classType,
    ...(fallible ? { fallibleContext: true } : {}),
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
    ),
  });
  const constructorAttributes = [
    ...(ast.hasModifierKind(classDeclaration, "export") ? [] : [rustLintAttributes.deadCode]),
    ...safetyAttributes,
  ];
  return {
    name: "new",
    ...(isUnsafe ? { isUnsafe: true } : {}),
    visibility: member === undefined ||
        (!ast.hasModifierKind(member, "private") && !ast.hasModifierKind(member, "protected"))
      ? "public"
      : "private",
    ...(constructorAttributes.length === 0 ? {} : { attrs: constructorAttributes }),
    ...(fallible ? { fallible: true } : {}),
    params,
    returnType: classType,
    body: {
      ...applyFallibleShape({ statements }, {
        fallible,
        hasReturnValue: true,
        errorDomain: context.errorDomain,
      }),
    },
  };
}
