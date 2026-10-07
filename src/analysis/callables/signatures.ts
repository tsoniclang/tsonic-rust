import { rustTypeParameterFromSourceContract } from "../../target-model/names/type-parameters.js";
import { rustCallableInvocationResult } from "../facts/callable-results.js";
import { rustUnionPayloadAdmission } from "../../target-model/conversions/union-injection.js";
import { rustAbsenceTargetType } from "../../target-model/types/carriers/native.js";
import {
  KindFunctionExpression,
  KindFunctionDeclaration,
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
  sourceDeclarationIsModuleScoped,
} from "@tsonic/target-api/source";
import {
  rustAsyncFunctionFactKey,
  rustGeneratorFactKey,
  rustModuleBindingFactKey,
  rustSourceCallableReturnFactKey,
  rustSourceParameterAbiFactKey,
} from "../facts/keys.js";
import {
  isRustUnitCarrier,
  isRustNeverCarrier,
  rustOptionElementCarrier,
  getRustGeneratorProtocol,
  rustSourceOptionalTargetType,
  rustCallableProtocol,
  rustClosureProtocol,
  rustCallableTargetType,
  rustGeneratorStorageTargetType,
} from "../../target-model/types/index.js";
import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { recordBindingPatternFacts, recordParameterAbiFacts, setParameterAbiFact } from "../declarations/types-and-bindings.js";
import { requireDenseSourceNodes } from "../expressions/records.js";
import { resolveRustContextualParameterAbi } from "../../policy/ownership/source-callable-abi.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { rustRuntimeCarrierKey } from "../../target-model/facts/selections.js";
import { setCarrierFact } from "../operations/project-calls.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { resolveRustSuspendedCallableStorage } from "./suspension-storage.js";
import { rustHigherRankedNativeFunctionCarrier } from "./higher-ranked-function.js";
import { selectRustPointerReturnContract } from "../../policy/operations/pointers/return.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustGenericCallableProtocol } from "../../target-model/types/carriers/generic-callables.js";
import { rustGenericCallableValueOwner } from "../../policy/types/callable-origins.js";
import { rebindRustCallableCarrier } from "../../target-model/types/carriers/callable-rebinding.js";
import { closeRustSuspendedStorage } from "../../policy/types/suspended-storage.js";
import { selectRustInferredReturn } from "./inferred-return.js";
import { rustOptionalStorageValue } from "../../target-model/types/projections.js";
import { selectRustClosedCallableInputs } from "./contextual-inputs.js";
import { recordRustAsyncBodyFacts } from "./async-results.js";

export function recordFunctionSignatureFacts(walk: RustFactWalk, declaration: Node): void {
  recordCallableParameterSignatureFacts(walk, declaration);
  recordCallableSuspensionFacts(walk, declaration);
  recordCallableReturnFact(walk, declaration);
}

function recordCallableTypeSignatureFacts(walk: RustFactWalk, declaration: Node): void {
  recordCallableParameterSignatureFacts(walk, declaration);
  recordCallableReturnFact(walk, declaration);
}

function recordCallableParameterSignatureFacts(walk: RustFactWalk, declaration: Node): void {
  const parameters = requireDenseSourceNodes(walk, walk.context.ast.parameters(declaration), "Function declaration contains an undefined or non-data parameter slot.");
  if (parameters === undefined) {
    return;
  }
  const signature = walk.context.ast.is.IsArrowFunction(declaration) || walk.context.ast.is.IsFunctionExpression(declaration)
    ? resolveRustTargetTypeRef(declaration,
        { ...rustResolutionContext(walk, declaration), callableRepresentation: "signature" }, walk.operationOptions)
    : undefined;
  const contextual = selectRustClosedCallableInputs(walk, declaration, signature);
  const logical = rustCallableProtocol(signature) ?? rustClosureProtocol(signature);
  const protocol = rustCallableProtocol(contextual) ?? rustClosureProtocol(contextual);
  for (const [index, parameter] of parameters.entries()) {
    const input = protocol?.parameters[index];
    const selected = rustTargetTypeRefEquals(input, logical?.parameters[index]) ? undefined : input;
    recordParameterAbiFacts(walk, parameter, selected === undefined || Node_Initializer(walk.context.ast, parameter) === undefined
      ? selected : rustSourceOptionalTargetType(selected));
  }
}

import { rustCompileTimeSourceKey } from "../../target-model/facts/source-declarations.js";

export function recordNestedCallableTypeSignatureFacts(walk: RustFactWalk, sourceFile: SourceFile): void {
  const { ast } = walk.context;
  const visit = (node: Node | undefined): void => {
    if (node === undefined) {
      return;
    }
    if (walk.context.facts.get(node, rustCompileTimeSourceKey)) return;
    const kind = ast.kindName(node);
    if (kind === "KindFunctionType" || kind === "KindCallSignature") {
      recordCallableTypeSignatureFacts(walk, node);
    } else if (kind === KindFunctionDeclaration && !sourceDeclarationIsModuleScoped(node, ast)) {
      recordFunctionSignatureFacts(walk, node);
    }
    ast.forEachChild(node, visit);
  };
  visit(sourceFile);
}

export function recordTopLevelCallableValueSignatureFacts(
  walk: RustFactWalk,
  sourceFile: SourceFile,
): void {
  const statements = requireDenseSourceNodes(
    walk,
    walk.context.ast.statements(sourceFile),
    "Source file contains an undefined or non-data top-level statement slot.",
  );
  if (statements !== undefined) {
    recordCallableValueSignaturesForStatements(walk, statements);
  }
}

export function recordPredeclaredNativeFunctionBindingFacts(
  walk: RustFactWalk,
  sourceFile: SourceFile,
): void {
  const { ast } = walk.context;
  const statements = requireDenseSourceNodes(
    walk,
    ast.statements(sourceFile),
    "Source file contains an undefined or non-data top-level statement slot.",
  );
  if (statements === undefined) {
    return;
  }
  for (const statement of statements) {
    if (ast.kindName(statement) === KindFunctionDeclaration) {
      const valueName = walk.context.names.callableValueNameForDeclaration(statement);
      const implementationName = walk.context.names.functionNameForDeclaration(statement);
      const value = finalizedNativeCallableValue(walk, statement, valueName);
      if (valueName !== undefined && implementationName !== undefined && value !== undefined) {
        setCarrierFact(walk, statement, value.carrier);
        walk.context.facts.set(statement, rustModuleBindingFactKey, {
          declarationKind: "function",
          storage: "native-callable",
          callableDeclaration: statement,
          name: implementationName,
          value,
        }, [{ message: "rust finalized hoisted module callable value" }]);
      }
      continue;
    }
    if (ast.kindName(statement) !== KindVariableStatement) {
      continue;
    }
    const declarations = requireDenseSourceNodes(
      walk,
      VariableDeclarationList_Declarations(
        ast,
        VariableStatement_DeclarationList(ast, statement),
      ),
      "Variable statement contains an undefined or non-data declaration slot.",
    );
    if (declarations === undefined || declarations.length === 0) {
      return;
    }
    for (const declaration of declarations) {
      if (ast.kindName(declaration) !== KindVariableDeclaration ||
        ast.variableDeclarationKind(declaration) !== "const") {
        continue;
      }
      const candidate = walk.moduleBindings.nativeCallable(declaration);
      if (candidate === undefined || !nativeModuleFunctionAbiIsFinalized(
        walk,
        candidate.callableDeclaration,
      )) {
        continue;
      }
      const valueName = candidate.valueObserved
        ? walk.context.names.callableValueNameForDeclaration(declaration)
        : undefined;
      const value = finalizedNativeCallableValue(
        walk,
        candidate.callableDeclaration,
        valueName,
      );
      if (candidate.valueObserved && value === undefined) {
        continue;
      }
      if (value !== undefined) {
        setCarrierFact(walk, declaration, value.carrier);
      }
      walk.context.facts.set(declaration, rustModuleBindingFactKey, {
        declarationKind: "const",
        storage: "native-callable",
        callableDeclaration: candidate.callableDeclaration,
        name: candidate.name,
        ...(value !== undefined
          ? { value }
          : {}),
      }, [
        { message: "rust finalized native module callable storage" },
      ]);
    }
  }
}

function finalizedNativeCallableValue(
  walk: RustFactWalk,
  callableDeclaration: Node,
  valueName: string | undefined,
): Extract<
  import("../facts/keys.js").RustModuleBindingFact,
  { readonly storage: "native-callable" }
>["value"] | undefined {
  const parameterAbis = walk.context.ast.parameters(callableDeclaration).map((parameter) =>
    parameter === undefined
      ? undefined
      : walk.context.facts.get(parameter, rustSourceParameterAbiFactKey) ??
        walk.context.facts.resolve(parameter, rustSourceParameterAbiFactKey));
  const resultCarrier = rustCallableInvocationResult(walk.context.facts, callableDeclaration);
  if (valueName === undefined || resultCarrier === undefined ||
    parameterAbis.some((abi) => abi === undefined)) {
    return undefined;
  }
  const closed = parameterAbis as import("../facts/keys.js").RustSourceParameterAbiFact[];
  const higherRankedCarrier = rustHigherRankedNativeFunctionCarrier(
    walk,
    callableDeclaration,
    closed,
    resultCarrier,
  );
  return {
    name: valueName,
    carrier: higherRankedCarrier ?? rustCallableTargetType(
      closed.map((abi) => abi.parameterCarrier),
      resultCarrier,
    ),
    parameterCarriers: closed.map((abi) => abi.parameterCarrier),
    resultCarrier,
  };
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
  const nativeCallable = walk.moduleBindings.nativeCallable(declaration);
  if (nativeCallable?.callableDeclaration === expression && Node_Type(ast, declaration) === undefined) {
    recordFunctionSignatureFacts(walk, expression);
    return;
  }
  const valueCarrier = rustGenericCallableValueOwner(ast, declaration, walk.context.facts.get(declaration, rustRuntimeCarrierKey)?.carrier ??
    walk.context.facts.resolve(declaration, rustRuntimeCarrierKey)?.carrier ??
    resolveRustTargetTypeRef(
      Node_Type(ast, declaration) ?? expression,
      rustResolutionContext(walk, declaration),
      walk.operationOptions,
    ));
  const selectedCarrier = selectRustClosedCallableInputs(walk, expression, valueCarrier);
  const ownParameters = walk.context.sourceLifetimes.contractFor(expression)?.parameters
    .flatMap(parameter => parameter.kind === "type" ? [rustTypeParameterFromSourceContract(parameter)] : []);
  const callable = rustGenericCallableProtocol(selectedCarrier, ownParameters) ?? rustCallableProtocol(selectedCarrier);
  const closure = rustClosureProtocol(selectedCarrier);
  const parameterCarriers = selectedCarrier?.kind === "function-pointer"
    ? selectedCarrier.args
    : closure?.parameters ?? callable?.parameters;
  const selectedReturnCarrier = selectedCarrier?.kind === "function-pointer"
    ? selectedCarrier.result
    : closure?.result ?? callable?.result;
  const returnCarrier = Node_Type(ast, declaration) === undefined && !ast.hasModifierKind(expression, "async")
    ? selectRustInferredReturn(walk, expression, selectedReturnCarrier)
    : selectedReturnCarrier;
  const parameters = ast.parameters(expression);
  if (selectedCarrier === undefined || parameterCarriers === undefined ||
    returnCarrier === undefined || parameters.length > parameterCarriers.length) {
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
      : rustSourceOptionalTargetType(sourceParameterCarrier);
    const contextualAbi = resolveRustContextualParameterAbi(
      parameter,
      parameterCarrier,
      rustResolutionContext(walk, parameter),
      walk.operationOptions,
    );
    const parameterAbi = contextualAbi === undefined ? undefined
      : nativeCallable?.callableDeclaration === expression
        ? walk.sourceCallableAbi.resolveParameterAbi(
            parameter, rustResolutionContext(walk, parameter), walk.operationOptions,
            contextualAbi.valueCarrier,
          )
        : contextualAbi;
    if (parameterAbi === undefined) {
      return;
    }
    setCarrierFact(walk, parameter, parameterAbi.valueCarrier);
    setParameterAbiFact(walk, parameter, parameterAbi);
    const name = Node_Name(ast, parameter);
    const nameKind = name === undefined ? "" : ast.kindName(name);
    if (name !== undefined && (nameKind === KindArrayBindingPattern || nameKind === KindObjectBindingPattern) &&
      !recordBindingPatternFacts(walk, name, parameterAbi.valueCarrier)) {
      return;
    }
    parameterAbis.push(parameterAbi);
  }
  recordCallableSuspensionFacts(walk, expression, undefined, selectedReturnCarrier);
  if (!recordCallableReturnFact(walk, expression,
    walk.context.facts.get(expression, rustAsyncFunctionFactKey)?.outputCarrier ??
      walk.context.facts.get(expression, rustGeneratorFactKey)?.resultCarrier ?? returnCarrier)) {
    return;
  }
  if (nativeCallable?.callableDeclaration === expression) return;
  const runtimeParameterCarriers = [
    ...parameterAbis.map((abi) => abi.parameterCarrier),
    ...parameterCarriers.slice(parameters.length),
  ];
  const valueReturnCarrier = selectedCallableValueReturn(walk, expression, returnCarrier);
  const runtimeCarrier = rebindRustCallableCarrier(selectedCarrier, runtimeParameterCarriers, valueReturnCarrier,
    { typeParameters: ownParameters ?? [] });
  if (runtimeCarrier !== undefined) setCarrierFact(walk, declaration, runtimeCarrier);
}

function selectedCallableValueReturn(
  walk: RustFactWalk,
  declaration: Node,
  synchronousReturn: TargetTypeRef,
): TargetTypeRef {
  return rustCallableInvocationResult(walk.context.facts, declaration) ?? synchronousReturn;
}

export function recordCallableSuspensionFacts(
  walk: RustFactWalk, declaration: Node, ownedReceiver?: TargetTypeRef, contextualResult?: TargetTypeRef,
): void {
  const { ast } = walk.context;
  const sourceReturn = selectedSourceCallableReturn(walk, declaration);
  const sourceGenerator = walk.context.semanticsFor(declaration).operations.generator(declaration);
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
      const storage = resolveRustSuspendedCallableStorage(walk, declaration, [
        protocol.yieldType,
        protocol.returnType,
        protocol.nextType,
      ], ownedReceiver);
      if (storage.kind === "rejected") {
        appendRustDiagnostic(
          walk,
          "RUST_GENERATOR_STORAGE_LIFETIME_NOT_PROVEN",
          storage.reason,
          declaration,
          ["target.capability=rust.generator.storage-lifetime"],
        );
        return;
      }
      walk.context.facts.set(declaration, rustGeneratorFactKey, {
        kind: protocol.kind,
        resultCarrier: rustGeneratorStorageTargetType(
          protocol,
          storage.storage.kind === "static"
            ? undefined
            : storage.storage.kind === "receiver"
              ? { kind: "placeholder" }
              : storage.storage.lifetime,
        ),
        yieldType: protocol.yieldType,
        returnType: protocol.returnType,
        nextType: protocol.nextType,
        capturedParameters: storage.capturedParameters,
        storage: storage.storage,
        ...(storage.ownedReceiver === undefined ? {} : { ownedReceiver: storage.ownedReceiver }),
      }, [{ message: "rust generator protocol" }]);
      const typeNode = Node_Type(ast, declaration);
      if (typeNode !== undefined) {
        setCarrierFact(walk, typeNode, carrier);
      }
    }
  } else if (ast.hasModifierKind(declaration, "async")) {
    const futureCarrier = resolveRustTargetTypeRef(
      Node_Type(walk.context.ast, declaration) ?? sourceReturn,
      rustResolutionContext(walk, declaration),
      walk.operationOptions,
    );
    recordRustAsyncBodyFacts(walk, declaration, futureCarrier, ownedReceiver, contextualResult);
  }
}

export function selectedSourceCallableReturn(walk: RustFactWalk, declaration: Node) {
  const semantics = walk.context.semanticsFor(declaration);
  const callableType = walk.context.ast.is.IsArrowFunction(declaration) || walk.context.ast.is.IsFunctionExpression(declaration)
    ? semantics.types.expressionType(declaration)
    : semantics.declarations.declaredValueType(declaration);
  if (callableType === undefined) {
    return undefined;
  }
  const signatures = semantics.types.signatureInfos(callableType, "call").filter((signature) =>
    semantics.declarations.signatureDeclaration(signature.signature) === declaration);
  return signatures.length === 1
    ? signatures[0]!.returnType
    : undefined;
}

export function recordCallableReturnFact(
  walk: RustFactWalk,
  declaration: Node,
  selectedCarrier?: TargetTypeRef,
): boolean {
  const generator = walk.context.facts.get(declaration, rustGeneratorFactKey);
  const asynchronous = walk.context.facts.get(declaration, rustAsyncFunctionFactKey);
  const sourceReturn = selectedSourceCallableReturn(walk, declaration);
  const baseline = selectedCarrier ?? generator?.resultCarrier ?? asynchronous?.outputCarrier ??
    resolveRustTargetTypeRef(
      Node_Type(walk.context.ast, declaration) ?? sourceReturn,
      rustResolutionContext(walk, declaration),
      walk.operationOptions,
    );
  const selected = selectedCarrier !== undefined || generator !== undefined || asynchronous !== undefined
    ? baseline : selectRustInferredReturn(walk, declaration, baseline);
  const pointer = selectRustPointerReturnContract(declaration, rustResolutionContext(walk, declaration), walk.operationOptions);
  if (selectedCarrier !== undefined && pointer !== undefined &&
    !rustTargetTypeRefEquals(selectedCarrier, pointer.returnCarrier)) {
    return false;
  }
  const rawCarrier = pointer?.returnCarrier ?? rustGenericCallableValueOwner(walk.context.ast, declaration, selected);
  const parameterCarriers = walk.context.ast.parameters(declaration).map(parameter =>
    parameter === undefined ? undefined : walk.context.facts.get(parameter, rustSourceParameterAbiFactKey)?.parameterCarrier);
  const carrier = rawCarrier === undefined ? undefined : asynchronous !== undefined || generator !== undefined
    ? rawCarrier : closeRustSuspendedStorage(rawCarrier, parameterCarriers,
      walk.context.sourceLifetimes.contractFor(declaration), "callable-result");
  if (carrier !== undefined) {
    const completion = walk.context.semanticsFor(declaration).operations.callableCompletion(declaration);
    const absence = rustOptionElementCarrier(carrier) !== undefined || rustOptionalStorageValue(carrier) !== undefined ||
      rustUnionPayloadAdmission(rustAbsenceTargetType(), carrier, walk.context.typeDefinitions) !== undefined;
    const implementationResult = asynchronous !== undefined || generator !== undefined || sourceReturn === undefined
      ? undefined : resolveRustTargetTypeRef(sourceReturn, rustResolutionContext(walk, declaration), walk.operationOptions);
    walk.context.facts.set(declaration, rustSourceCallableReturnFactKey, {
      returnCarrier: carrier,
      ...(isRustUnitCarrier(implementationResult) ? { implementationCompletion: "absence" as const }
        : isRustNeverCarrier(implementationResult) ? { implementationCompletion: "diverging" as const } : {}),
      ...(completion === undefined ? {} : { canFallThrough: completion.canFallThrough }),
      ...(absence || pointer?.undefinedReturn ? { undefinedReturn: true } : {}),
      ...(absence && completion?.canFallThrough || pointer?.fallthroughUndefined ? { fallthroughUndefined: true } : {}),
    }, [{ message: "rust finalized source callable return carrier" }]);
    return true;
  }
  return false;
}
