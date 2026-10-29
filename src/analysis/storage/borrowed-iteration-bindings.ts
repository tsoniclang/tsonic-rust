import type { AstReader, Node } from "@tsonic/tsts";
import { asSourceNode, BinaryExpression_Right, ForInOrOfStatement_Initializer, ForInOrOfStatement_Statement, Node_Expression, Node_Initializer, Node_Name, sourceEnclosingCallable, sourceTransparentExpressionOperand, VariableDeclarationList_Declarations, VariableStatement_DeclarationList, type SourceProgramNavigation } from "@tsonic/target-api/source";

import { rustEffectiveValueCarrier } from "../conversions/value-carrier-queries.js";
import { inferRustTargetGenericBindings, rustFixedArrayCarrierValue, rustTargetGenericReferences, substituteRustTargetGenerics } from "../../target-model/types/index.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustBorrowedIterationBinding } from "../../target-model/records/storage/borrowed-element-reads.js";
import { rustBorrowedStringAppend, rustBorrowPureOperation } from "./borrowed-element-purity.js";
import { rustBorrowedStringInputs } from "./provider-borrows.js";
import { selectRustBorrowRelationship, type RustBorrowEffectsInput } from "../ownership/effects.js";
import type { RustBorrowEffects } from "../../target-model/records/storage/ownership-effects.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustLifetimesEqual } from "../../target-model/lifetimes/index.js";

export interface RustBorrowedIterationEvidence {
  readonly input: RustBorrowEffectsInput;
  readonly effects: RustBorrowEffects;
}

export function selectRustBorrowedIterationBinding(
  node: Node, ast: AstReader, records: RustProgramRecords, navigation: SourceProgramNavigation,
  evidence: RustBorrowedIterationEvidence,
): RustBorrowedIterationBinding | undefined {
  const iteration = records.targetOperation.get(node);
  const iterable = Node_Expression(ast, node);
  const carrier = iterable === undefined ? undefined : rustEffectiveValueCarrier(records, iterable);
  const container = carrier?.kind === "reference" ? carrier.referent : carrier;
  const element = container?.kind === "array" || container?.kind === "slice" ? container.element
    : rustFixedArrayCarrierValue(container)?.element;
  const initializer = ForInOrOfStatement_Initializer(ast, node);
  const declarations = initializer === undefined ? undefined : VariableDeclarationList_Declarations(ast, initializer);
  const declaration = declarations?.length === 1 ? declarations[0] : undefined;
  const name = declaration === undefined ? undefined : Node_Name(ast, declaration);
  const body = ForInOrOfStatement_Statement(ast, node);
  if (iteration?.kind !== "iteration" || iteration.iterationKind !== "for-of" ||
    iteration.lowering.kind !== "borrowed" ||
    iterable === undefined || element === undefined || !rustTargetTypeRefEquals(iteration.elementCarrier, element) ||
    carrier?.kind === "reference" && carrier.mutable || evidence.input.ast !== ast || evidence.input.records !== records ||
    evidence.input.navigation !== navigation || declaration === undefined || name === undefined ||
    !ast.is.IsIdentifier(name) || body === undefined ||
    ast.variableDeclarationKind(declaration) === "using" || ast.variableDeclarationKind(declaration) === "await using") return undefined;
  const summary = navigation.declarationUseSummary(declaration);
  if (summary.captured || summary.exported || summary.bindingWritten || summary.memberWritten) return undefined;
  const uses = summary.uses.filter(use => use.kind !== "source-linkage" && use.kind !== "type-only");
  if (uses.length === 0 || !uses.every(use => isWithin(use.reference, body, ast) && readonlyUse(use.reference)) ||
    !stableStatement(body)) return undefined;
  return Object.freeze({ declaration, references: Object.freeze(uses.map(use => use.reference)) });

  function readonlyUse(reference: Node): boolean {
    let current = reference;
    let parent = ast.parent(current);
    while (parent !== undefined && sourceTransparentExpressionOperand(ast, parent) === current) {
      if (!rustTargetTypeRefEquals(rustEffectiveValueCarrier(records, current), rustEffectiveValueCarrier(records, parent))) return false;
      current = parent;
      parent = ast.parent(current);
    }
    if (parent === undefined) return false;
    if (!rustTargetTypeRefEquals(rustEffectiveValueCarrier(records, reference), element) ||
      records.contextualValueConversion.get(current) !== undefined || records.conversion.get(current) !== undefined ||
      records.projectUpcast.get(current) !== undefined || records.projectDowncast.get(current) !== undefined ||
      records.optionProjection.get(current) !== undefined) return false;
    if (rustBorrowedStringAppend(parent, ast, records)) return BinaryExpression_Right(ast, parent) === current;
    const call = ast.parent(parent);
    if (ast.is.IsPropertyAccessExpression(parent) && call !== undefined && ast.is.IsCallExpression(call) &&
      Node_Expression(ast, call) === parent) parent = call;
    const provider = rustBorrowPureOperation(parent, records);
    if (provider !== undefined) return rustBorrowedStringInputs(parent, provider, ast).includes(current);
    const operation = records.targetOperation.get(parent);
    const selected = records.selectedCall.get(parent);
    const called = asSourceNode(selected?.sourceDeclaration, ast);
    if (operation?.kind !== "source-call" || called === undefined || selected === undefined || !ast.is.IsCallExpression(parent)) return false;
    const index = ast.arguments(parent).indexOf(current);
    if (index < 0 || records.argumentPassing.get(current)?.mode !== "borrow-shared") return false;
    const matches = operation.parameters.flatMap((parameter, position) => parameter.inputs.some(input =>
      input.sourceArgumentIndex === index) ? [{ parameter, position }] : []);
    const match = matches.length === 1 ? matches[0] : undefined;
    const formal = match === undefined ? undefined : selected.nativeParameterDeclarations[match.position];
    const abi = formal === undefined ? undefined : records.sourceParameterAbi.get(formal);
    const parameter = match?.parameter;
    const input = parameter?.inputs.length === 1 ? parameter.inputs[0] : undefined;
    if (formal === undefined || sourceEnclosingCallable(formal, ast) !== called || abi === undefined ||
      abi.form !== "required" || abi.mode !== "ref" || abi.entryConversion !== undefined ||
      parameter?.mode !== "ref" || parameter.form !== "required" || input?.sourceForm !== "value" ||
      input.sourceParameterForm !== "parameter" || input.projection.kind !== "direct" ||
      input.sourceArgumentIndex !== index || !rustTargetTypeRefEquals(input.carrier, element) ||
      !rustTargetTypeRefEquals(parameter.valueCarrier, element) ||
      parameter.parameterCarrier.kind !== "reference" || parameter.parameterCarrier.mutable ||
      !rustTargetTypeRefEquals(parameter.parameterCarrier.referent, element)) return false;
    const references = rustTargetGenericReferences(abi.valueCarrier);
    const bindings = inferRustTargetGenericBindings(abi.valueCarrier, parameter.valueCarrier, {
      typeIdentities: new Set(references.typeIdentities), lifetimeIdentities: new Set(references.lifetimeIdentities),
      constIdentities: new Set(references.constIdentities),
    });
    if (bindings === undefined) return false;
    const physical = substituteRustTargetGenerics(abi.parameterCarrier, bindings.types, bindings.lifetimes, bindings.consts);
    return physical.kind === "reference" && !physical.mutable && rustTargetTypeRefEquals(physical.referent, element) &&
      (parameter.parameterCarrier.lifetime === undefined || rustLifetimesEqual(physical.lifetime, parameter.parameterCarrier.lifetime));
  }

  function stableExpression(expression: Node | undefined): boolean {
    return expression !== undefined && selectRustBorrowRelationship(iterable!, expression, evidence.input, evidence.effects);
  }

  function stableStatement(statement: Node): boolean {
    switch (ast.kindName(statement)) {
      case "KindBlock": return ast.statements(statement).every(child => child !== undefined && stableStatement(child));
      case "KindExpressionStatement":
      case "KindReturnStatement": return stableExpression(Node_Expression(ast, statement));
      case "KindVariableStatement": {
        const list = VariableStatement_DeclarationList(ast, statement);
        return list !== undefined && VariableDeclarationList_Declarations(ast, list)?.every(value =>
          value !== undefined && ast.variableDeclarationKind(value) !== "using" && ast.variableDeclarationKind(value) !== "await using" &&
          ast.name(value) !== undefined && ast.is.IsIdentifier(ast.name(value)!) && stableExpression(Node_Initializer(ast, value))) === true;
      }
      case "KindIfStatement": {
        const conditional = ast.as.AsIfStatement(statement);
        return conditional?.ThenStatement !== undefined && stableExpression(conditional.Expression) &&
          stableStatement(conditional.ThenStatement) &&
          (conditional.ElseStatement === undefined || stableStatement(conditional.ElseStatement));
      }
      case "KindEmptyStatement": return true;
      default: return false;
    }
  }
}

export function analyzeRustBorrowedIterationBindings(
  ast: AstReader, nativeNodes: readonly Node[], records: RustProgramRecords, navigation: SourceProgramNavigation,
  evidence: RustBorrowedIterationEvidence,
): (node: Node) => RustBorrowedIterationBinding | undefined {
  const bindings = new WeakMap<Node, RustBorrowedIterationBinding>();
  const visit = (node: Node): void => {
    if (ast.is.IsForOfStatement(node)) {
      const selected = selectRustBorrowedIterationBinding(node, ast, records, navigation, evidence);
      if (selected !== undefined) bindings.set(node, selected);
    }
  };
  nativeNodes.forEach(visit);
  return node => bindings.get(node);
}

function isWithin(node: Node, ancestor: Node, ast: AstReader): boolean {
  for (let current: Node | undefined = node; current !== undefined; current = ast.parent(current)) {
    if (current === ancestor) return true;
  }
  return false;
}
