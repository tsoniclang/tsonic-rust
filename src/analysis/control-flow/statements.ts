import { requireRustRecord } from "../program/records/required-records.js";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import {
  CatchClause_Block,
  CatchClause_VariableDeclaration,
  CaseBlock_Clauses,
  CaseOrDefaultClause_Expression,
  CaseOrDefaultClause_Statements,
  DoStatement_Statement,
  LabeledStatement_Statement,
  TryStatement_CatchClause,
  TryStatement_FinallyBlock,
  TryStatement_TryBlock,
  ForStatement_Condition,
  ForStatement_Incrementor,
  ForStatement_Initializer,
  IfStatement_ElseStatement,
  IfStatement_ThenStatement,
  IterationStatement_Statement,
  SwitchStatement_CaseBlock,
  SwitchStatement_Expression,
  KindBlock,
  KindCaseClause,
  KindDoStatement,
  KindLabeledStatement,
  KindExpressionStatement,
  KindForInStatement,
  KindForOfStatement,
  KindForStatement,
  KindIfStatement,
  KindArrayBindingPattern,
  KindObjectBindingPattern,
  KindReturnStatement,
  KindSwitchStatement,
  KindVariableDeclaration,
  KindVariableDeclarationList,
  KindVariableStatement,
  KindWhileStatement,
  Node_Expression,
  Node_Initializer,
  Node_Name,
  VariableDeclarationList_Declarations,
  VariableStatement_DeclarationList,
  sourceDeclarationHasOnlyTypeUses,
  sourceTransparentExpressionOperand,
} from "@tsonic/target-api/source";
import { isRustBoolCarrier, isRustStringCarrier, rustOptionElementCarrier, rustProgramErrorTargetType } from "../../target-model/types/index.js";
import { isRustNumericLiteralCarrier } from "../../policy/conversions/literals.js";
import { rustSwitchCarrierSupportsEquality, selectRustSwitchComparison } from "../../policy/operations/control-flow/switch.js";

import { appendRustDiagnostic, boolCarrier } from "../program/walk.js";
import { recordForOfFacts } from "../operations/inputs.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { resolveExpressionCarrier } from "../source-evidence/types/resolution/expression-carriers.js";
import { reconcileRequiredCarrier } from "../conversions/contextual-values.js";
import { selectRustDeclaredBinding } from "../declarations/binding-storage.js";
import { recordBindingPatternFacts } from "./binding-patterns.js";
import { recordCallableDefaultParameterFacts } from "../callables/values/parameter-facts.js";
import { recordCallableValueSignatureForDeclaration } from "../callables/calls/signatures.js";
import { recordThrowFacts } from "../errors/thrown-values.js";
import { requireDenseSourceNodes } from "../source-evidence/dense-nodes.js";

import { setCarrierFact } from "../operations/project-calls.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { RustTargetOperationFact } from "../../target-model/records/operations.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

import { recordRustNativeGuardResult, recordRustNativeUnreachable } from "./native-control-flow.js";

export function recordFunctionBodyFacts(walk: RustFactWalk, declaration: Node, sourceFile: SourceFile): void {
  if (!walk.context.isNativeNode(declaration)) return;
  const { ast } = walk.context;
  const asyncFact = walk.context.records.asyncFunction.get(declaration);
  const generatorFact = walk.context.records.generator.get(declaration);
  const returnCarrier = generatorFact?.returnType ?? asyncFact?.outputCarrier ??
    walk.context.records.sourceCallableReturn.get(declaration)?.returnCarrier;
  const body = ast.body(declaration);
  const previousCallable = walk.currentCallableDeclaration;
  const previousGenerator = walk.currentGeneratorDeclaration;
  walk.currentCallableDeclaration = declaration;
  walk.currentGeneratorDeclaration = generatorFact === undefined ? undefined : declaration;
  try {
    if (!recordCallableDefaultParameterFacts(walk, declaration)) return;
    if (body !== undefined && ast.kindName(body) === KindBlock) {
      const statements = requireDenseSourceNodes(walk, ast.statements(body), "Function body contains an undefined or non-data statement slot.");
      if (statements === undefined) {
        return;
      }
      for (const statement of statements) {
        recordStatementFacts(walk, statement, sourceFile, returnCarrier);
      }
    } else if (body !== undefined) {
      resolveExpressionCarrier(walk, body, sourceFile, returnCarrier);
    }
  } finally {
    walk.currentCallableDeclaration = previousCallable;
    walk.currentGeneratorDeclaration = previousGenerator;
  }
}

export function recordVariableStatementFacts(
  walk: RustFactWalk,
  statement: Node,
  sourceFile: SourceFile,
): void {
  if (walk.context.records.typeOnlyDeclarations.statement(walk, statement) !== undefined) return;
  const declarationList = VariableStatement_DeclarationList(walk.context.ast, statement);
  recordVariableDeclarationListFacts(walk, declarationList, statement, sourceFile);
}

function recordVariableDeclarationListFacts(
  walk: RustFactWalk,
  declarationList: Node | undefined,
  owner: Node,
  sourceFile: SourceFile,
): void {
  const declarationSlots = VariableDeclarationList_Declarations(
    walk.context.ast,
    declarationList,
  );
  if (declarationSlots === undefined || !isDenseDataArray(declarationSlots) ||
    declarationSlots.some((declaration) =>
      declaration === undefined || walk.context.ast.kindName(declaration) !== KindVariableDeclaration)) {
    appendRustDiagnostic(
      walk,
      "RUST_VARIABLE_DECLARATIONS_NOT_CLOSED",
      "Variable declaration owner has no exact dense declaration list.",
      owner,
      ["target.capability=rust.source.variable-declarations"],
    );
    return;
  }
  for (const declaration of declarationSlots as readonly Node[]) {
    recordVariableDeclarationFacts(walk, declaration, sourceFile);
  }
}

export function recordVariableDeclarationFacts(
  walk: RustFactWalk,
  declaration: Node,
  sourceFile: SourceFile,
): void {
  const { ast } = walk.context;
  const declarationList = ast.parent(declaration);
  const owner = declarationList === undefined ? undefined : ast.parent(declarationList);
  if (ast.kindName(declaration) !== KindVariableDeclaration || declarationList === undefined || owner === undefined ||
    ast.kindName(declarationList) !== KindVariableDeclarationList) {
    failTargetAnalysisInvariant("tsonic-rust", "Variable admission requires its exact checked declaration owner.", declaration);
  }
  const moduleLevel = ast.kindName(owner) === KindVariableStatement &&
    ast.kindName(ast.parent(owner)) === "KindSourceFile";
  if (!moduleLevel) {
    recordVariableDeclarationValueFacts(walk, declaration, sourceFile, false);
    return;
  }
  if (walk.resolving.has(declaration) || walk.rejectedExpressions.has(declaration)) return;
  const previousCallable = walk.currentCallableDeclaration;
  const previousGenerator = walk.currentGeneratorDeclaration;
  walk.resolving.add(declaration);
  walk.currentCallableDeclaration = undefined;
  walk.currentGeneratorDeclaration = undefined;
  try {
    recordVariableDeclarationValueFacts(walk, declaration, sourceFile, true);
  } finally {
    walk.currentCallableDeclaration = previousCallable;
    walk.currentGeneratorDeclaration = previousGenerator;
    walk.resolving.delete(declaration);
  }
}

function recordVariableDeclarationValueFacts(
  walk: RustFactWalk,
  declaration: Node,
  sourceFile: SourceFile,
  moduleLevel: boolean,
): void {
  if (walk.context.records.compileTimeSource.get(declaration)) return;
  const diagnosticsBefore = walk.context.diagnostics.length;
  recordCallableValueSignatureForDeclaration(walk, declaration);
  const nativeCallable = moduleLevel
    ? walk.context.records.moduleBinding.get(declaration)
    : undefined;
  const initializer = Node_Initializer(walk.context.ast, declaration);
  const lexical = initializer !== undefined && walk.context.sourceCallables.directLexicalBinding(initializer) === declaration;
  if (nativeCallable?.storage === "native-callable" || lexical) {
    recordFunctionBodyFacts(
      walk,
      nativeCallable?.storage === "native-callable" ? nativeCallable.callableDeclaration : initializer!,
      sourceFile,
    );
    return;
  }
  const selection = selectRustDeclaredBinding(walk, declaration, sourceFile);
  if (selection.kind === "unresolved") return;
  const effective = selection.carrier;
  const initializerCarrier = selection.initializerCarrier;
  const name = Node_Name(walk.context.ast, declaration);
  const nameKind = name === undefined ? "" : walk.context.ast.kindName(name);
  if (name !== undefined && (nameKind === KindArrayBindingPattern || nameKind === KindObjectBindingPattern) &&
    (!moduleLevel || walk.context.records.moduleBinding.get(declaration)?.storage !== "module-pattern") &&
    !recordBindingPatternFacts(walk, name, effective)) {
    appendRustDiagnostic(
      walk,
      "RUST_BINDING_PATTERN_NOT_CLOSED",
      "Binding pattern has no total Rust projection from its exact finalized source carrier.",
      name,
      ["target.capability=rust.binding-pattern"],
    );
    return;
  }
  const declarationKind = walk.context.ast.variableDeclarationKind(declaration);
  if (moduleLevel && (declarationKind === "const" || declarationKind === "let" || declarationKind === "var")) {
    walk.context.records.moduleBindings.value(walk, declaration, declarationKind, effective);
  }
  if (moduleLevel && declarationKind === "const" && initializer !== undefined &&
    initializerCarrier !== undefined && rustTargetTypeRefEquals(effective, initializerCarrier) &&
    walk.context.diagnostics.length === diagnosticsBefore &&
    sourceDeclarationHasOnlyTypeUses(walk.context.source.navigation.declarationUseSummary(declaration)) &&
    rustMetadataInitializerIsHarmless(walk, initializer, effective)) {
    requireRustRecord(walk.context.requiredRecords, "compileTimeSource", declaration,
      "admitted metadata-only constant", "recordVariableDeclarationListFacts");
    walk.context.records.compileTimeSources.erase(declaration);
  }
}

function rustMetadataInitializerIsHarmless(walk: RustFactWalk, initializer: Node, carrier: TargetTypeRef): boolean {
  const effects = walk.context.source.navigation.expressionEffects(initializer);
  if (effects.invokes || effects.mutates || effects.suspends || effects.mayThrow) return false;
  let expression = initializer;
  for (;;) {
    const selected = walk.context.records.runtimeCarrier.get(expression)?.carrier;
    if (selected === undefined || !rustTargetTypeRefEquals(selected, carrier)) return false;
    const operand = sourceTransparentExpressionOperand(walk.context.ast, expression);
    if (operand === undefined) break;
    expression = operand;
  }
  const literal = walk.context.literalValues.literalValue.get(expression);
  if (literal === undefined) return false;
  if (literal.form === "string" || literal.form === "template") return !/[\uD800-\uDFFF]/u.test(literal.text) && (isRustStringCarrier(carrier) ||
      carrier.kind === "source-primitive" && carrier.name === "char");
  if (literal.form === "true" || literal.form === "false") return isRustBoolCarrier(carrier);
  return isRustNumericLiteralCarrier(carrier) && (literal.form === "bigint" && literal.integer !== undefined ||
    (literal.form === "numeric" || literal.form === "prefix-unary") && literal.numeric !== undefined);
}

export function recordExportAssignmentFacts(
  walk: RustFactWalk,
  declaration: Node,
): TargetTypeRef | undefined {
  walk.context.records.assertOpen();
  const { ast } = walk.context;
  const assignment = ast.as.AsExportAssignment(declaration);
  const sourceFile = ast.getSourceFile(declaration);
  if (assignment === undefined || assignment.IsExportEquals === true ||
    assignment.Expression === undefined || sourceFile === undefined) {
    appendRustDiagnostic(
      walk,
      "RUST_EXPORT_ASSIGNMENT_NOT_CLOSED",
      "Default exports require one exact ESM export expression in project source.",
      declaration,
      ["target.capability=rust.source.default-export"],
    );
    return undefined;
  }
  const existing = walk.context.records.runtimeCarrier.get(declaration);
  const carrier = existing?.carrier ?? resolveExpressionCarrier(
    walk,
    assignment.Expression,
    sourceFile,
    undefined,
  );
  if (carrier === undefined) {
    return undefined;
  }
  const finalized = setCarrierFact(walk, declaration, carrier);
  if (finalized === undefined) {
    return undefined;
  }
  requireRustRecord(walk.context.requiredRecords, "moduleBinding", declaration, "default-export", "recordExportAssignmentFacts");
  const binding = walk.context.records.moduleBinding.get(declaration);
  if (binding === undefined) walk.context.records.moduleBindings.defaultExport(declaration, finalized);
  else if (binding.declarationKind !== "const" || binding.storage !== "module-cell" ||
    binding.initialization !== "value" || !rustTargetTypeRefEquals(binding.valueCarrier, finalized)) {
    failTargetAnalysisInvariant("tsonic-rust",
      "Conflicting Rust semantic plan 'tsonic.rust.moduleBinding' for one exact source subject.", declaration);
  }
  return finalized;
}

export function recordStatementFacts(
  walk: RustFactWalk,
  statement: Node,
  sourceFile: SourceFile,
  returnCarrier: TargetTypeRef | undefined,
): void {
  if (!walk.context.isNativeNode(statement) || recordRustNativeUnreachable(walk, statement)) return;
  const { ast } = walk.context;
  const kind = ast.kindName(statement);
  if (kind === "KindFunctionDeclaration") {
    if (ast.body(statement) !== undefined) recordFunctionBodyFacts(walk, statement, sourceFile);
    return;
  }
  if (kind === "KindClassDeclaration" && walk.context.projectTypes.definitionForDeclaration(statement) !== undefined) return;
  if (kind === "KindTypeAliasDeclaration") {
    walk.context.records.typeAliasDeclarations.register(walk, statement);
    return;
  }
  if (kind === KindBlock) {
    const statements = requireDenseSourceNodes(walk, ast.statements(statement), "Block contains an undefined or non-data statement slot.");
    if (statements === undefined) {
      return;
    }
    for (const child of statements) {
      recordStatementFacts(walk, child, sourceFile, returnCarrier);
    }
    return;
  }
  if (kind === KindVariableStatement) {
    recordVariableStatementFacts(walk, statement, sourceFile);
    return;
  }
  if (kind === KindLabeledStatement) {
    const body = LabeledStatement_Statement(walk.context.ast, statement);
    if (body !== undefined) {
      recordStatementFacts(walk, body, sourceFile, returnCarrier);
    }
    return;
  }
  if (kind === KindSwitchStatement) {
    recordSwitchFacts(walk, statement, sourceFile, returnCarrier);
    return;
  }
  if (kind === KindReturnStatement) {
    const expression = Node_Expression(walk.context.ast, statement);
    if (expression !== undefined) {
      const resolved = resolveExpressionCarrier(
        walk,
        expression,
        sourceFile,
        returnCarrier,
      );
      if (returnCarrier !== undefined && resolved !== undefined &&
        !reconcileRequiredCarrier(walk, expression, resolved, returnCarrier)) {
        appendRustDiagnostic(
          walk,
          "RUST_RETURN_CARRIER_MISMATCH",
          "The returned source value cannot be represented by the callable's exact Rust return carrier.",
          expression,
          ["target.capability=rust.return-carrier"],
        );
      }
    }
    return;
  }
  if (kind === KindExpressionStatement) {
    const expression = Node_Expression(walk.context.ast, statement);
    if (expression === undefined) {
      return;
    }
    if (!walk.context.records.compileTimeSource.get(expression)) resolveExpressionCarrier(walk, expression, sourceFile, undefined);
    return;
  }
  if (kind === "KindThrowStatement") {
    recordThrowFacts(walk, statement, sourceFile);
    return;
  }
  if (kind === "KindTryStatement") {
    const tryBlock = TryStatement_TryBlock(walk.context.ast, statement);
    if (tryBlock !== undefined) {
      recordStatementFacts(walk, tryBlock, sourceFile, returnCarrier);
    }
    const catchClause = TryStatement_CatchClause(walk.context.ast, statement);
    const catchVariable = CatchClause_VariableDeclaration(walk.context.ast, catchClause);
    if (catchVariable !== undefined) {
      setCarrierFact(walk, catchVariable, rustProgramErrorTargetType());
      const catchName = Node_Name(walk.context.ast, catchVariable);
      if (catchName !== undefined) {
        setCarrierFact(walk, catchName, rustProgramErrorTargetType());
      }
    }
    const catchBlock = CatchClause_Block(walk.context.ast, catchClause);
    if (catchBlock !== undefined) {
      recordStatementFacts(walk, catchBlock, sourceFile, returnCarrier);
    }
    const finallyBlock = TryStatement_FinallyBlock(walk.context.ast, statement);
    if (finallyBlock !== undefined) {
      recordStatementFacts(walk, finallyBlock, sourceFile, returnCarrier);
    }
    return;
  }
  if (kind === KindIfStatement) {
    const condition = Node_Expression(walk.context.ast, statement);
    const result = condition === undefined ? undefined : recordRustNativeGuardResult(walk, condition);
    if (result !== undefined) {
      const branch = result ? IfStatement_ThenStatement(walk.context.ast, statement)
        : IfStatement_ElseStatement(walk.context.ast, statement);
      const unselectedBranch = result ? IfStatement_ElseStatement(walk.context.ast, statement)
        : IfStatement_ThenStatement(walk.context.ast, statement);
      if (unselectedBranch !== undefined) recordRustNativeUnreachable(walk, unselectedBranch);
      if (branch !== undefined) recordStatementFacts(walk, branch, sourceFile, returnCarrier);
      return;
    }
    if (condition !== undefined) {
      resolveExpressionCarrier(walk, condition, sourceFile, boolCarrier);
    }
    const thenStatement = IfStatement_ThenStatement(walk.context.ast, statement);
    if (thenStatement !== undefined) {
      recordStatementFacts(walk, thenStatement, sourceFile, returnCarrier);
    }
    const elseStatement = IfStatement_ElseStatement(walk.context.ast, statement);
    if (elseStatement !== undefined) {
      recordStatementFacts(walk, elseStatement, sourceFile, returnCarrier);
    }
    return;
  }
  if (kind === KindWhileStatement || kind === KindDoStatement) {
    const condition = Node_Expression(walk.context.ast, statement);
    if (condition !== undefined) {
      resolveExpressionCarrier(walk, condition, sourceFile, boolCarrier);
    }
    const body = kind === KindDoStatement
      ? DoStatement_Statement(walk.context.ast, statement)
      : IterationStatement_Statement(walk.context.ast, statement);
    if (body !== undefined) {
      recordStatementFacts(walk, body, sourceFile, returnCarrier);
    }
    return;
  }
  if (kind === KindForOfStatement || kind === KindForInStatement) {
    recordForOfFacts(walk, statement, sourceFile, returnCarrier);
    return;
  }
  if (kind === KindForStatement) {
    const initializer = ForStatement_Initializer(walk.context.ast, statement);
    if (initializer !== undefined) {
      if (walk.context.ast.kindName(initializer) === KindVariableDeclarationList) {
        recordVariableDeclarationListFacts(walk, initializer, statement, sourceFile);
      } else resolveExpressionCarrier(walk, initializer, sourceFile, undefined);
    }
    const condition = ForStatement_Condition(walk.context.ast, statement);
    if (condition !== undefined) {
      resolveExpressionCarrier(walk, condition, sourceFile, boolCarrier);
    }
    const incrementor = ForStatement_Incrementor(walk.context.ast, statement);
    if (incrementor !== undefined) {
      resolveExpressionCarrier(walk, incrementor, sourceFile, undefined);
    }
    const body = IterationStatement_Statement(walk.context.ast, statement);
    if (body !== undefined) {
      recordStatementFacts(walk, body, sourceFile, returnCarrier);
    }
    return;
  }
}

function recordSwitchFacts(
  walk: RustFactWalk,
  statement: Node,
  sourceFile: SourceFile,
  returnCarrier: TargetTypeRef | undefined,
): void {
  const { ast } = walk.context;
  const discriminant = SwitchStatement_Expression(ast, statement);
  const clauses = CaseBlock_Clauses(ast, SwitchStatement_CaseBlock(ast, statement));
  if (discriminant === undefined || clauses === undefined || clauses.some((clause) => clause === undefined)) {
    return;
  }
  const discriminantCarrier = resolveExpressionCarrier(walk, discriminant, sourceFile, undefined);
  if (discriminantCarrier === undefined || !rustSwitchCarrierSupportsEquality(discriminantCarrier)) {
    appendRustDiagnostic(
      walk,
      "RUST_SWITCH_DISCRIMINANT_NOT_CLOSED",
      "Switch discrimination requires an exact closed Rust equality carrier.",
      statement,
      ["target.capability=rust.switch"],
    );
    return;
  }
  const finalizedClauses: Extract<RustTargetOperationFact, { readonly kind: "switch" }>["clauses"][number][] = [];
  let failed = false;
  for (const clause of clauses as readonly Node[]) {
    const expression = CaseOrDefaultClause_Expression(ast, clause);
    if (ast.kindName(clause) === KindCaseClause) {
      const carrier = expression === undefined
        ? undefined
        : resolveExpressionCarrier(walk, expression, sourceFile, rustOptionElementCarrier(discriminantCarrier) ?? discriminantCarrier);
      const comparison = carrier === undefined ? undefined : selectRustSwitchComparison(discriminantCarrier, carrier);
      if (expression === undefined || carrier === undefined || comparison === undefined) {
        appendRustDiagnostic(
          walk,
          "RUST_SWITCH_CASE_NOT_CLOSED",
          "Switch case selection requires an exact native equality and absence relationship.",
          clause,
          ["target.capability=rust.switch"],
        );
        failed = true;
      } else {
        const borrowedLiteral = isRustStringCarrier(carrier) &&
          (ast.is.IsStringLiteral(expression) || ast.is.IsNoSubstitutionTemplateLiteral(expression)) ? ast.text(expression) : undefined;
        finalizedClauses.push(Object.freeze({ clause, expression, carrier, comparison: Object.freeze(comparison),
          ...(borrowedLiteral === undefined ? {} : { borrowedLiteral }) }));
      }
    } else {
      finalizedClauses.push(Object.freeze({ clause }));
    }
    const statements = CaseOrDefaultClause_Statements(ast, clause);
    if (statements === undefined || statements.some((child) => child === undefined)) {
      failed = true;
      continue;
    }
    for (const child of statements as readonly Node[]) {
      recordStatementFacts(walk, child, sourceFile, returnCarrier);
    }
  }
  if (!failed && finalizedClauses.length === clauses.length) {
    requireRustRecord(walk.context.requiredRecords, "targetOperation", statement, "switch", "analysis/control-flow/statements.ts");
    walk.context.records.targetOperations.source(statement, {
      kind: "switch",
      operationId: "tsonic.rust.control.switch.strict-equality",
      discriminantCarrier,
      clauses: Object.freeze(finalizedClauses),
    });
  }
}
