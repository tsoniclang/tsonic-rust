import {
  KindFunctionExpression,
  KindArrayBindingPattern,
  KindNonNullExpression,
  KindObjectBindingPattern,
  KindParenthesizedExpression,
  KindSatisfiesExpression,
  KindVariableDeclaration,
  KindVariableStatement,
  Node_Expression,
  Node_Initializer,
  Node_Name,
  Node_Type,
  VariableDeclarationList_Declarations,
  VariableStatement_DeclarationList,
} from "@tsonic/target-api/source";
import {
  rustAsyncFunctionFactKey,
  rustGeneratorFactKey,
  rustModuleBindingFactKey,
  rustSourceCallableReturnFactKey,
  rustSourceParameterAbiFactKey,
} from "../facts/keys.js";
import {
  rustFutureOutputCarrier,
  getRustGeneratorProtocol,
  rustOptionTargetType,
  rustCallableProtocol,
  rustClosureProtocol,
  rustCallableTargetType,
} from "../../policy/types/target-types.js";
import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";
import { isDenseDataArray } from "../../policy/model/closed-data.js";
import { recordBindingPatternFacts, recordDefaultParameterInitializerFacts, recordParameterAbiFacts, resolveParameterAbi, setParameterAbiFact } from "../declarations/types-and-bindings.js";
import { requireDenseSourceNodes } from "../expressions/records.js";
import { resolveRustContextualParameterAbi } from "../../policy/ownership/source-callable-abi.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { rustRuntimeCarrierKey } from "../../policy/model/selections.js";
import { setCarrierFact } from "../operations/project-calls.js";
import type { ExtensionFactSubject, Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../policy/types/model.js";

function promiseInnerCarrier(
  walk: RustFactWalk,
  declaration: Node,
  subject: ExtensionFactSubject | undefined,
): TargetTypeRef | undefined {
  return rustFutureOutputCarrier(resolveRustTargetTypeRef(
    subject,
    rustResolutionContext(walk, declaration),
    walk.operationOptions,
  ));
}

export function recordFunctionSignatureFacts(walk: RustFactWalk, declaration: Node): void {
  recordCallableSuspensionFacts(walk, declaration);
  recordCallableTypeSignatureFacts(walk, declaration);
}

function recordCallableTypeSignatureFacts(walk: RustFactWalk, declaration: Node): void {
  recordCallableReturnFact(walk, declaration);
  const parameters = requireDenseSourceNodes(walk, walk.context.ast.parameters(declaration), "Function declaration contains an undefined or non-data parameter slot.");
  if (parameters === undefined) {
    return;
  }
  for (const parameter of parameters) {
    recordParameterAbiFacts(walk, parameter);
  }
}

export function recordNestedCallableTypeSignatureFacts(walk: RustFactWalk, sourceFile: SourceFile): void {
  const { ast } = walk.context;
  const visit = (node: Node | undefined): void => {
    if (node === undefined) {
      return;
    }
    const kind = ast.kindName(node);
    if (kind === "KindFunctionType" || kind === "KindCallSignature") {
      recordCallableTypeSignatureFacts(walk, node);
    }
    ast.forEachChild(node, visit);
  };
  visit(sourceFile);
}

export function recordTopLevelCallableValueSignatureFacts(
  walk: RustFactWalk,
  sourceFile: SourceFile,
): void {
  recordCallableValueSignaturesForStatements(
    walk,
    walk.context.ast.statements(sourceFile) as readonly Node[],
  );
}

export function recordPredeclaredNativeFunctionBindingFacts(
  walk: RustFactWalk,
  sourceFile: SourceFile,
): void {
  const { ast } = walk.context;
  for (const statement of ast.statements(sourceFile)) {
    if (statement === undefined || ast.kindName(statement) !== KindVariableStatement) {
      continue;
    }
    const declarations = VariableDeclarationList_Declarations(
      ast,
      VariableStatement_DeclarationList(ast, statement),
    );
    if (declarations === undefined) {
      continue;
    }
    for (const declaration of declarations) {
      if (declaration === undefined || ast.kindName(declaration) !== KindVariableDeclaration ||
        ast.variableDeclarationKind(declaration) !== "const") {
        continue;
      }
      const candidate = walk.moduleBindings.nativeFunction(declaration);
      if (candidate === undefined || !nativeModuleFunctionAbiIsFinalized(
        walk,
        candidate.callableDeclaration,
      )) {
        continue;
      }
      walk.context.facts.set(declaration, rustModuleBindingFactKey, {
        declarationKind: "const",
        storage: "native-function",
        callableDeclaration: candidate.callableDeclaration,
        name: candidate.name,
      }, [
        { message: "rust finalized native module function storage" },
      ]);
    }
  }
}

function nativeModuleFunctionAbiIsFinalized(
  walk: RustFactWalk,
  callableDeclaration: Node,
): boolean {
  const parameters = walk.context.ast.parameters(callableDeclaration);
  return isDenseDataArray(parameters) &&
    parameters.every((parameter) =>
      parameter !== undefined &&
      (walk.context.facts.get(parameter, rustSourceParameterAbiFactKey) ??
        walk.context.facts.resolve(parameter, rustSourceParameterAbiFactKey)) !== undefined) &&
    (walk.context.facts.get(callableDeclaration, rustSourceCallableReturnFactKey) ??
      walk.context.facts.resolve(callableDeclaration, rustSourceCallableReturnFactKey)) !== undefined;
}

function recordCallableValueSignaturesForStatements(
  walk: RustFactWalk,
  statements: readonly Node[],
): void {
  for (const statement of statements) {
    if (walk.context.ast.kindName(statement) === KindVariableStatement) {
      recordCallableValueSignaturesForVariableStatement(walk, statement);
    }
  }
}

function recordCallableValueSignaturesForVariableStatement(
  walk: RustFactWalk,
  statement: Node,
): void {
  const { ast } = walk.context;
  const declarations = VariableDeclarationList_Declarations(
    ast,
    VariableStatement_DeclarationList(ast, statement),
  );
  if (declarations === undefined || !isDenseDataArray(declarations)) {
    return;
  }
  for (const declaration of declarations) {
    if (declaration === undefined || ast.kindName(declaration) !== KindVariableDeclaration) {
      return;
    }
    recordCallableValueSignatureForDeclaration(walk, declaration);
  }
}

export function recordCallableValueSignatureForDeclaration(
  walk: RustFactWalk,
  declaration: Node,
): void {
  const { ast } = walk.context;
  let initializer = Node_Initializer(ast, declaration);
  while (initializer !== undefined) {
    const kind = ast.kindName(initializer);
    if (kind === KindParenthesizedExpression || kind === KindNonNullExpression ||
      kind === KindSatisfiesExpression || kind === "KindAsExpression" ||
      kind === "KindTypeAssertionExpression") {
      initializer = Node_Expression(ast, initializer);
      continue;
    }
    if (kind === "KindArrowFunction" || kind === KindFunctionExpression) {
      recordCallableValueSignatureFacts(walk, declaration, initializer);
    }
    break;
  }
}

function recordCallableValueSignatureFacts(
  walk: RustFactWalk,
  declaration: Node,
  expression: Node,
): void {
  const { ast } = walk.context;
  const nativeFunction = walk.moduleBindings.nativeFunction(declaration);
  if (nativeFunction?.callableDeclaration === expression) {
    const nativeSignature = resolveAuthoredCallableValueSignature(walk, expression);
    if (nativeSignature !== undefined) {
      recordCallableValueSignaturePlan(walk, expression, nativeSignature);
      return;
    }
  }
  const selectedCarrier = walk.context.facts.get(declaration, rustRuntimeCarrierKey)?.carrier ??
    walk.context.facts.resolve(declaration, rustRuntimeCarrierKey)?.carrier ??
    resolveRustTargetTypeRef(
      Node_Type(ast, declaration) ?? expression,
      rustResolutionContext(walk, declaration),
      walk.operationOptions,
    );
  const callable = rustCallableProtocol(selectedCarrier);
  const closure = rustClosureProtocol(selectedCarrier);
  const parameterCarriers = selectedCarrier?.kind === "function-pointer"
    ? selectedCarrier.args
    : closure?.parameters ?? callable?.parameters;
  const returnCarrier = selectedCarrier?.kind === "function-pointer"
    ? selectedCarrier.result
    : closure?.result ?? callable?.result;
  const parameters = ast.parameters(expression);
  if (selectedCarrier === undefined || parameterCarriers === undefined ||
    returnCarrier === undefined || parameters.length !== parameterCarriers.length) {
    return;
  }
  const parameterAbis: import("../../policy/ownership/source-callable-abi.js").RustSourceParameterAbi[] = [];
  for (const [index, parameter] of parameters.entries()) {
    const sourceParameterCarrier = parameterCarriers[index];
    if (parameter === undefined || sourceParameterCarrier === undefined) {
      return;
    }
    const parameterCarrier = Node_Initializer(ast, parameter) === undefined
      ? sourceParameterCarrier
      : rustOptionTargetType(sourceParameterCarrier);
    const parameterAbi = resolveRustContextualParameterAbi(
      parameter,
      parameterCarrier,
      rustResolutionContext(walk, parameter),
      walk.operationOptions,
    );
    if (parameterAbi === undefined) {
      return;
    }
    setCarrierFact(walk, parameter, parameterAbi.valueCarrier);
    setParameterAbiFact(walk, parameter, parameterAbi);
    if (!recordDefaultParameterInitializerFacts(walk, parameter, parameterAbi)) {
      return;
    }
    const name = Node_Name(ast, parameter);
    const nameKind = name === undefined ? "" : ast.kindName(name);
    if (name !== undefined && (nameKind === KindArrayBindingPattern || nameKind === KindObjectBindingPattern) &&
      !recordBindingPatternFacts(walk, name, parameterAbi.valueCarrier)) {
      return;
    }
    parameterAbis.push(parameterAbi);
  }
  walk.context.facts.set(expression, rustSourceCallableReturnFactKey, {
    returnCarrier,
  }, [{ message: "rust finalized callable-value return carrier" }]);
  const runtimeParameterCarriers = parameterAbis.map((abi) => abi.parameterCarrier);
  const runtimeCarrier = selectedCarrier.kind === "function-pointer" || selectedCarrier.kind === "closure"
    ? { ...selectedCarrier, args: runtimeParameterCarriers, result: returnCarrier }
    : rustCallableTargetType(runtimeParameterCarriers, returnCarrier);
  setCarrierFact(walk, declaration, runtimeCarrier);
}

interface RustCallableValueSignaturePlan {
  readonly parameters: readonly {
    readonly declaration: Node;
    readonly abi: import("../../policy/ownership/source-callable-abi.js").RustSourceParameterAbi;
  }[];
  readonly returnCarrier: TargetTypeRef;
}

function resolveAuthoredCallableValueSignature(
  walk: RustFactWalk,
  expression: Node,
): RustCallableValueSignaturePlan | undefined {
  const { ast } = walk.context;
  if (ast.hasModifierKind(expression, "async") ||
    walk.context.semanticsFor(expression).getResolvedGeneratorInfo(expression) !== undefined) {
    return undefined;
  }
  const parameters = ast.parameters(expression);
  if (!isDenseDataArray(parameters) || parameters.some((parameter) => parameter === undefined)) {
    return undefined;
  }
  const parameterAbis = (parameters as readonly Node[]).map((parameter) =>
    resolveParameterAbi(walk, parameter));
  const sourceReturn = selectedSourceCallableReturn(walk, expression);
  const returnCarrier = resolveRustTargetTypeRef(
    Node_Type(ast, expression) ?? sourceReturn,
    rustResolutionContext(walk, expression),
    walk.operationOptions,
  );
  if (returnCarrier === undefined || parameterAbis.some((abi) => abi === undefined)) {
    return undefined;
  }
  return {
    parameters: (parameters as readonly Node[]).map((declaration, index) => ({
      declaration,
      abi: parameterAbis[index]!,
    })),
    returnCarrier,
  };
}

function recordCallableValueSignaturePlan(
  walk: RustFactWalk,
  expression: Node,
  signature: RustCallableValueSignaturePlan,
): void {
  for (const { declaration: parameter, abi } of signature.parameters) {
    setCarrierFact(walk, parameter, abi.valueCarrier);
    setParameterAbiFact(walk, parameter, abi);
    if (!recordDefaultParameterInitializerFacts(walk, parameter, abi)) {
      return;
    }
  }
  walk.context.facts.set(expression, rustSourceCallableReturnFactKey, {
    returnCarrier: signature.returnCarrier,
  }, [{ message: "rust finalized authored callable-value return carrier" }]);
}

export function recordCallableSuspensionFacts(walk: RustFactWalk, declaration: Node): void {
  const { ast } = walk.context;
  const sourceReturn = selectedSourceCallableReturn(walk, declaration);
  const sourceGenerator = walk.context.semanticsFor(declaration).getResolvedGeneratorInfo(declaration);
  if (sourceGenerator !== undefined) {
    const carrier = resolveRustTargetTypeRef(
      Node_Type(ast, declaration) ?? sourceGenerator.sourceReturnType ?? sourceReturn,
      rustResolutionContext(walk, declaration),
      walk.operationOptions,
    );
    const protocol = getRustGeneratorProtocol(carrier);
    if (carrier === undefined || protocol?.kind !== sourceGenerator.generatorKind) {
      appendRustDiagnostic(
        walk,
        "RUST_GENERATOR_PROTOCOL_NOT_CLOSED",
        "The checked generator declaration has no closed Rust yield, return, and next protocol.",
        declaration,
        ["target.capability=rust.generator.protocol"],
      );
    } else {
      walk.context.facts.set(declaration, rustGeneratorFactKey, {
        kind: protocol.kind,
        carrier,
        yieldType: protocol.yieldType,
        returnType: protocol.returnType,
        nextType: protocol.nextType,
      }, [{ message: "rust generator protocol" }]);
      const typeNode = Node_Type(ast, declaration);
      if (typeNode !== undefined) {
        setCarrierFact(walk, typeNode, carrier);
      }
    }
  } else if (ast.hasModifierKind(declaration, "async")) {
    const inner = promiseInnerCarrier(
      walk,
      declaration,
      Node_Type(walk.context.ast, declaration) ?? sourceReturn,
    );
    if (inner !== undefined) {
      walk.context.facts.set(declaration, rustAsyncFunctionFactKey, { isAsync: true, outputCarrier: inner }, [
        { message: "rust async function" },
      ]);
    }
  }
}

function selectedSourceCallableReturn(walk: RustFactWalk, declaration: Node) {
  const semantics = walk.context.semanticsFor(declaration);
  const callableType = semantics.getDeclaredValueType(declaration);
  if (callableType === undefined) {
    return undefined;
  }
  const signatures = semantics.getCallSignaturesOfType(callableType).filter((signature) =>
    semantics.getSignatureDeclaration(signature) === declaration);
  return signatures.length === 1
    ? semantics.getReturnTypeOfSignature(signatures[0]!)
    : undefined;
}

export function recordCallableReturnFact(walk: RustFactWalk, declaration: Node): void {
  const generator = walk.context.facts.get(declaration, rustGeneratorFactKey);
  const asynchronous = walk.context.facts.get(declaration, rustAsyncFunctionFactKey);
  const sourceReturn = selectedSourceCallableReturn(walk, declaration);
  const carrier = generator?.carrier ?? asynchronous?.outputCarrier ??
    resolveRustTargetTypeRef(
      Node_Type(walk.context.ast, declaration) ?? sourceReturn,
      rustResolutionContext(walk, declaration),
      walk.operationOptions,
    );
  if (carrier !== undefined) {
    walk.context.facts.set(declaration, rustSourceCallableReturnFactKey, {
      returnCarrier: carrier,
    }, [{ message: "rust finalized source callable return carrier" }]);
  }
}
