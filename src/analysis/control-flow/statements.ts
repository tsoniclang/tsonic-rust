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
  KindVariableStatement,
  KindWhileStatement,
  Node_Expression,
  Node_Initializer,
  Node_Name,
  Node_Type,
  VariableDeclarationList_Declarations,
  VariableStatement_DeclarationList,
} from "@tsonic/target-api/source";
import {
  isRustBoolCarrier,
  isRustNumericCarrier,
  isRustStringCarrier,
  rustProgramErrorTargetType,
  rustSourceTypeCarrierValue,
} from "../../target-model/types/index.js";
import {
  rustAsyncFunctionFactKey,
  rustGeneratorFactKey,
  rustModuleBindingFactKey,
  rustSourceCallableReturnFactKey,
  rustSourceParameterAbiFactKey,
} from "../facts/keys.js";
import { appendRustDiagnostic, boolCarrier, rustResolutionContext } from "../program/walk.js";
import { collectDescendantsOfKind, recordForOfFacts } from "../operations/inputs.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { reconcileRequiredCarrier, resolveExpressionCarrier } from "../expressions/carriers.js";
import {
  recordBindingPatternFacts,
  rustArgumentModeForSourceContract,
  validateOwnershipExpressionAgainstContract,
} from "../declarations/types-and-bindings.js";
import { recordCallableValueSignatureForDeclaration } from "../callables/signatures.js";
import { recordThrowFacts } from "../resources/suspension.js";
import { requireDenseSourceNodes } from "../expressions/records.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { rustSourceOwnershipContractForType } from "../../policy/ownership/source-callable-abi.js";
import { rustRuntimeCarrierKey } from "../../target-model/facts/selections.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { setCarrierFact, setRustOperationFact } from "../operations/project-calls.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { RustTargetOperationFact } from "../facts/keys.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export function recordFunctionBodyFacts(walk: RustFactWalk, declaration: Node, sourceFile: SourceFile): void {
  const { ast } = walk.context;
  const asyncFact = walk.context.facts.get(declaration, rustAsyncFunctionFactKey);
  const generatorFact = walk.context.facts.get(declaration, rustGeneratorFactKey);
  const returnCarrier = generatorFact?.returnType ?? asyncFact?.outputCarrier ??
    walk.context.facts.get(declaration, rustSourceCallableReturnFactKey)?.returnCarrier;
  const body = ast.body(declaration);
  const previousCallable = walk.currentCallableDeclaration;
  const previousGenerator = walk.currentGeneratorDeclaration;
  walk.currentCallableDeclaration = declaration;
  walk.currentGeneratorDeclaration = generatorFact === undefined ? undefined : declaration;
  if (body !== undefined) {
    const statements = requireDenseSourceNodes(walk, ast.statements(body), "Function body contains an undefined or non-data statement slot.");
    if (statements === undefined) {
      walk.currentCallableDeclaration = previousCallable;
      walk.currentGeneratorDeclaration = previousGenerator;
      return;
    }
    for (const statement of statements) {
      recordStatementFacts(walk, statement, sourceFile, returnCarrier);
    }
  }
  walk.currentCallableDeclaration = previousCallable;
  walk.currentGeneratorDeclaration = previousGenerator;
}

export function recordVariableStatementFacts(walk: RustFactWalk, statement: Node, sourceFile: SourceFile): void {
  const moduleLevel = walk.context.ast.kindName(walk.context.ast.parent(statement)) === "KindSourceFile";
  const declarationList = VariableStatement_DeclarationList(walk.context.ast, statement);
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
      "Variable statement has no exact dense declaration list.",
      statement,
      ["target.capability=rust.source.variable-declarations"],
    );
    return;
  }
  for (const declaration of declarationSlots as readonly Node[]) {
    recordVariableDeclarationFacts(walk, declaration, sourceFile, moduleLevel);
  }
}

function recordVariableDeclarationFacts(
  walk: RustFactWalk,
  declaration: Node,
  sourceFile: SourceFile,
  moduleLevel: boolean,
): void {
  recordCallableValueSignatureForDeclaration(walk, declaration);
  const nativeCallable = moduleLevel
    ? walk.context.facts.get(declaration, rustModuleBindingFactKey) ??
      walk.context.facts.resolve(declaration, rustModuleBindingFactKey)
    : undefined;
  if (nativeCallable?.storage === "native-callable") {
    recordNativeModuleFunctionBodyFacts(
      walk,
      nativeCallable.callableDeclaration,
      sourceFile,
    );
    return;
  }
  const annotated = resolveTypeNodeCarrier(walk, Node_Type(walk.context.ast, declaration));
  const predeclared = walk.context.facts.get(declaration, rustRuntimeCarrierKey)?.carrier ??
    walk.context.facts.resolve(declaration, rustRuntimeCarrierKey)?.carrier;
  const initializer = Node_Initializer(walk.context.ast, declaration);
  const initializerCarrier = initializer === undefined
    ? undefined
    : resolveExpressionCarrier(walk, initializer, sourceFile, annotated ?? predeclared);
  if (initializer !== undefined) {
    const annotatedContract = rustSourceOwnershipContractForTypeNode(walk, declaration);
    if (annotatedContract !== "ordinary") {
      validateOwnershipExpressionAgainstContract(
        walk,
        initializer,
        rustArgumentModeForSourceContract(annotatedContract),
        annotatedContract,
      );
    }
  }
  const effective = annotated ?? initializerCarrier ?? predeclared;
  if (effective === undefined) return;
  setCarrierFact(walk, declaration, effective);
  const name = Node_Name(walk.context.ast, declaration);
  const nameKind = name === undefined ? "" : walk.context.ast.kindName(name);
  if (name !== undefined && (nameKind === KindArrayBindingPattern || nameKind === KindObjectBindingPattern) &&
    !recordBindingPatternFacts(walk, name, effective)) {
    appendRustDiagnostic(
      walk,
      "RUST_BINDING_PATTERN_NOT_CLOSED",
      "Binding pattern has no total Rust projection from its exact finalized source carrier.",
      name,
      ["target.capability=rust.binding-pattern"],
    );
  }
  const declarationKind = walk.context.ast.variableDeclarationKind(declaration);
  if (moduleLevel && (declarationKind === "const" || declarationKind === "let" || declarationKind === "var")) {
    walk.context.facts.set(
      declaration,
      rustModuleBindingFactKey,
      walk.moduleBindings.classifyValue(declaration, declarationKind, effective),
      [{ message: "rust finalized project module binding storage" }],
    );
  }
}

function rustSourceOwnershipContractForTypeNode(
  walk: RustFactWalk,
  declaration: Node,
): import("../../target-model/operations/model.js").RustSourceParameterContract {
  return rustSourceOwnershipContractForType(
    Node_Type(walk.context.ast, declaration),
    rustResolutionContext(walk, declaration),
  );
}

export function recordExportAssignmentFacts(
  walk: RustFactWalk,
  declaration: Node,
): TargetTypeRef | undefined {
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
  const existing = walk.context.facts.get(declaration, rustRuntimeCarrierKey) ??
    walk.context.facts.resolve(declaration, rustRuntimeCarrierKey);
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
  walk.context.facts.set(declaration, rustModuleBindingFactKey, {
    declarationKind: "const",
    storage: "module-cell",
    valueCarrier: finalized,
  }, [{ message: "rust finalized default export snapshot storage" }]);
  return finalized;
}

function recordNativeModuleFunctionBodyFacts(
  walk: RustFactWalk,
  declaration: Node,
  sourceFile: SourceFile,
): void {
  const body = walk.context.ast.body(declaration);
  const returnCarrier = walk.context.facts.get(declaration, rustSourceCallableReturnFactKey)?.returnCarrier ??
    walk.context.facts.resolve(declaration, rustSourceCallableReturnFactKey)?.returnCarrier;
  if (body === undefined || returnCarrier === undefined) {
    return;
  }
  const previousCallable = walk.currentCallableDeclaration;
  const previousGenerator = walk.currentGeneratorDeclaration;
  walk.currentCallableDeclaration = declaration;
  walk.currentGeneratorDeclaration = undefined;
  if (walk.context.ast.kindName(body) === KindBlock) {
    const statements = requireDenseSourceNodes(
      walk,
      walk.context.ast.statements(body),
      "Native module function body contains an undefined or non-data statement slot.",
    );
    if (statements !== undefined) {
      for (const statement of statements) {
        recordStatementFacts(walk, statement, sourceFile, returnCarrier);
      }
    }
  } else {
    resolveExpressionCarrier(walk, body, sourceFile, returnCarrier);
  }
  walk.currentCallableDeclaration = previousCallable;
  walk.currentGeneratorDeclaration = previousGenerator;
}

export function recordStatementFacts(
  walk: RustFactWalk,
  statement: Node,
  sourceFile: SourceFile,
  returnCarrier: TargetTypeRef | undefined,
): void {
  const { ast } = walk.context;
  const kind = ast.kindName(statement);
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
      const returnContract = walk.currentCallableDeclaration === undefined
        ? undefined
        : walk.context.facts.get(
            walk.currentCallableDeclaration,
            rustSourceCallableReturnFactKey,
          ) ?? walk.context.facts.resolve(
            walk.currentCallableDeclaration,
            rustSourceCallableReturnFactKey,
          );
      const returnMode = returnContract?.sourceContract === "shared-reference"
        ? "ref"
        : returnContract?.sourceContract === "mutable-reference"
          ? "mut-ref"
          : "value";
      validateOwnershipExpressionAgainstContract(
        walk,
        expression,
        returnMode,
        returnContract?.sourceContract,
      );
      const resolved = resolveExpressionCarrier(
        walk,
        expression,
        sourceFile,
        returnCarrier,
      );
      const resolvedAbiCarrier = walk.context.facts.get(
        expression,
        rustSourceParameterAbiFactKey,
      )?.parameterCarrier ?? walk.context.facts.resolve(
        expression,
        rustSourceParameterAbiFactKey,
      )?.parameterCarrier ?? resolved;
      if (returnCarrier !== undefined && resolvedAbiCarrier !== undefined &&
        !reconcileRequiredCarrier(walk, expression, resolvedAbiCarrier, returnCarrier)) {
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
    resolveExpressionCarrier(walk, expression, sourceFile, undefined);
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
      for (const declaration of collectDescendantsOfKind(walk, initializer, KindVariableDeclaration)) {
        recordVariableDeclarationFacts(walk, declaration, sourceFile, false);
      }
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
        : resolveExpressionCarrier(walk, expression, sourceFile, discriminantCarrier);
      if (expression === undefined || carrier === undefined ||
        !rustTargetTypeRefEquals(carrier, discriminantCarrier)) {
        appendRustDiagnostic(
          walk,
          "RUST_SWITCH_CASE_NOT_CLOSED",
          "Switch case selection requires the exact discriminant carrier.",
          clause,
          ["target.capability=rust.switch"],
        );
        failed = true;
      } else {
        finalizedClauses.push({ clause, expression, carrier });
      }
    } else {
      finalizedClauses.push({ clause });
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
    setRustOperationFact(walk, statement, {
      kind: "switch",
      operationId: "tsonic.rust.control.switch.strict-equality",
      discriminantCarrier,
      clauses: finalizedClauses,
    });
  }
}

function rustSwitchCarrierSupportsEquality(carrier: TargetTypeRef): boolean {
  const sourceType = rustSourceTypeCarrierValue(carrier);
  return isRustNumericCarrier(carrier) || isRustBoolCarrier(carrier) ||
    isRustStringCarrier(carrier) || sourceType?.shape === "enum";
}



export function resolveTypeNodeCarrier(walk: RustFactWalk, typeNode: Node | undefined): TargetTypeRef | undefined {
  if (typeNode === undefined) {
    return undefined;
  }
  const facts = walk.context.facts;
  const existing = facts.get(typeNode, rustRuntimeCarrierKey) ??
    walk.context.facts.resolve(typeNode, rustRuntimeCarrierKey);
  if (existing !== undefined) {
    return existing.carrier;
  }
  const carrier = resolveRustTargetTypeRef(
    typeNode,
    rustResolutionContext(walk, typeNode),
    walk.operationOptions,
  );
  return carrier === undefined ? undefined : setCarrierFact(walk, typeNode, carrier);
}
