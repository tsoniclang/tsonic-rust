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
  sourceNodeIdentity,
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
  rustFutureTargetType,
  rustAsyncCallableTargetType,
  getRustGeneratorProtocol,
  rustOptionTargetType,
  rustCallableProtocol,
  rustClosureProtocol,
  rustCallableTargetType,
  rustCallableTargetTypeWithSignature,
  rustInferredLifetime,
} from "../../target-model/types/index.js";
import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { recordBindingPatternFacts, recordDefaultParameterInitializerFacts, recordResolvedParameterAbiFacts, resolveParameterAbi, setParameterAbiFact } from "../declarations/types-and-bindings.js";
import { requireDenseSourceNodes } from "../expressions/records.js";
import {
  resolveRustContextualParameterAbi,
  rustSourceOwnershipContractForType,
} from "../../policy/ownership/source-callable-abi.js";
import { resolveRustCallableLifetimeElision } from "../../policy/ownership/lifetime-elision.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { rustRuntimeCarrierKey } from "../../target-model/facts/selections.js";
import { setCarrierFact } from "../operations/project-calls.js";
import type { ExtensionFactSubject, Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustLifetimeRef } from "../../target-model/semantics/index.js";

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

export function recordCallableTypeSignatureFacts(
  walk: RustFactWalk,
  declaration: Node,
  options: {
    readonly recordReturn?: boolean;
    readonly returnCarrier?: TargetTypeRef;
    readonly receiverLifetime?: RustLifetimeRef;
  } = {},
): void {
  const parameters = requireDenseSourceNodes(walk, walk.context.ast.parameters(declaration), "Function declaration contains an undefined or non-data parameter slot.");
  if (parameters === undefined) {
    return;
  }
  const parameterAbis = parameters.map((parameter) => resolveParameterAbi(walk, parameter));
  for (const [index, parameter] of parameters.entries()) {
    if (parameterAbis[index] !== undefined) continue;
    appendRustDiagnostic(
      walk,
      "RUST_PARAMETER_CARRIER_UNSUPPORTED",
      "Parameter type has no closed Rust runtime carrier under the selected source-profile and surface policy.",
      parameter,
      ["target.capability=rust.callable.parameter-carrier"],
    );
  }
  if (parameterAbis.some((abi) => abi === undefined)) {
    return;
  }
  const closedParameterAbis = parameterAbis as import("../../policy/ownership/source-callable-abi.js").RustSourceParameterAbi[];
  const returnPlan = options.recordReturn === false
    ? undefined
    : resolveCallableReturnPlan(walk, declaration, options.returnCarrier);
  if (options.recordReturn !== false && returnPlan === undefined) {
    return;
  }
  const explicitReceiverLifetime = sourceThisParameterLifetime(
    walk,
    parameters,
    closedParameterAbis,
  );
  const elision = returnPlan === undefined
    ? undefined
    : resolveRustCallableLifetimeElision({
        parameters: closedParameterAbis.map((abi) => abi.parameterCarrier),
        result: returnPlan.returnCarrier,
        ...((options.receiverLifetime ?? explicitReceiverLifetime) === undefined
          ? {}
          : { receiverLifetime: options.receiverLifetime ?? explicitReceiverLifetime }),
      });
  if (elision?.kind === "rejected") {
    appendRustDiagnostic(
      walk,
      "RUST_CALLABLE_RETURN_LIFETIME_ELISION_AMBIGUOUS",
      elision.reason === "no-input-lifetime"
        ? "An elided Rust return reference has no input lifetime to which it can be tied."
        : "An elided Rust return reference has more than one possible input lifetime.",
      Node_Type(walk.context.ast, declaration) ?? declaration,
      ["target.capability=rust.lifetime-elision"],
    );
    return;
  }
  for (const [index, parameter] of parameters.entries()) {
    recordResolvedParameterAbiFacts(walk, parameter, closedParameterAbis[index]!);
  }
  if (returnPlan !== undefined && elision?.kind === "resolved") {
    walk.context.facts.set(declaration, rustSourceCallableReturnFactKey, {
      returnCarrier: elision.result,
      sourceContract: returnPlan.sourceContract,
    }, [{ message: "rust finalized source callable return carrier" }]);
  }
}

export function rustImplicitCallableReceiverLifetime(
  walk: RustFactWalk,
  declaration: Node,
): RustLifetimeRef | undefined {
  const occurrence = sourceNodeIdentity(walk.context.ast, declaration);
  if (occurrence === undefined) {
    appendRustDiagnostic(
      walk,
      "RUST_CALLABLE_RECEIVER_IDENTITY_NOT_PROVEN",
      "An implicit Rust callable receiver lifetime requires one exact compiler-owned source declaration identity.",
      declaration,
      ["target.capability=rust.callable.receiver-lifetime"],
    );
    return undefined;
  }
  return rustInferredLifetime(`source-method-receiver\0${occurrence}`);
}

function sourceThisParameterLifetime(
  walk: RustFactWalk,
  parameters: readonly Node[],
  abis: readonly import("../../policy/ownership/source-callable-abi.js").RustSourceParameterAbi[],
): RustLifetimeRef | undefined {
  const index = parameters.findIndex((parameter) => {
    const name = Node_Name(walk.context.ast, parameter);
    return name !== undefined && walk.context.ast.kindName(name) === "KindIdentifier" &&
      walk.context.ast.text(name) === "this";
  });
  const carrier = index < 0 ? undefined : abis[index]?.parameterCarrier;
  return carrier?.kind === "reference" ? carrier.lifetime : undefined;
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
        ? walk.context.names.nameForDeclaration(declaration)
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
  const resultCarrier = walk.context.facts.get(
    callableDeclaration,
    rustSourceCallableReturnFactKey,
  )?.returnCarrier ?? walk.context.facts.resolve(
    callableDeclaration,
    rustSourceCallableReturnFactKey,
  )?.returnCarrier;
  if (valueName === undefined || resultCarrier === undefined ||
    parameterAbis.some((abi) => abi === undefined)) {
    return undefined;
  }
  const closed = parameterAbis as import("../facts/keys.js").RustSourceParameterAbiFact[];
  const asynchronous = walk.context.facts.get(callableDeclaration, rustAsyncFunctionFactKey) ??
    walk.context.facts.resolve(callableDeclaration, rustAsyncFunctionFactKey);
  const callableResultCarrier = asynchronous === undefined
    ? resultCarrier
    : rustFutureTargetType(resultCarrier);
  return {
    name: valueName,
    carrier: asynchronous === undefined
      ? rustCallableTargetType(closed.map((abi) => abi.parameterCarrier), resultCarrier)
      : rustAsyncCallableTargetType(closed.map((abi) => abi.parameterCarrier), resultCarrier),
    parameterCarriers: closed.map((abi) => abi.parameterCarrier),
    argumentModes: closed.map((abi) => abi.mode),
    resultCarrier: callableResultCarrier,
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
  if (nativeCallable?.callableDeclaration === expression) {
    const nativeSignature = resolveAuthoredCallableValueSignature(walk, expression);
    if (nativeSignature !== undefined) {
      recordCallableValueSignaturePlan(walk, expression, nativeSignature);
      const carrier = nativeSignature.asynchronous
        ? rustAsyncCallableTargetType(
            nativeSignature.parameters.map(({ abi }) => abi.parameterCarrier),
            nativeSignature.bodyReturnCarrier,
          )
        : rustCallableTargetType(
            nativeSignature.parameters.map(({ abi }) => abi.parameterCarrier),
            nativeSignature.bodyReturnCarrier,
          );
      setCarrierFact(walk, declaration, carrier);
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
    ? selectedCarrier.parameters
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
  const bodyReturnCarrier = callable?.asynchronous
    ? rustFutureOutputCarrier(returnCarrier)
    : returnCarrier;
  if (bodyReturnCarrier === undefined) return;
  walk.context.facts.set(expression, rustSourceCallableReturnFactKey, {
    returnCarrier: bodyReturnCarrier,
    sourceContract: rustSourceOwnershipContractForType(
      Node_Type(ast, expression),
      rustResolutionContext(walk, expression),
    ),
  }, [{ message: "rust finalized callable-value return carrier" }]);
  const runtimeParameterCarriers = parameterAbis.map((abi) => abi.parameterCarrier);
  const runtimeCarrier = rustCallableTargetTypeWithSignature(
    selectedCarrier,
    runtimeParameterCarriers,
    returnCarrier,
  );
  if (runtimeCarrier === undefined) return;
  setCarrierFact(walk, declaration, runtimeCarrier);
}

interface RustCallableValueSignaturePlan {
  readonly parameters: readonly {
    readonly declaration: Node;
    readonly abi: import("../../policy/ownership/source-callable-abi.js").RustSourceParameterAbi;
  }[];
  readonly asynchronous: boolean;
  readonly bodyReturnCarrier: TargetTypeRef;
}

function resolveAuthoredCallableValueSignature(
  walk: RustFactWalk,
  expression: Node,
): RustCallableValueSignaturePlan | undefined {
  const { ast } = walk.context;
  if (walk.context.semanticsFor(expression).operations.generator(expression) !== undefined) {
    return undefined;
  }
  const parameters = ast.parameters(expression);
  if (!isDenseDataArray(parameters) || parameters.some((parameter) => parameter === undefined)) {
    return undefined;
  }
  const parameterAbis = (parameters as readonly Node[]).map((parameter) =>
    resolveParameterAbi(walk, parameter));
  const sourceReturn = selectedSourceCallableReturn(walk, expression);
  const declaredReturnCarrier = resolveRustTargetTypeRef(
    Node_Type(ast, expression) ?? sourceReturn,
    rustResolutionContext(walk, expression),
    walk.operationOptions,
  );
  const asynchronous = ast.hasModifierKind(expression, "async");
  const bodyReturnCarrier = asynchronous
    ? rustFutureOutputCarrier(declaredReturnCarrier)
    : declaredReturnCarrier;
  if (declaredReturnCarrier === undefined || bodyReturnCarrier === undefined ||
    parameterAbis.some((abi) => abi === undefined)) {
    return undefined;
  }
  const closedParameterAbis = parameterAbis as import("../../policy/ownership/source-callable-abi.js").RustSourceParameterAbi[];
  const elision = resolveRustCallableLifetimeElision({
    parameters: closedParameterAbis.map((abi) => abi.parameterCarrier),
    result: bodyReturnCarrier,
    ...(sourceThisParameterLifetime(
      walk,
      parameters as readonly Node[],
      closedParameterAbis,
    ) === undefined
      ? {}
      : {
          receiverLifetime: sourceThisParameterLifetime(
            walk,
            parameters as readonly Node[],
            closedParameterAbis,
          ),
        }),
  });
  if (elision.kind === "rejected") {
    appendRustDiagnostic(
      walk,
      "RUST_CALLABLE_RETURN_LIFETIME_ELISION_AMBIGUOUS",
      elision.reason === "no-input-lifetime"
        ? "An elided Rust return reference has no input lifetime to which it can be tied."
        : "An elided Rust return reference has more than one possible input lifetime.",
      Node_Type(ast, expression) ?? expression,
      ["target.capability=rust.lifetime-elision"],
    );
    return undefined;
  }
  return {
    asynchronous,
    parameters: (parameters as readonly Node[]).map((declaration, index) => ({
      declaration,
      abi: closedParameterAbis[index]!,
    })),
    bodyReturnCarrier: elision.result,
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
    returnCarrier: signature.bodyReturnCarrier,
    sourceContract: rustSourceOwnershipContractForType(
      Node_Type(walk.context.ast, expression),
      rustResolutionContext(walk, expression),
    ),
  }, [{ message: "rust finalized authored callable-value return carrier" }]);
}

export function recordCallableSuspensionFacts(walk: RustFactWalk, declaration: Node): void {
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
  const callableType = semantics.declarations.declaredValueType(declaration);
  if (callableType === undefined) {
    return undefined;
  }
  const signatures = semantics.types.callSignatures(callableType).filter((signature) =>
    semantics.declarations.signatureDeclaration(signature) === declaration);
  return signatures.length === 1
    ? semantics.types.returnType(signatures[0]!)
    : undefined;
}

function resolveCallableReturnPlan(
  walk: RustFactWalk,
  declaration: Node,
  override: TargetTypeRef | undefined,
): {
  readonly returnCarrier: TargetTypeRef;
  readonly sourceContract: import("../../target-model/operations/model.js").RustSourceParameterContract;
} | undefined {
  const generator = walk.context.facts.get(declaration, rustGeneratorFactKey);
  const asynchronous = walk.context.facts.get(declaration, rustAsyncFunctionFactKey);
  const sourceReturn = selectedSourceCallableReturn(walk, declaration);
  const carrier = override ?? generator?.carrier ?? asynchronous?.outputCarrier ??
    resolveRustTargetTypeRef(
      Node_Type(walk.context.ast, declaration) ?? sourceReturn,
      rustResolutionContext(walk, declaration),
      walk.operationOptions,
    );
  return carrier === undefined
    ? undefined
    : {
        returnCarrier: carrier,
        sourceContract: rustSourceOwnershipContractForType(
          Node_Type(walk.context.ast, declaration),
          rustResolutionContext(walk, declaration),
        ),
      };
}
