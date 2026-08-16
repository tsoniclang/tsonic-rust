import type { Node } from "@tsonic/tsts";
import {
  KindClassStaticBlockDeclaration,
  Node_Initializer,
  Node_Type,
} from "../../common/source-ast.js";
import type {
  RustType,
  RustExpr,
  RustImplFunction,
  RustItem,
  RustStmt,
  RustStructField,
} from "../rust-ast/nodes.js";
import { rustLintAttributes } from "../rust-ast/lint-policy.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "./diagnostics.js";
import { planExpression } from "./expressions.js";
import { planBlockLike, planStatementSequence } from "./statements.js";
import { diagnosticInput, isValidRustIdentifier, rustLocalBindingName } from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import { rustReturnTypeFromCarrierInContext, rustTypeFromCarrierInContext } from "./render-types.js";
import { rustAsyncFunctionFactKey, rustFallibleFactKey, rustGeneratorFactKey, rustSelfModeFactKey, rustSourceCallableReturnFactKey, rustTypeAliasDeclarationFactKey } from "../../source/rust-facts/keys.js";
import { applyRustTailShape, rustBlockTerminates } from "./functions.js";
import { applyFallibleShape } from "./fallible-shape.js";
import { isRustNeverCarrier, isRustUnitCarrier } from "../../source/rust-target-types.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "./synthetic-names.js";
import { rustProjectCallableTargetName } from "../../source/rust-target-semantics/source-member-name.js";
import { rustProjectObjectLayout } from "../../source/rust-target-semantics/project-object-layout.js";
import {
  createRustProjectObject,
  rustProjectObjectStateField,
  rustProjectObjectType,
} from "./project-objects.js";
import {
  planRustCallableParameterPrelude,
  planRustCallableParameters,
  type RustCallableParameterPlan,
} from "./callable-parameters.js";
import { resolveRustCallableBodyReturnType } from "./callable-body-return.js";
import {
  rustDeclarationRequiresUnsafe,
  rustSafetyAttributesForDeclaration,
} from "./explicit-safety.js";
import {
  rustProjectStateType,
  rustProjectStateMarker,
  rustProjectTypeParameters,
} from "./project-polymorphism-names.js";
import type { TargetTypeRef } from "../../policy/types.js";
import {
  prepareRustPreconstructionNode,
  type RustPreconstructionFieldValue,
} from "./preconstruction-fields.js";
import { rustDefaultImplementation } from "./default-implementation.js";
import { planRustCallableGenerics } from "./callable-generics.js";

interface PlannedProjectObjectField {
  readonly declaration: Node;
  readonly sourceName: string;
  readonly targetName: string;
  readonly storageIndex: number;
  readonly carrier: TargetTypeRef;
  readonly type: RustType;
  readonly initializer?: Node;
}

function carrierOf(context: RustPlanContext, node: Node | undefined) {
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
  const constructorFn = planConstructor(
    node,
    constructorMember,
    className,
    openType,
    definition.stateName,
    stateMarker,
    fields,
    context,
  );
  if (failed || constructorFn === undefined) {
    return undefined;
  }
  const implFunctions: RustImplFunction[] = [constructorFn];
  for (const method of methods) {
    const planned = planProjectMethod(method, context);
    if (planned === undefined) {
      return undefined;
    }
    implFunctions.push(planned);
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
      })).concat(stateMarker === undefined
        ? []
        : [{ name: stateMarker.name, value: stateMarker.value }]),
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

export function planProjectMethod(
  member: Node,
  outerContext: RustPlanContext,
  options?: {
    readonly targetName?: string;
    readonly safetyPlacement?: "getter" | "setter";
    readonly typeArgumentSubstitutions?: ReadonlyMap<string, TargetTypeRef>;
  },
): RustImplFunction | undefined {
  let context = outerContext;
  const { ast } = context.input;
  const sourceMethodName = options?.targetName ??
    context.input.names.nameForDeclaration(member) ??
    rustProjectCallableTargetName(member, context.input);
  const isUnsafe = rustDeclarationRequiresUnsafe(
    member,
    options?.safetyPlacement ?? "declaration",
    context.input,
  );
  const safetyAttributes = rustSafetyAttributesForDeclaration(
    member,
    isUnsafe,
    context.input,
  );
  const methodName = sourceMethodName ?? "";
  if (!isValidRustIdentifier(methodName)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, member),
      "rust.backend.class",
      `Method name '${methodName}' is not a valid Rust identifier.`,
    ));
    return undefined;
  }
  const bodyNode = ast.body(member);
  if (bodyNode === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, member),
      "rust.backend.method-body",
      "Method declaration has no concrete source body.",
    ));
    return undefined;
  }
  const genericPlan = planRustCallableGenerics(
    member,
    context,
    options?.typeArgumentSubstitutions,
  );
  if (genericPlan === undefined) {
    return undefined;
  }
  context = genericPlan.context;
  const generatorFact = context.input.facts.getFact(member, rustGeneratorFactKey);
  const syntheticNames = context.syntheticNames ?? createRustSyntheticNameState(ast, member, []);
  const parameterPlan = planRustCallableParameters(member, context, syntheticNames, {
    requireStatic: generatorFact !== undefined,
  });
  if (parameterPlan === undefined) {
    return undefined;
  }
  const params = parameterPlan.params;
  const returnTypeNode = Node_Type(ast, member);
  const asyncFact = context.input.facts.getFact(member, rustAsyncFunctionFactKey);
  const sourceAsync = ast.hasModifierKind(member, "async");
  if (sourceAsync && generatorFact === undefined && asyncFact === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, member),
      "rust.backend.async-method",
      "Async methods require a finalized Promise or async-generator carrier fact.",
    ));
    return undefined;
  }
  const returnCarrier = generatorFact?.carrier ?? asyncFact?.outputCarrier ??
    context.input.facts.getFact(member, rustSourceCallableReturnFactKey)?.returnCarrier;
  if (returnCarrier === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, returnTypeNode ?? member),
      "rust.backend.class",
      "Method return type has no finalized Rust carrier fact.",
    ));
    return undefined;
  }
  const fallible = context.input.facts.getFact(member, rustFallibleFactKey) !== undefined;
  const isUnit = isRustUnitCarrier(returnCarrier);
  const isNever = isRustNeverCarrier(returnCarrier);
  const returnType = isUnit || fallible && isNever
    ? undefined
    : rustReturnTypeFromCarrierInContext(returnCarrier, context);
  if (!isUnit && !(fallible && isNever) && returnType === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, returnTypeNode ?? member),
      "rust.backend.class",
      "Method return type has no supported Rust carrier fact.",
    ));
    return undefined;
  }
  const isStatic = ast.hasModifierKind(member, "static");
  const methodAttributes = [
    ...(isStatic && methodName === "new" ? [rustLintAttributes.newReturningOtherType] : []),
    ...(ast.hasModifierKind(ast.parent(member) ?? member, "export") ? [] : [rustLintAttributes.deadCode]),
    ...safetyAttributes,
  ];
  if (generatorFact !== undefined && fallible) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, member),
      "rust.backend.generator-fallibility",
      "Throwing generator method bodies require a closed Rust generator error protocol.",
    ));
    return undefined;
  }
  if (fallible) {
    context.usedAliases?.add("rt");
  }
  const generatorControllerName = generatorFact === undefined
    ? undefined
    : allocateRustSyntheticName(syntheticNames, "generator");
  const bodyReturnType = resolveRustCallableBodyReturnType(
    returnType,
    generatorFact,
    context,
  );
  if (bodyReturnType === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, returnTypeNode ?? member),
      "rust.backend.generator-return-carrier",
      "Generator method body return type has no supported Rust carrier fact.",
    ));
    return undefined;
  }
  const bodyContext: RustPlanContext = {
    ...context,
    syntheticNames,
    controlFlow: { nextLoopId: 0 },
    functionReturnType: bodyReturnType,
    ...(sourceAsync && generatorFact === undefined ? { asyncContext: true } : {}),
    ...(generatorFact === undefined
      ? {}
      : {
          generator: {
            declaration: member,
            controllerName: generatorControllerName!,
            protocol: generatorFact,
          },
        }),
    ...(fallible || generatorFact !== undefined ? { fallibleContext: true } : {}),
  };
  const parameterStatements = planRustCallableParameterPrelude(
    parameterPlan,
    bodyContext,
    planExpression,
  );
  if (parameterStatements === undefined) {
    return undefined;
  }
  const body = planBlockLike(bodyNode, bodyContext);
  if (body === undefined) {
    return undefined;
  }
  if (generatorFact === undefined && !isUnit && !rustBlockTerminates(body)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, bodyNode),
      "rust.backend.return-flow",
      "Value-returning methods require finalized control flow that returns or throws on every path.",
    ));
    return undefined;
  }
  const selfMode = isStatic ? undefined : context.input.facts.getFact(member, rustSelfModeFactKey);
  if (!isStatic && selfMode === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, member),
      "rust.backend.self-mode",
      "Instance method has no finalized Rust self-passing mode.",
    ));
    return undefined;
  }
  if (generatorFact !== undefined) {
    if (!isRustUnitCarrier(generatorFact.returnType) && !rustBlockTerminates(body)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, bodyNode),
        "rust.backend.generator-return-flow",
        "Value-returning generator methods require finalized control flow that returns on every path.",
      ));
      return undefined;
    }
    context.usedAliases?.add("rt");
    const generatorReturnType = isStatic
      ? returnType
      : borrowedGeneratorType(returnType, generatorFact.kind);
    if (generatorReturnType === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, member),
        "rust.backend.instance-generator-carrier",
        "Instance generator method has no lifetime-bound Rust generator return carrier.",
      ));
      return undefined;
    }
    const typeParams = genericPlan.finalizeTypeParameters();
    return {
      name: methodName,
      ...(isUnsafe ? { isUnsafe: true } : {}),
      visibility: !ast.hasModifierKind(member, "private") && !ast.hasModifierKind(member, "protected") ? "public" : "private",
      ...(methodAttributes.length === 0 ? {} : { attrs: methodAttributes }),
      ...(isStatic ? {} : { selfParam: "ref" as const }),
      ...(typeParams.length === 0 ? {} : { typeParams }),
      params,
      returnType: generatorReturnType,
      body: {
        statements: [...parameterStatements, {
          kind: "tail",
          expr: {
            kind: "call",
            path: generatorFact.kind === "sync"
              ? isStatic ? "rt::Generator::new" : "rt::BorrowedGenerator::new"
              : isStatic ? "rt::AsyncGenerator::new" : "rt::BorrowedAsyncGenerator::new",
            args: [{
              kind: "closure-block",
              params: [{ name: generatorControllerName!, mutable: false }],
              move: true,
              async: true,
              body: applyFallibleShape(
                applyRustTailShape(body, !isRustUnitCarrier(generatorFact.returnType)),
                {
                  fallible: true,
                  hasReturnValue: !isRustUnitCarrier(generatorFact.returnType),
                  errorDomain: context.errorDomain,
                },
              ),
            }],
          },
        }],
      },
    };
  }
  const typeParams = genericPlan.finalizeTypeParameters();
  return {
    name: methodName,
    ...(isUnsafe ? { isUnsafe: true } : {}),
    visibility: !ast.hasModifierKind(member, "private") && !ast.hasModifierKind(member, "protected") ? "public" : "private",
    ...(methodAttributes.length === 0 ? {} : { attrs: methodAttributes }),
    ...(fallible ? { fallible: true } : {}),
    ...(sourceAsync ? { isAsync: true } : {}),
    ...(isStatic ? {} : { selfParam: "ref" as const }),
    ...(typeParams.length === 0 ? {} : { typeParams }),
    params,
    ...(returnType === undefined ? {} : { returnType }),
    body: {
      ...applyFallibleShape(
        applyRustTailShape({ statements: [...parameterStatements, ...body.statements] }, returnType !== undefined),
        {
          fallible,
          hasReturnValue: returnType !== undefined,
          errorDomain: context.errorDomain,
        },
      ),
    },
  };
}

function borrowedGeneratorType(
  type: RustType | undefined,
  kind: "sync" | "async",
): RustType | undefined {
  if (type?.kind !== "named" ||
    type.path !== (kind === "sync" ? "rt::Generator" : "rt::AsyncGenerator")) {
    return undefined;
  }
  return {
    ...type,
    path: kind === "sync" ? "rt::BorrowedGenerator" : "rt::BorrowedAsyncGenerator",
    lifetimeArguments: ["_"],
  };
}

export function planEnumDeclaration(node: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const { ast } = context.input;
  const enumName = context.input.names.nameForDeclaration(node) ?? "";
  if (!isValidRustIdentifier(enumName)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.enum",
      "Enum names must be valid Rust identifiers.",
    ));
    return undefined;
  }
  const variants: { name: string; discriminant?: string }[] = [];
  const discriminants = new Map<number, string>();
  for (const member of ast.members(node)) {
    if (member === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.enum-member",
        "Enum declaration contains an undefined member slot.",
      ));
      return undefined;
    }
    const memberName = context.input.names.nameForDeclaration(member) ?? "";
    if (!isValidRustIdentifier(memberName)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, member),
        "rust.backend.enum",
        "Enum member names must be valid Rust identifiers.",
      ));
      return undefined;
    }
    const constant = context.input.analysis.getEnumMemberConstant(member);
    const value = constant?.value;
    if (typeof value !== "number" || !Number.isInteger(value)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, member),
        "rust.backend.enum",
        "Enum members require integer constants evaluated by TSTS.",
      ));
      return undefined;
    }
    const previousMember = discriminants.get(value);
    if (previousMember !== undefined) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, member),
        "rust.backend.enum",
        `Enum members '${previousMember}' and '${memberName}' have the same discriminant ${value}, which Rust rejects.`,
      ));
      return undefined;
    }
    discriminants.set(value, memberName);
    variants.push({ name: memberName, discriminant: String(value) });
  }
  return [{
    kind: "enum",
    name: enumName,
    visibility: ast.hasModifierKind(node, "export") ? "public" : "crate",
    derives: ["Clone", "Copy", "Debug", "PartialEq"],
    variants,
  }];
}

export function planInterfaceDeclaration(node: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const { ast } = context.input;
  const definition = context.input.projectTypes.definitionForDeclaration(node);
  const interfaceName = context.input.names.nameForDeclaration(node) ?? "";
  if (!isValidRustIdentifier(interfaceName)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.record",
      "Interface names must be valid Rust identifiers.",
    ));
    return undefined;
  }
  if (ast.extendsHeritageElements(node).length > 0) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.record",
      "Interface inheritance is not supported by the Rust target.",
    ));
    return undefined;
  }
  if (definition?.kind !== "interface") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.record-definition",
      "Interface declaration has no exact project-type definition.",
    ));
    return undefined;
  }
  const typeParams = rustProjectTypeParameters(definition);
  const stateType = rustProjectStateType(
    context.input.projectTypes.openCarrier(definition),
    context,
  );
  if (stateType === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.record-state-carrier",
      "Record declaration has no renderable named Rust state carrier.",
    ));
    return undefined;
  }
  const stateMarker = rustProjectStateMarker(definition, context);
  const layout = rustProjectObjectLayout(node, ast);
  if (layout?.kind !== "interface") {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.record-layout",
      "Interface declaration has no deterministic Rust project-object layout.",
    ));
    return undefined;
  }
  const fields: PlannedProjectObjectField[] = [];
  for (const member of ast.members(node)) {
    if (member === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, node),
        "rust.backend.record-member",
        "Interface declaration contains an undefined member slot.",
      ));
      return undefined;
    }
    if (ast.kindName(member) !== "KindPropertySignature") {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, member),
        "rust.backend.record",
        "Record interfaces support only property signatures.",
      ));
      return undefined;
    }
    const fieldName = context.input.projectTypes.fieldStorageName(definition, member) ?? "";
    const fieldCarrier = carrierOf(context, member) ?? carrierOf(context, Node_Type(ast, member));
    const fieldType = rustTypeFromCarrierInContext(fieldCarrier, context);
    if (!isValidRustIdentifier(fieldName) || fieldCarrier === undefined || fieldType === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, member),
        "rust.backend.record",
        `Record field '${fieldName}' has no supported Rust carrier fact.`,
      ));
      return undefined;
    }
    const layoutField = layout.fields.find((field) => field.declaration === member);
    if (layoutField === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, member),
        "rust.backend.record-field-layout",
        `Record field '${fieldName}' has no exact project-object storage slot.`,
      ));
      return undefined;
    }
    fields.push({
      declaration: member,
      sourceName: layoutField.sourceName,
      targetName: fieldName,
      storageIndex: layoutField.storageIndex,
      carrier: fieldCarrier,
      type: fieldType,
    });
  }
  if (fields.length !== layout.fields.length) {
    return undefined;
  }
  context.usedAliases?.add("rt");
  return [{
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
      ...(stateMarker === undefined
        ? []
        : [{ name: stateMarker.name, type: stateMarker.type, visibility: "crate" as const }]),
    ],
  }, {
    kind: "struct",
    name: interfaceName,
    ...(structAttributes(interfaceName) === undefined
      ? {}
      : { attrs: structAttributes(interfaceName) }),
    visibility: ast.hasModifierKind(node, "export") ? "public" : "crate",
    derives: ["Clone", "Debug", "PartialEq"],
    ...(typeParams.length === 0 ? {} : { typeParams }),
    fields: [{
      name: rustProjectObjectStateField,
      type: rustProjectObjectType(stateType),
      visibility: "crate",
    }],
  }];
}

export function planTypeAliasDeclaration(node: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const { ast } = context.input;
  const carrier = context.input.facts.getRuntimeCarrierFact(node)?.carrier;
  const fact = context.input.facts.getFact(node, rustTypeAliasDeclarationFactKey);
  const aliasName = context.input.names.nameForDeclaration(node) ?? "";
  if (carrier === undefined || fact === undefined || !isValidRustIdentifier(aliasName)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.type-alias",
      "Type aliases require one finalized Rust alias representation.",
    ));
    return undefined;
  }
  if (fact.kind === "erased") {
    return [];
  }
  const runtimeVariantTypes = fact.kind === "runtime"
    ? fact.variants.map((variant) =>
        rustTypeFromCarrierInContext(variant.carrier, context))
    : [];
  if (runtimeVariantTypes.some((type) => type === undefined)) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.union-variant-carrier",
      "Runtime union variants require renderable finalized Rust carriers.",
    ));
    return undefined;
  }
  return [{
    kind: "enum",
    name: aliasName,
    visibility: ast.hasModifierKind(node, "export") ? "public" : "crate",
    derives: fact.kind === "string-literal"
      ? ["Clone", "Copy", "Debug", "PartialEq"]
      : ["Clone", "Debug", "PartialEq"],
    variants: fact.variants.map((variant, index) => ({
      name: variant.name,
      ...(fact.kind === "runtime"
        ? { fields: [runtimeVariantTypes[index]!] }
        : {}),
    })),
  }];
}

function structAttributes(typeName: string): readonly string[] | undefined {
  const attrs: string[] = [];
  if (!/^[A-Z][A-Za-z0-9]*$/u.test(typeName)) {
    attrs.push(rustLintAttributes.nonCamelCaseType);
  }
  return attrs.length === 0 ? undefined : attrs;
}
