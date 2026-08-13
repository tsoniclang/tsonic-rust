import type { Node } from "@tsonic/tsts";
import {
  KindIdentifier,
  Node_Initializer,
  Node_Name,
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
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "./diagnostics.js";
import { planExpression } from "./expressions.js";
import { planBlockLike, planStatementSequence } from "./statements.js";
import { diagnosticInput, isValidRustIdentifier, rustLocalBindingName, rustPublicName } from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import { rustReturnTypeFromCarrierInContext, rustTypeFromCarrierInContext } from "./render-types.js";
import { rustAsyncFunctionFactKey, rustFallibleFactKey, rustGeneratorFactKey, rustSelfModeFactKey, rustSourceCallableReturnFactKey, rustTypeAliasDeclarationFactKey } from "../../source/rust-facts/keys.js";
import { applyRustTailShape, rustBlockTerminates } from "./functions.js";
import { applyFallibleShape } from "./fallible-shape.js";
import { isRustNeverCarrier, isRustUnitCarrier } from "../../source/rust-target-types.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "./synthetic-names.js";
import { rustProjectCallableTargetName } from "../../source/rust-target-semantics/source-member-name.js";
import { rustProjectMemberSlotName } from "../../source/rust-target-semantics/project-type-policy.js";
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
import { rustProjectTypeParameters } from "./project-polymorphism-names.js";
import type { TargetTypeRef } from "../../policy/types.js";
import {
  prepareRustPreconstructionNode,
  type RustPreconstructionFieldValue,
} from "./preconstruction-fields.js";

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
  const nameNode = Node_Name(ast, node);
  const className = nameNode !== undefined && ast.kindName(nameNode) === KindIdentifier ? ast.text(nameNode) : "";
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
  const typeParams = rustProjectTypeParameters(definition);

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
    if (memberKind === "KindPropertyDeclaration") {
      if (ast.hasModifierKind(member, "static")) {
        continue;
      }
      const fieldName = rustPublicName(ast.text(ast.name(member) ?? member)).name;
      const fieldCarrier = carrierOf(context, member) ?? carrierOf(context, Node_Type(ast, member));
      const fieldType = rustTypeFromCarrierInContext(fieldCarrier, context);
      if (!isValidRustIdentifier(fieldName) || fieldCarrier === undefined || fieldType === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, member),
          "rust.backend.class",
          `Class field '${fieldName}' has no supported Rust carrier fact.`,
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
  const constructorFn = planConstructor(node, constructorMember, className, fields, context);
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
    const targetName = rustProjectMemberSlotName(
      ast,
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
    ...(structAttributes(className, fields.map((field) => ({ name: field.targetName }))) ?? []),
    ...(exported ? [] : ["#[allow(dead_code)]"]),
  ];
  const stateField: RustStructField = {
    name: rustProjectObjectStateField,
    type: rustProjectObjectType(fields.map((field) => field.type)),
    visibility: "crate",
  };
  const structItem: RustItem = {
    kind: "struct",
    name: className,
    ...(generatedStructAttributes.length === 0 ? {} : { attrs: generatedStructAttributes }),
    visibility: exported ? "public" : "private",
    derives: ["Clone", "Debug", "PartialEq"],
    ...(typeParams.length === 0 ? {} : { typeParams }),
    fields: [stateField],
  };
  return [structItem, {
    kind: "impl",
    ...(typeParams.length === 0 ? {} : { typeParams }),
    target: openType,
    functions: implFunctions,
  }];
}

function planConstructor(
  classDeclaration: Node,
  member: Node | undefined,
  className: string,
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
    ? { params: [], prelude: [], bodyInnerAttrs: [] } satisfies RustCallableParameterPlan
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
    functionReturnType: { kind: "named", path: className },
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
      attrs: ["#[allow(unused_mut)]"],
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
    expr: createRustProjectObject(className, fieldValues),
  });
  const constructorAttributes = [
    ...(params.length === 0 ? ["#[allow(clippy::new_without_default)]"] : []),
    ...(ast.hasModifierKind(classDeclaration, "export") ? [] : ["#[allow(dead_code)]"]),
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
    returnType: { kind: "named", path: className },
    body: {
      ...(parameterPlan.bodyInnerAttrs.length === 0
        ? {}
        : { innerAttrs: parameterPlan.bodyInnerAttrs }),
      ...applyFallibleShape({ statements }, fallible, true),
    },
  };
}

export function planProjectMethod(
  member: Node,
  context: RustPlanContext,
  options?: {
    readonly targetName: string;
    readonly safetyPlacement: "getter" | "setter";
  },
): RustImplFunction | undefined {
  const { ast } = context.input;
  const sourceMethodName = options?.targetName ??
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
  const methodName = rustPublicName(sourceMethodName ?? "").name;
  const nonSnakeSeen = { value: rustPublicName(sourceMethodName ?? "").needsAllow };
  context = { ...context, nonSnakeSeen };
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
    ...(nonSnakeSeen.value ? ["#[allow(non_snake_case)]"] : []),
    ...(isStatic && methodName === "new" ? ["#[allow(clippy::new_ret_no_self)]"] : []),
    ...(ast.hasModifierKind(ast.parent(member) ?? member, "export") ? [] : ["#[allow(dead_code)]"]),
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
    return {
      name: methodName,
      ...(isUnsafe ? { isUnsafe: true } : {}),
      visibility: !ast.hasModifierKind(member, "private") && !ast.hasModifierKind(member, "protected") ? "public" : "private",
      ...(methodAttributes.length === 0 ? {} : { attrs: methodAttributes }),
      ...(isStatic ? {} : { selfParam: "ref" as const }),
      params,
      returnType: generatorReturnType,
      body: {
        ...(parameterPlan.bodyInnerAttrs.length === 0
          ? {}
          : { innerAttrs: parameterPlan.bodyInnerAttrs }),
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
                true,
                !isRustUnitCarrier(generatorFact.returnType),
              ),
            }],
          },
        }],
      },
    };
  }
  return {
    name: methodName,
    ...(isUnsafe ? { isUnsafe: true } : {}),
    visibility: !ast.hasModifierKind(member, "private") && !ast.hasModifierKind(member, "protected") ? "public" : "private",
    ...(methodAttributes.length === 0 ? {} : { attrs: methodAttributes }),
    ...(fallible ? { fallible: true } : {}),
    ...(sourceAsync ? { isAsync: true } : {}),
    ...(isStatic ? {} : { selfParam: "ref" as const }),
    params,
    ...(returnType === undefined ? {} : { returnType }),
    body: {
      ...applyFallibleShape(
        applyRustTailShape({ statements: [...parameterStatements, ...body.statements] }, returnType !== undefined),
        fallible,
        returnType !== undefined,
      ),
      ...(parameterPlan.bodyInnerAttrs.length === 0
        ? {}
        : { innerAttrs: parameterPlan.bodyInnerAttrs }),
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
  const nameNode = Node_Name(ast, node);
  const enumName = nameNode !== undefined && ast.kindName(nameNode) === KindIdentifier ? ast.text(nameNode) : "";
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
    const memberName = ast.text(ast.name(member) ?? member);
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
    visibility: ast.hasModifierKind(node, "export") ? "public" : "private",
    derives: ["Clone", "Copy", "Debug", "PartialEq"],
    variants,
  }];
}

export function planInterfaceDeclaration(node: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const { ast } = context.input;
  const definition = context.input.projectTypes.definitionForDeclaration(node);
  const nameNode = Node_Name(ast, node);
  const interfaceName = nameNode !== undefined && ast.kindName(nameNode) === KindIdentifier ? ast.text(nameNode) : "";
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
    const fieldName = rustPublicName(ast.text(ast.name(member) ?? member)).name;
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
    name: interfaceName,
    ...(structAttributes(interfaceName, fields.map((field) => ({ name: field.targetName }))) === undefined
      ? {}
      : { attrs: structAttributes(interfaceName, fields.map((field) => ({ name: field.targetName }))) }),
    visibility: ast.hasModifierKind(node, "export") ? "public" : "private",
    derives: ["Clone", "Debug", "PartialEq"],
    ...(typeParams.length === 0 ? {} : { typeParams }),
    fields: [{
      name: rustProjectObjectStateField,
      type: rustProjectObjectType(fields.map((field) => field.type)),
      visibility: "crate",
    }],
  }];
}

export function planTypeAliasDeclaration(node: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const { ast } = context.input;
  const carrier = context.input.facts.getRuntimeCarrierFact(node)?.carrier;
  const fact = context.input.facts.getFact(node, rustTypeAliasDeclarationFactKey);
  const nameNode = Node_Name(ast, node);
  const aliasName = nameNode !== undefined && ast.kindName(nameNode) === KindIdentifier ? ast.text(nameNode) : "";
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
    visibility: ast.hasModifierKind(node, "export") ? "public" : "private",
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

// Scoped lint allowances for a generated struct: field names may be
// non-snake, and the authored type name may be non-CamelCase.
function structAttributes(typeName: string, fields: readonly { readonly name: string }[]): readonly string[] | undefined {
  const attrs: string[] = [];
  if (fields.some((field) => rustPublicName(field.name).needsAllow)) {
    attrs.push("#[allow(non_snake_case)]");
  }
  if (!/^[A-Z][A-Za-z0-9]*$/u.test(typeName)) {
    attrs.push("#[allow(non_camel_case_types)]");
  }
  return attrs.length === 0 ? undefined : attrs;
}
