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
import { diagnosticInput, isValidRustIdentifier, rustValueName, sourceTypePath } from "./plan-context.js";
import type { RustPlanContext } from "./plan-context.js";
import { rustTypeFromCarrier } from "./render-types.js";
import { rustMutatedBindingFactKey, rustSelfModeFactKey, rustUnionVariantsFactKey } from "../../source/rust-facts/keys.js";
import { isRustUnitCarrier } from "../../source/rust-target-types.js";

function carrierOf(context: RustPlanContext, node: Node | undefined) {
  return node === undefined ? undefined : context.input.facts.getRuntimeCarrierFact(node)?.carrier;
}

function renderType(context: RustPlanContext, node: Node | undefined) {
  return rustTypeFromCarrier(carrierOf(context, node), (value) => sourceTypePath(context, value));
}

export function planClassDeclaration(node: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const { ast } = context.input;
  const nameNode = Node_Name(node);
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
      const fieldName = rustValueName(ast.text(ast.name(member) ?? member));
      const fieldType = renderType(context, member) ?? renderType(context, Node_Type(member));
      if (!isValidRustIdentifier(fieldName) || fieldType === undefined) {
        context.diagnostics.push(missingFactDiagnostic(
          diagnosticInput(context, member),
          "rust.backend.class",
          `Class field '${fieldName}' has no supported Rust carrier fact.`,
        ));
        failed = true;
        continue;
      }
      fields.push({ name: fieldName, type: fieldType });
      continue;
    }
    if (memberKind === "KindConstructor") {
      constructorMember = member;
      continue;
    }
    if (memberKind === "KindMethodDeclaration") {
      if (ast.hasModifierKind(member, "static") || ast.hasModifierKind(member, "async")) {
        context.diagnostics.push(unsupportedConstructDiagnostic(
          diagnosticInput(context, member),
          "rust.backend.class",
          "Static and async class methods are not supported by the Rust target.",
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
      continue;
    }
    const parameterName = rustValueName(ast.text(ast.name(parameter) ?? parameter));
    const parameterType = renderType(context, parameter) ?? renderType(context, Node_Type(parameter));
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
  const assignments = new Map<string, RustExpr>();
  const bodyStatements = body === undefined ? [] : ast.statements(body);
  for (const statement of bodyStatements) {
    if (statement === undefined) {
      continue;
    }
    const expression = ast.kindName(statement) === "KindExpressionStatement" ? Node_Expression(statement) : undefined;
    const operatorToken = expression === undefined ? undefined : BinaryExpression_OperatorToken(expression);
    const left = expression === undefined ? undefined : BinaryExpression_Left(expression);
    const right = expression === undefined ? undefined : BinaryExpression_Right(expression);
    const receiver = left === undefined ? undefined : Node_Expression(left);
    const receiverKind = receiver === undefined ? "" : ast.kindName(receiver);
    const fieldNameNode = left === undefined ? undefined : Node_Name(left);
    const fieldName = fieldNameNode === undefined ? "" : rustValueName(ast.text(fieldNameNode));
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
    pub: true,
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
  const methodName = rustValueName(ast.text(ast.name(member) ?? member));
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
  const returnTypeNode = Node_Type(member);
  const returnCarrier = carrierOf(context, returnTypeNode);
  const isUnit = returnCarrier === undefined || isRustUnitCarrier(returnCarrier);
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
    return undefined;
  }
  const bodyContext: RustPlanContext = {
    ...context,
    emittedLocalNames: new Set(params.map((param) => param.name)),
  };
  const body = planBlockLike(bodyNode, bodyContext);
  if (body === undefined) {
    return undefined;
  }
  return {
    name: methodName,
    pub: true,
    selfParam: context.input.facts.getFact(member, rustSelfModeFactKey)?.mode === "mut-ref" ? "mut-ref" : "ref",
    params,
    ...(returnType === undefined ? {} : { returnType }),
    body: applyTail(body, returnType !== undefined),
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
  const nameNode = Node_Name(node);
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
  for (const member of ast.members(node)) {
    if (member === undefined) {
      continue;
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
    const constant = context.input.analysis.getEnumMemberConstant(member, { sourceFile: context.sourceFile });
    const value = constant?.value;
    if (typeof value !== "number" || !Number.isInteger(value)) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, member),
        "rust.backend.enum",
        "Enum members require integer constants evaluated by TSTS.",
      ));
      return undefined;
    }
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
  const nameNode = Node_Name(node);
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
      continue;
    }
    if (ast.kindName(member) !== "KindPropertySignature") {
      context.diagnostics.push(unsupportedConstructDiagnostic(
        diagnosticInput(context, member),
        "rust.backend.record",
        "Record interfaces support only property signatures.",
      ));
      return undefined;
    }
    const fieldName = rustValueName(ast.text(ast.name(member) ?? member));
    const fieldType = renderType(context, member) ?? renderType(context, Node_Type(member));
    if (!isValidRustIdentifier(fieldName) || fieldType === undefined) {
      context.diagnostics.push(missingFactDiagnostic(
        diagnosticInput(context, member),
        "rust.backend.record",
        `Record field '${fieldName}' has no supported Rust carrier fact.`,
      ));
      return undefined;
    }
    fields.push({ name: fieldName, type: fieldType });
  }
  const allFieldsCopy = fields.every((field) => field.type.kind === "primitive");
  return [{
    kind: "struct",
    name: interfaceName,
    pub: ast.hasModifierKind(node, "export"),
    derives: allFieldsCopy ? ["Clone", "Copy", "Debug", "PartialEq"] : ["Clone", "Debug", "PartialEq"],
    fields,
  }];
}

export function planUnionAliasDeclaration(node: Node, context: RustPlanContext): readonly RustItem[] | undefined {
  const { ast } = context.input;
  const carrier = context.input.facts.getRuntimeCarrierFact(node)?.carrier;
  const fact = context.input.facts.getFact(node, rustUnionVariantsFactKey);
  const nameNode = Node_Name(node);
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
