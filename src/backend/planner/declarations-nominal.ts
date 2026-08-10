import type { Node } from "@tsonic/tsts";
import {
  BinaryExpression_Left,
  BinaryExpression_OperatorToken,
  BinaryExpression_Right,
  KindEqualsToken,
  KindIdentifier,
  Node_Expression,
  Node_Name,
  Node_Type,
} from "../../common/source-ast.js";
import type {
  RustBlock,
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
import { diagnosticInput, isValidRustIdentifier, rustSourceName, rustPublicName } from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import { rustTypeFromCarrierInContext } from "./render-types.js";
import { rustFallibleFactKey, rustMutatedBindingFactKey, rustSelfModeFactKey, rustSourceParameterAbiFactKey, rustUnionVariantsFactKey } from "../../source/rust-facts/keys.js";
import { applyFallibleShape, rustBlockTerminates } from "./functions.js";
import { isRustUnitCarrier } from "../../source/rust-target-types.js";

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

  const fields: RustStructField[] = [];
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
      fields.push({
        name: fieldName,
        type: fieldType,
        pub: !ast.hasModifierKind(member, "private") && !ast.hasModifierKind(member, "protected"),
      });
      continue;
    }
    if (memberKind === "KindConstructor") {
      constructorMember = member;
      continue;
    }
    if (memberKind === "KindMethodDeclaration") {
      if (ast.hasModifierKind(member, "async")) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, member),
          "rust.backend.class",
          "Async class methods are not supported by the Rust target.",
        ));
        failed = true;
        continue;
      }
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
  if (constructorMember === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, node),
      "rust.backend.class",
      "Classes require an explicit constructor for Rust struct lowering.",
    ));
    return undefined;
  }
  const constructorFn = planConstructor(constructorMember, className, fields, context);
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

  const allFieldsCopy = fields.every((field) => field.type.kind === "primitive");
  const derives = allFieldsCopy
    ? ["Clone", "Copy", "Debug", "PartialEq"]
    : ["Clone", "Debug", "PartialEq"];
  const structItem: RustItem = {
    kind: "struct",
    name: className,
    ...(structAttributes(className, fields) === undefined ? {} : { attrs: structAttributes(className, fields) }),
    pub: ast.hasModifierKind(node, "export"),
    derives,
    fields,
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

// Constructor lane: the body must consist solely of `this.<field> = <expr>;`
// statements covering each declared field exactly once, lowering to a struct
// literal in `fn new`.
function planConstructor(
  member: Node,
  className: string,
  fields: readonly RustStructField[],
  context: RustPlanContext,
): RustImplFunction | undefined {
  const { ast } = context.input;
  const params = planParams(member, context);
  if (params === undefined) {
    return undefined;
  }
  const body = ast.body(member);
  if (body === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, member),
      "rust.backend.constructor-body",
      "Constructor declaration has no concrete source body.",
    ));
    return undefined;
  }
  const assignments = new Map<string, RustExpr>();
  const bodyStatements = ast.statements(body);
  for (const statement of bodyStatements) {
    if (statement === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, body),
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
    const fieldName = fieldNameNode === undefined ? "" : rustPublicName(ast.text(fieldNameNode)).name;
    const isFieldInit =
      expression !== undefined &&
      operatorToken !== undefined &&
      ast.kindName(operatorToken) === KindEqualsToken &&
      left !== undefined &&
      ast.kindName(left) === "KindPropertyAccessExpression" &&
      (receiverKind === "KindThisExpression" || receiverKind === "KindThisKeyword") &&
      fields.some((field) => field.name === fieldName) &&
      !assignments.has(fieldName) &&
      right !== undefined;
    if (!isFieldInit) {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, statement),
        "rust.backend.class",
        "Constructors support only one `this.<field> = <expression>;` statement per declared field.",
      ));
      return undefined;
    }
    const value = planExpression(right, context);
    if (value === undefined) {
      return undefined;
    }
    assignments.set(fieldName, value);
  }
  if (assignments.size !== fields.length) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, member),
      "rust.backend.class",
      "Constructors must initialize every declared field.",
    ));
    return undefined;
  }
  const literalText: RustStmt = {
    kind: "tail",
    expr: buildStructLiteral(className, fields, assignments),
  };
  return {
    name: "new",
    pub: !ast.hasModifierKind(member, "private") && !ast.hasModifierKind(member, "protected"),
    ...(params.length === 0 ? { attrs: ["#[allow(clippy::new_without_default)]"] } : {}),
    params,
    returnType: { kind: "named", path: className },
    body: { statements: [literalText] },
  };
}

function buildStructLiteral(
  className: string,
  fields: readonly RustStructField[],
  assignments: ReadonlyMap<string, RustExpr>,
): RustExpr {
  return {
    kind: "struct-literal",
    path: className,
    fields: fields.map((field) => ({
      name: field.name,
      value: assignments.get(field.name) ?? { kind: "path", path: field.name },
    })),
  };
}

function planMethod(member: Node, context: RustPlanContext): RustImplFunction | undefined {
  const { ast } = context.input;
  const methodName = rustPublicName(ast.text(ast.name(member) ?? member)).name;
  const nonSnakeSeen = { value: rustPublicName(ast.text(ast.name(member) ?? member)).needsAllow };
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
  if (returnTypeNode === undefined) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, member),
      "rust.backend.class",
      "Methods require an explicit return type annotation.",
    ));
    return undefined;
  }
  const returnCarrier = carrierOf(context, returnTypeNode);
  if (returnCarrier === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, returnTypeNode),
      "rust.backend.class",
      "Method return type has no finalized Rust carrier fact.",
    ));
    return undefined;
  }
  const isUnit = isRustUnitCarrier(returnCarrier);
  const returnType = isUnit ? undefined : renderType(context, returnTypeNode);
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
  if (fallible) {
    context.usedAliases?.add("rt");
  }
  const bodyContext: RustPlanContext = {
    ...context,
    emittedLocalNames: new Set(params.map((param) => param.name)),
    ...(fallible ? { fallibleContext: true } : {}),
  };
  const body = planBlockLike(bodyNode, bodyContext);
  if (body === undefined) {
    return undefined;
  }
  if (returnType !== undefined && !rustBlockTerminates(body)) {
    context.diagnostics.push(unsupportedConstructDiagnostic(
      diagnosticInput(context, bodyNode),
      "rust.backend.return-flow",
      "Value-returning methods require finalized control flow that returns or throws on every path.",
    ));
    return undefined;
  }
  const isStatic = ast.hasModifierKind(member, "static");
  const selfMode = isStatic ? undefined : context.input.facts.getFact(member, rustSelfModeFactKey);
  if (!isStatic && selfMode === undefined) {
    context.diagnostics.push(missingFactDiagnostic(
      diagnosticInput(context, member),
      "rust.backend.self-mode",
      "Instance method has no finalized Rust self-passing mode.",
    ));
    return undefined;
  }
  return {
    name: methodName,
    pub: !ast.hasModifierKind(member, "private") && !ast.hasModifierKind(member, "protected"),
    ...(nonSnakeSeen.value ? { attrs: ["#[allow(non_snake_case)]"] } : {}),
    ...(fallible ? { fallible: true } : {}),
    ...(isStatic ? {} : { selfParam: selfMode!.mode }),
    params,
    ...(returnType === undefined ? {} : { returnType }),
    body: applyFallibleShape(applyTail(body, returnType !== undefined), fallible, returnType !== undefined),
  };
}

function applyTail(body: RustBlock, hasReturnValue: boolean): RustBlock {
  if (!hasReturnValue || body.statements.length === 0) {
    return body;
  }
  const last = body.statements[body.statements.length - 1];
  if (last === undefined || last.kind !== "return" || last.expr === undefined) {
    return body;
  }
  return { statements: [...body.statements.slice(0, -1), { kind: "tail", expr: last.expr }] };
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
    pub: ast.hasModifierKind(node, "export"),
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
  const fields: RustStructField[] = [];
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
    fields.push({ name: fieldName, type: fieldType, pub: true });
  }
  const allFieldsCopy = fields.every((field) => field.type.kind === "primitive");
  return [{
    kind: "struct",
    name: interfaceName,
    ...(structAttributes(interfaceName, fields) === undefined ? {} : { attrs: structAttributes(interfaceName, fields) }),
    pub: ast.hasModifierKind(node, "export"),
    derives: allFieldsCopy ? ["Clone", "Copy", "Debug", "PartialEq"] : ["Clone", "Debug", "PartialEq"],
    fields,
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
    pub: ast.hasModifierKind(node, "export"),
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
