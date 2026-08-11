import type { AstReader, Node } from "@tsonic/tsts";
import {
  BinaryExpression_Left,
  BinaryExpression_OperatorToken,
  BinaryExpression_Right,
  KindEqualsToken,
  KindIdentifier,
  Node_Expression,
  Node_Initializer,
  Node_Name,
  Node_Type,
} from "../../common/source-ast.js";
import type {
  RustType,
  RustExpr,
  RustFunctionParam,
  RustImplFunction,
  RustItem,
  RustStmt,
  RustStructField,
} from "../rust-ast/nodes.js";
import { missingFactDiagnostic, unsupportedConstructDiagnostic } from "./diagnostics.js";
import { planExpression } from "./expressions.js";
import { planBlockLike } from "./statements.js";
import { diagnosticInput, isValidRustIdentifier, rustLocalBindingName, rustSourceName, rustPublicName } from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import { rustTypeFromCarrierInContext } from "./render-types.js";
import { rustAsyncFunctionFactKey, rustFallibleFactKey, rustGeneratorFactKey, rustMutatedBindingFactKey, rustSelfModeFactKey, rustSourceCallableReturnFactKey, rustSourceParameterAbiFactKey, rustUnionVariantsFactKey } from "../../source/rust-facts/keys.js";
import { applyFallibleShape, applyRustTailShape, rustBlockTerminates } from "./functions.js";
import { isRustUnitCarrier } from "../../source/rust-target-types.js";
import { allocateRustSyntheticName, createRustSyntheticNameState } from "./synthetic-names.js";
import { rustProjectCallableTargetName } from "../../source/rust-target-semantics/source-member-name.js";
import { rustProjectObjectLayout } from "../../source/rust-target-semantics/project-object-layout.js";
import {
  createRustProjectObject,
  rustProjectObjectStateField,
  rustProjectObjectType,
} from "./project-objects.js";

interface PlannedProjectObjectField {
  readonly declaration: Node;
  readonly sourceName: string;
  readonly targetName: string;
  readonly storageIndex: number;
  readonly type: RustType;
  readonly initializer?: Node;
}

function carrierOf(context: RustPlanContext, node: Node | undefined) {
  return node === undefined ? undefined : context.input.facts.getRuntimeCarrierFact(node)?.carrier;
}

function renderType(context: RustPlanContext, node: Node | undefined) {
  return rustTypeFromCarrierInContext(carrierOf(context, node), context);
}

export function planClassDeclaration(node: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const { ast } = context.input;
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
  let constructorMember: Node | undefined;
  const methods: Node[] = [];
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
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, member),
          "rust.backend.class",
          "Static class fields are not supported by the Rust target.",
        ));
        failed = true;
        continue;
      }
      const fieldName = rustPublicName(ast.text(ast.name(member) ?? member)).name;
      const fieldType = renderType(context, member) ?? renderType(context, Node_Type(ast, member));
      if (!isValidRustIdentifier(fieldName) || fieldType === undefined) {
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
        type: fieldType,
        ...(initializer === undefined ? {} : { initializer }),
      });
      continue;
    }
    if (memberKind === "KindConstructor") {
      constructorMember = member;
      continue;
    }
    if (memberKind === "KindMethodDeclaration") {
      methods.push(member);
      continue;
    }
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, member),
      "rust.backend.class",
      "This class member is not supported by the Rust target.",
    ));
    failed = true;
  }
  const constructorFn = planConstructor(node, constructorMember, className, fields, context);
  if (failed || constructorFn === undefined) {
    return undefined;
  }
  const implFunctions: RustImplFunction[] = [constructorFn];
  for (const method of methods) {
    const planned = planMethod(method, context);
    if (planned === undefined) {
      return undefined;
    }
    implFunctions.push(planned);
  }

  if (fields.length !== layout.fields.length) {
    return undefined;
  }
  context.usedAliases?.add("rt");
  const stateField: RustStructField = {
    name: rustProjectObjectStateField,
    type: rustProjectObjectType(fields.map((field) => field.type)),
    visibility: "crate",
  };
  const structItem: RustItem = {
    kind: "struct",
    name: className,
    ...(structAttributes(className, fields.map((field) => ({ name: field.targetName }))) === undefined
      ? {}
      : { attrs: structAttributes(className, fields.map((field) => ({ name: field.targetName }))) }),
    visibility: ast.hasModifierKind(node, "export") ? "public" : "private",
    derives: ["Clone", "Debug", "PartialEq"],
    fields: [stateField],
  };
  return [structItem, { kind: "impl", name: className, functions: implFunctions }];
}

function planParams(member: Node, context: RustPlanContext): readonly RustFunctionParam[] | undefined {
  const { ast } = context.input;
  const params: RustFunctionParam[] = [];
  for (const parameter of ast.parameters(member)) {
    if (parameter === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, member),
        "rust.backend.parameter",
        "Class callable contains an undefined parameter slot.",
      ));
      return undefined;
    }
    const parameterName = rustSourceName(context, ast.text(ast.name(parameter) ?? parameter));
    const parameterCarrier = context.input.facts.getFact(parameter, rustSourceParameterAbiFactKey)?.parameterCarrier;
    const parameterType = rustTypeFromCarrierInContext(parameterCarrier, context);
    if (!isValidRustIdentifier(parameterName) || parameterType === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, parameter),
        "rust.backend.parameter",
        `Parameter '${parameterName}' has no supported Rust carrier fact.`,
      ));
      return undefined;
    }
    params.push({
      name: parameterName,
      type: parameterType,
      mutable: context.input.facts.getFact(parameter, rustMutatedBindingFactKey) !== undefined,
    });
  }
  return params;
}

function planConstructor(
  classDeclaration: Node,
  member: Node | undefined,
  className: string,
  fields: readonly PlannedProjectObjectField[],
  context: RustPlanContext,
): RustImplFunction | undefined {
  const { ast } = context.input;
  const params = member === undefined ? [] : planParams(member, context);
  if (params === undefined) {
    return undefined;
  }
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
    body ?? classDeclaration,
    params.map((parameter) => parameter.name),
  );
  const constructorContext: RustPlanContext = {
    ...context,
    syntheticNames,
    controlFlow: { nextLoopId: 0 },
    functionReturnType: { kind: "named", path: className },
  };
  const values = new Map<string, RustExpr>();
  const statements: RustStmt[] = [];
  const evaluateField = (field: PlannedProjectObjectField, expression: Node): boolean => {
    if (sourceSubtreeContainsThis(expression, ast)) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, expression),
        "rust.backend.class-field-initializer",
        "Class field initialization cannot read `this` before the reference-backed Rust object state exists.",
      ));
      return false;
    }
    const value = planExpression(expression, constructorContext);
    if (value === undefined) {
      return false;
    }
    const valueName = allocateRustSyntheticName(
      syntheticNames,
      `field_${rustLocalBindingName(field.targetName)}`,
    );
    statements.push({ kind: "let", name: valueName, mutable: false, init: value });
    values.set(field.sourceName, { kind: "path", path: valueName });
    return true;
  };
  for (const field of fields) {
    if (field.initializer !== undefined && !evaluateField(field, field.initializer)) {
      return undefined;
    }
  }
  const bodyStatements = body === undefined ? [] : ast.statements(body);
  for (const statement of bodyStatements) {
    if (statement === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, body ?? classDeclaration),
        "rust.backend.constructor-statement",
        "Constructor body contains an undefined statement slot.",
      ));
      return undefined;
    }
    const expression = ast.kindName(statement) === "KindExpressionStatement" ? Node_Expression(ast, statement) : undefined;
    const operatorToken = expression === undefined ? undefined : BinaryExpression_OperatorToken(ast, expression);
    const left = expression === undefined ? undefined : BinaryExpression_Left(ast, expression);
    const right = expression === undefined ? undefined : BinaryExpression_Right(ast, expression);
    const receiver = left === undefined ? undefined : Node_Expression(ast, left);
    const receiverKind = receiver === undefined ? "" : ast.kindName(receiver);
    const fieldNameNode = left === undefined ? undefined : Node_Name(ast, left);
    const sourceFieldName = fieldNameNode === undefined ? "" : ast.text(fieldNameNode);
    const field = fields.find((candidate) => candidate.sourceName === sourceFieldName);
    const isFieldInit =
      expression !== undefined &&
      operatorToken !== undefined &&
      ast.kindName(operatorToken) === KindEqualsToken &&
      left !== undefined &&
      ast.kindName(left) === "KindPropertyAccessExpression" &&
      (receiverKind === "KindThisExpression" || receiverKind === "KindThisKeyword") &&
      field !== undefined &&
      right !== undefined;
    if (!isFieldInit) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, statement),
        "rust.backend.class",
        "Constructors support field initialization statements whose exact target is `this.<field>`.",
      ));
      return undefined;
    }
    if (!evaluateField(field, right)) {
      return undefined;
    }
  }
  if (values.size !== fields.length) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, member ?? classDeclaration),
      "rust.backend.class",
      "Construction must initialize every declared field through a field initializer or constructor assignment.",
    ));
    return undefined;
  }
  const fieldValues: RustExpr[] = [];
  for (const field of fields) {
    const value = values.get(field.sourceName);
    if (value === undefined) {
      return undefined;
    }
    fieldValues.push(value);
  }
  statements.push({
    kind: "tail",
    expr: createRustProjectObject(className, fieldValues),
  });
  return {
    name: "new",
    visibility: member === undefined ||
        (!ast.hasModifierKind(member, "private") && !ast.hasModifierKind(member, "protected"))
      ? "public"
      : "private",
    ...(params.length === 0 ? { attrs: ["#[allow(clippy::new_without_default)]"] } : {}),
    params,
    returnType: { kind: "named", path: className },
    body: { statements },
  };
}

function sourceSubtreeContainsThis(node: Node, ast: AstReader): boolean {
  let found = false;
  const visit = (candidate: Node): void => {
    const kind = ast.kindName(candidate);
    if (kind === "KindThisExpression" || kind === "KindThisKeyword") {
      found = true;
      return;
    }
    ast.forEachChild(candidate, (child) => {
      if (!found && child !== undefined) {
        visit(child);
      }
    });
  };
  visit(node);
  return found;
}

function planMethod(member: Node, context: RustPlanContext): RustImplFunction | undefined {
  const { ast } = context.input;
  const sourceMethodName = rustProjectCallableTargetName(member, context.input);
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
  const params = planParams(member, context);
  if (params === undefined) {
    return undefined;
  }
  const returnTypeNode = Node_Type(ast, member);
  const generatorFact = context.input.facts.getFact(member, rustGeneratorFactKey);
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
  const isUnit = isRustUnitCarrier(returnCarrier);
  const returnType = isUnit ? undefined : rustTypeFromCarrierInContext(returnCarrier, context);
  if (!isUnit && returnType === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, returnTypeNode ?? member),
      "rust.backend.class",
      "Method return type has no supported Rust carrier fact.",
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
  const fallible = context.input.facts.getFact(member, rustFallibleFactKey) !== undefined;
  const isStatic = ast.hasModifierKind(member, "static");
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
  const syntheticNames = createRustSyntheticNameState(ast, bodyNode, params.map((param) => param.name));
  const generatorControllerName = generatorFact === undefined
    ? undefined
    : allocateRustSyntheticName(syntheticNames, "generator");
  const bodyContext: RustPlanContext = {
    ...context,
    syntheticNames,
    controlFlow: { nextLoopId: 0 },
    functionReturnType: returnType ?? { kind: "unit" },
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
    ...(fallible ? { fallibleContext: true } : {}),
  };
  const body = planBlockLike(bodyNode, bodyContext);
  if (body === undefined) {
    return undefined;
  }
  if (generatorFact === undefined && returnType !== undefined && !rustBlockTerminates(body)) {
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
      visibility: !ast.hasModifierKind(member, "private") && !ast.hasModifierKind(member, "protected") ? "public" : "private",
      ...(nonSnakeSeen.value ? { attrs: ["#[allow(non_snake_case)]"] } : {}),
      ...(isStatic ? {} : { selfParam: "ref" as const }),
      params,
      returnType: generatorReturnType,
      body: {
        statements: [{
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
              body: applyRustTailShape(body, !isRustUnitCarrier(generatorFact.returnType)),
            }],
          },
        }],
      },
    };
  }
  return {
    name: methodName,
    visibility: !ast.hasModifierKind(member, "private") && !ast.hasModifierKind(member, "protected") ? "public" : "private",
    ...(nonSnakeSeen.value ? { attrs: ["#[allow(non_snake_case)]"] } : {}),
    ...(fallible ? { fallible: true } : {}),
    ...(sourceAsync ? { isAsync: true } : {}),
    ...(isStatic ? {} : { selfParam: "ref" as const }),
    params,
    ...(returnType === undefined ? {} : { returnType }),
    body: applyFallibleShape(applyRustTailShape(body, returnType !== undefined), fallible, returnType !== undefined),
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
    const fieldType = renderType(context, member) ?? renderType(context, Node_Type(ast, member));
    if (!isValidRustIdentifier(fieldName) || fieldType === undefined) {
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
    fields: [{
      name: rustProjectObjectStateField,
      type: rustProjectObjectType(fields.map((field) => field.type)),
      visibility: "crate",
    }],
  }];
}

export function planUnionAliasDeclaration(node: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const { ast } = context.input;
  const carrier = context.input.facts.getRuntimeCarrierFact(node)?.carrier;
  const fact = context.input.facts.getFact(node, rustUnionVariantsFactKey);
  const nameNode = Node_Name(ast, node);
  const aliasName = nameNode !== undefined && ast.kindName(nameNode) === KindIdentifier ? ast.text(nameNode) : "";
  if (carrier === undefined || fact === undefined || !isValidRustIdentifier(aliasName)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.union",
      "Type aliases lower only as closed string-literal unions with finalized variant facts.",
    ));
    return undefined;
  }
  return [{
    kind: "enum",
    name: aliasName,
    visibility: ast.hasModifierKind(node, "export") ? "public" : "private",
    derives: ["Clone", "Copy", "Debug", "PartialEq"],
    variants: fact.variants.map((variant) => ({ name: variant.name })),
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
