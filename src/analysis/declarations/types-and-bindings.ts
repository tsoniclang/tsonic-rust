import {
  KindCallExpression,
  KindElementAccessExpression,
  KindIdentifier,
  KindArrayBindingPattern,
  KindObjectBindingPattern,
  KindPropertyAccessExpression,
  Node_Expression,
  Node_Initializer,
  Node_Name,
  Node_Type,
  sourceNodeIdentity,
} from "@tsonic/target-api/source";
import {
  rustMutatedBindingFactKey,
  rustMutatedReferentFactKey,
  rustSourceParameterAbiFactKey,
  rustTargetOperationFactKey,
  rustTypeAliasDeclarationFactKey,
} from "../facts/keys.js";
import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";
import { isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { recordRustBindingPatternFacts } from "../control-flow/binding-patterns.js";
import { resolveExpressionCarrier } from "../expressions/carriers.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { rustSourceUnionTargetType } from "../../target-model/types/index.js";
import {
  isRustCopyCarrier,
  rustCarrierSupportsClone,
  rustCarrierSupportsTrait,
  rustDefaultTrait,
  rustInferredLifetime,
  rustReferenceTargetType,
  rustToOwnedTrait,
  rustUnitTargetType,
} from "../../target-model/types/index.js";
import { rustSourceOwnershipOperationFactKey } from "../../source/semantics/facts.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { setCarrierFact, setRustOperationFact } from "../operations/project-calls.js";
import { sourceTypeCarrierForDeclaration } from "../operations/inputs.js";
import type { Node, SourceFile, Type } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { rustSourceOwnershipContractForType } from "../../policy/ownership/source-callable-abi.js";

export function registerTypeAlias(walk: RustFactWalk, declaration: Node): void {
  const variants = walk.sourceTypes.enumVariantsForDeclaration(declaration);
  if (variants !== undefined) {
    const carrier = sourceTypeCarrierForDeclaration(walk, declaration);
    if (carrier === undefined) {
      return;
    }
    setCarrierFact(walk, declaration, carrier);
    walk.context.facts.set(declaration, rustTypeAliasDeclarationFactKey, {
      kind: "string-literal",
      variants,
    }, [{ message: "rust string-literal union declaration" }]);
    return;
  }
  const { ast } = walk.context;
  const nameNode = ast.name(declaration);
  const typeName = nameNode === undefined ? "" : ast.text(nameNode);
  const fileName = ast.getFileName(ast.getSourceFile(declaration));
  const semantics = walk.context.semanticsFor(declaration);
  const sourceType = semantics.declarations.declaredType(declaration);
  if (sourceType === undefined || typeName.length === 0 || fileName.length === 0) {
    return;
  }
  if (!semantics.types.isUnion(sourceType)) {
    const typeNode = Node_Type(ast, declaration);
    const carrier = resolveRustTargetTypeRef(
      typeNode ?? sourceType,
      rustResolutionContext(walk, declaration),
      walk.operationOptions,
    );
    if (carrier === undefined ||
      !walk.sourceTypes.registerRepresentationAlias(declaration, carrier)) {
      return;
    }
    setCarrierFact(walk, declaration, carrier);
    if (typeNode !== undefined) {
      setCarrierFact(walk, typeNode, carrier);
    }
    walk.context.facts.set(declaration, rustTypeAliasDeclarationFactKey, {
      kind: "erased",
    }, [{ message: "rust representation-preserving type alias declaration" }]);
    return;
  }
  const compositeCarrier = resolveRustTargetTypeRef(
    sourceType,
    rustResolutionContext(walk, declaration),
    walk.operationOptions,
  );
  if (compositeCarrier !== undefined) {
    if (!walk.sourceTypes.registerDeclarationCarrier(declaration, compositeCarrier)) {
      return;
    }
    setCarrierFact(walk, declaration, compositeCarrier);
    walk.context.facts.set(declaration, rustTypeAliasDeclarationFactKey, {
      kind: "erased",
    }, [{ message: "rust representation-identical union declaration" }]);
    return;
  }
  const sourceMembers = semantics.types.unionOrIntersectionTypes(sourceType);
  if (!isDenseDataArray(sourceMembers) || sourceMembers.length < 2 ||
    sourceMembers.some((member) => member === undefined)) {
    return;
  }
  const uniqueVariants: {
    readonly sourceType: Type;
    readonly carrier: TargetTypeRef;
  }[] = [];
  for (const member of sourceMembers as readonly Type[]) {
    const carrier = resolveRustTargetTypeRef(
      member,
      rustResolutionContext(walk, declaration),
      walk.operationOptions,
    );
    if (carrier === undefined) {
      return;
    }
    if (!uniqueVariants.some((variant) =>
      rustTargetTypeRefEquals(variant.carrier, carrier))) {
      uniqueVariants.push({ sourceType: member, carrier });
    }
  }
  if (uniqueVariants.length === 1) {
    const carrier = uniqueVariants[0]!.carrier;
    if (!walk.sourceTypes.registerDeclarationCarrier(declaration, carrier)) {
      return;
    }
    setCarrierFact(walk, declaration, carrier);
    walk.context.facts.set(declaration, rustTypeAliasDeclarationFactKey, {
      kind: "erased",
    }, [{ message: "rust representation-identical union declaration" }]);
    return;
  }
  const finalizedVariants = uniqueVariants.map((variant, index) => {
    const shape = walk.sourceTypes.structuralObjectForType(
      variant.sourceType,
      variant.carrier,
    );
    return {
      name: `Variant${index}`,
      sourceType: variant.sourceType,
      carrier: variant.carrier,
      ...(shape === undefined ? {} : { shape }),
    };
  });
  const carrier = rustSourceUnionTargetType(
    fileName,
    typeName,
    finalizedVariants.map((variant) => ({
      name: variant.name,
      carrier: variant.carrier,
    })),
  );
  const variantFieldDeclarations = new Set(finalizedVariants.flatMap((variant) =>
    variant.shape?.fields.flatMap((field) => field.declarations) ?? []));
  const selectedProperties = semantics.types.propertyInfos(sourceType).map((property) => {
    const declarations = semantics.declarations.symbolDeclarations(property.symbol);
    if (!isDenseDataArray(declarations) || declarations.length === 0 ||
      declarations.some((selected) => selected === undefined)) {
      return undefined;
    }
    const selectedDeclarations = declarations as readonly Node[];
    return selectedDeclarations.every((selected) =>
      walk.context.source.navigation.isProjectDeclaration(selected) &&
      variantFieldDeclarations.has(selected))
      ? {
          symbol: property.symbol,
          declarations: Object.freeze([...selectedDeclarations]),
        }
      : undefined;
  });
  if (selectedProperties.some((property) => property === undefined)) {
    return;
  }
  if (!walk.sourceTypes.registerSourceUnion({
    declaration,
    sourceType,
    carrier,
    variants: finalizedVariants,
    selectedProperties: selectedProperties as readonly {
      readonly symbol: import("@tsonic/tsts").Symbol;
      readonly declarations: readonly Node[];
    }[],
  })) {
    return;
  }
  setCarrierFact(walk, declaration, carrier);
  walk.context.facts.set(declaration, rustTypeAliasDeclarationFactKey, {
    kind: "runtime",
    variants: finalizedVariants.map((variant) => ({
      name: variant.name,
      carrier: variant.carrier,
    })),
  }, [{ message: "rust runtime union declaration" }]);
}

export function recordEnumFacts(walk: RustFactWalk, declaration: Node, _sourceFile: SourceFile): void {
  const carrier = sourceTypeCarrierForDeclaration(walk, declaration);
  if (carrier !== undefined) {
    setCarrierFact(walk, declaration, carrier);
  }
}

export function resolveParameterAbi(walk: RustFactWalk, parameter: Node) {
  return walk.sourceCallableAbi.resolveParameterAbi(
    parameter,
    rustResolutionContext(walk, parameter),
    walk.operationOptions,
  );
}

export function recordResolvedParameterAbiFacts(
  walk: RustFactWalk,
  parameter: Node,
  parameterAbi: import("../../policy/ownership/source-callable-abi.js").RustSourceParameterAbi,
): void {
  setCarrierFact(walk, parameter, parameterAbi.valueCarrier);
  setParameterAbiFact(walk, parameter, parameterAbi);
  if (!recordDefaultParameterInitializerFacts(walk, parameter, parameterAbi)) {
    return;
  }
  const name = Node_Name(walk.context.ast, parameter);
  const nameKind = name === undefined ? "" : walk.context.ast.kindName(name);
  if (name !== undefined && (nameKind === KindArrayBindingPattern || nameKind === KindObjectBindingPattern) &&
    !recordBindingPatternFacts(walk, name, parameterAbi.valueCarrier)) {
    appendRustDiagnostic(
      walk,
      "RUST_BINDING_PATTERN_NOT_CLOSED",
      "Parameter binding pattern has no total Rust projection from its exact finalized source carrier.",
      name,
      ["target.capability=rust.binding-pattern.parameter"],
    );
  }
}

export function recordBindingPatternFacts(
  walk: RustFactWalk,
  pattern: Node,
  sourceCarrier: TargetTypeRef,
): boolean {
  return recordRustBindingPatternFacts(pattern, sourceCarrier, {
    ast: walk.context.ast,
    facts: walk.context.facts,
    navigation: walk.context.source.navigation,
    semanticsFor: walk.context.semanticsFor,
    sourceTypes: walk.sourceTypes,
    resolveCarrier: (subject) => resolveRustTargetTypeRef(
      subject,
      rustResolutionContext(walk, subject),
      walk.operationOptions,
    ),
    resolveProjectFieldCarrier: (declaration, receiverCarrier) => {
      const declaredCarrier = resolveRustTargetTypeRef(
        declaration,
        rustResolutionContext(walk, declaration),
        walk.operationOptions,
      );
      return declaredCarrier === undefined
        ? undefined
        : walk.context.projectTypes.instantiateMemberCarrier(
            declaration,
            receiverCarrier,
            declaredCarrier,
          );
    },
    resolveExpressionCarrier: (expression, expected) => resolveExpressionCarrier(
      walk,
      expression,
      walk.context.semanticsFor(expression).sourceFile,
      expected,
    ),
    setCarrier: (subject, carrier) => {
      setCarrierFact(walk, subject, carrier);
    },
  });
}

export function setParameterAbiFact(
  walk: RustFactWalk,
  parameter: Node,
  abi: import("../../policy/ownership/source-callable-abi.js").RustSourceParameterAbi,
): void {
  walk.context.facts.set(parameter, rustSourceParameterAbiFactKey, {
    form: abi.form,
    sourceContract: abi.sourceContract,
    valueCarrier: abi.valueCarrier,
    parameterCarrier: abi.parameterCarrier,
    mode: abi.mode,
  }, [
    { message: "rust finalized source parameter ABI" },
  ]);
}

export function recordDefaultParameterInitializerFacts(
  walk: RustFactWalk,
  parameter: Node,
  abi: import("../../policy/ownership/source-callable-abi.js").RustSourceParameterAbi,
): boolean {
  if (abi.form !== "default") {
    return true;
  }
  const initializer = Node_Initializer(walk.context.ast, parameter);
  const resolved = initializer === undefined
    ? undefined
    : resolveExpressionCarrier(
        walk,
        initializer,
        walk.context.semanticsFor(initializer).sourceFile,
        abi.valueCarrier,
      );
  if (initializer !== undefined && resolved !== undefined &&
    rustTargetTypeRefEquals(resolved, abi.valueCarrier)) {
    return true;
  }
  appendRustDiagnostic(
    walk,
    "RUST_DEFAULT_PARAMETER_INITIALIZER_CARRIER_UNSUPPORTED",
    "Default parameter initializer does not have the exact finalized Rust value carrier.",
    initializer ?? parameter,
    ["target.capability=rust.callable.default-parameter"],
  );
  return false;
}

export function recordBindingWrite(walk: RustFactWalk, target: Node | undefined, writeKind: "binding" | "referent" = "binding"): void {
  if (target === undefined) {
    return;
  }
  const { ast } = walk.context;
  const kind = ast.kindName(target);
  if (kind === KindPropertyAccessExpression || kind === KindElementAccessExpression) {
    const receiver = Node_Expression(walk.context.ast, target);
    const receiverKind = receiver === undefined ? "" : ast.kindName(receiver);
    if (receiverKind === "KindThisExpression" || receiverKind === "KindThisKeyword") {
      return;
    }
    recordBindingWrite(walk, receiver, "referent");
    return;
  }
  if (kind === KindCallExpression) {
    const fact = walk.context.facts.get(target, rustTargetOperationFactKey);
    if (fact !== undefined && fact.kind === "ownership-marker" &&
      fact.operation === "mutable-borrow") {
      recordBindingWrite(walk, ast.arguments(target)[0], "referent");
    }
    return;
  }
  if (kind !== KindIdentifier) {
    return;
  }
  const declaration = walk.context.source.navigation.sourceReferenceFor(target)?.declaration;
  if (declaration !== undefined) {
    const key = writeKind === "binding" ? rustMutatedBindingFactKey : rustMutatedReferentFactKey;
    walk.context.facts.set(declaration, key, { mutated: true }, [
      { message: `rust ${writeKind} write` },
    ]);
  }
}

export function recordAssignmentWrite(
  walk: RustFactWalk,
  expression: Node,
  target: Node | undefined,
): void {
  const targetKind = target === undefined ? "" : walk.context.ast.kindName(target);
  const operation = walk.context.facts.get(expression, rustTargetOperationFactKey);
  if ((targetKind === KindPropertyAccessExpression || targetKind === KindElementAccessExpression) &&
    operation?.kind === "runtime-set" && operation.abi.targetReceiver.kind === "input" &&
    operation.abi.targetReceiver.input.mode === "ref") {
    return;
  }
  recordBindingWrite(walk, target);
}

// --- Explicit Rust ownership markers ---------------------------------------

interface OwnershipMarkerResolution {
  readonly carrier: TargetTypeRef | undefined;
}

export function tryRustOwnershipMarkerCall(
  walk: RustFactWalk,
  expression: Node,
  callArguments: readonly (Node | undefined)[],
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): OwnershipMarkerResolution | undefined {
  const facts = walk.context.facts;
  const source = facts.get(expression, rustSourceOwnershipOperationFactKey);
  if (source === undefined) {
    return undefined;
  }
  const argument = source.valueExpression ?? callArguments[0];
  const argumentCarrier = argument === undefined
    ? undefined
    : resolveExpressionCarrier(walk, argument, sourceFile, expected);
  if (argumentCarrier === undefined) {
    return { carrier: undefined };
  }
  const replacementCarrier = source.replacementExpression === undefined
    ? undefined
    : resolveExpressionCarrier(
        walk,
        source.replacementExpression,
        sourceFile,
        argumentCarrier.kind === "reference" ? argumentCarrier.target : undefined,
      );
  if ((source.kind === "store" || source.kind === "replace") &&
    (argumentCarrier.kind !== "reference" || !argumentCarrier.mutable ||
      replacementCarrier === undefined ||
      !rustTargetTypeRefEquals(replacementCarrier, argumentCarrier.target))) {
    appendRustDiagnostic(
      walk,
      "RUST_MUTABLE_REFERENCE_REPLACEMENT_NOT_PROVEN",
      `Rust '${source.kind}' requires one exact mutable-reference destination and a replacement with the same target carrier.`,
      expression,
      ["target.capability=rust.ownership.mutable-reference-write"],
    );
    return { carrier: undefined };
  }
  const borrowedTarget = argumentCarrier.kind === "reference"
    ? argumentCarrier.target
    : argumentCarrier;
  const inferredBorrowLifetime = rustInferredLifetime(
    `source-borrow\0${sourceNodeIdentity(walk.context.ast, expression) ?? [
      walk.context.ast.getPath(sourceFile),
      walk.context.ast.pos(expression),
      walk.context.ast.end(expression),
    ].join(":")}`,
  );
  const sharedBorrowLifetime = expected?.kind === "reference" && !expected.mutable &&
      rustTargetTypeRefEquals(expected.target, borrowedTarget)
    ? expected.lifetime
    : inferredBorrowLifetime;
  const mutableBorrowLifetime = expected?.kind === "reference" && expected.mutable &&
      rustTargetTypeRefEquals(expected.target, borrowedTarget)
    ? expected.lifetime
    : inferredBorrowLifetime;
  const resultCarrier = source.kind === "shared-borrow"
    ? rustReferenceTargetType(borrowedTarget, false, sharedBorrowLifetime)
    : source.kind === "mutable-borrow"
      ? argumentCarrier.kind === "reference" && !argumentCarrier.mutable
        ? undefined
        : rustReferenceTargetType(borrowedTarget, true, mutableBorrowLifetime)
      : source.kind === "load" && argumentCarrier.kind === "reference"
        ? argumentCarrier.target
        : (source.kind === "replace" || source.kind === "take") &&
            argumentCarrier.kind === "reference"
          ? argumentCarrier.target
        : source.kind === "store"
          ? rustUnitTargetType()
          : source.kind === "own" && argumentCarrier.kind === "reference"
            ? argumentCarrier.target
            : argumentCarrier;
  if (resultCarrier === undefined) {
    appendRustDiagnostic(
      walk,
      "RUST_MUTABLE_REBORROW_REQUIRES_MUTABLE_REFERENCE",
      "Rust mutable reborrow requires an exact mutable-reference operand.",
      expression,
      ["target.capability=rust.ownership.reborrow"],
    );
    return { carrier: undefined };
  }
  const lowering = source.kind === "shared-borrow"
    ? "shared-reference" as const
    : source.kind === "mutable-borrow"
      ? "mutable-reference" as const
      : source.kind === "move"
        ? "identity" as const
        : source.kind === "clone"
          ? rustCarrierSupportsClone(argumentCarrier) ? "clone" as const : undefined
          : source.kind === "own"
            ? argumentCarrier.kind === "reference" &&
                rustCarrierSupportsTrait(argumentCarrier.target, rustToOwnedTrait)
              ? "to-owned" as const
              : undefined
            : source.kind === "load"
              ? isRustCopyCarrier(resultCarrier)
                ? "dereference-copy" as const
                : undefined
              : source.kind === "store"
                ? "store" as const
                : source.kind === "replace"
                  ? "replace" as const
                  : source.kind === "take"
                    ? argumentCarrier.kind === "reference" && argumentCarrier.mutable &&
                        rustCarrierSupportsTrait(resultCarrier, rustDefaultTrait)
                      ? "take" as const
                      : undefined
                    : "capture-move" as const;
  if (lowering === undefined) {
    appendRustDiagnostic(
      walk,
      "RUST_OWNERSHIP_MARKER_TRAIT_NOT_PROVEN",
      `Rust '${source.kind}' has no exact trait proof for its finalized carrier.`,
      expression,
      ["target.capability=rust.ownership.explicit-operation"],
    );
    return { carrier: undefined };
  }
  setRustOperationFact(walk, expression, {
    kind: "ownership-marker",
    operationId: `tsonic.rust.ownership.${source.kind}`,
    operation: source.kind,
    operandCarrier: argumentCarrier,
    resultCarrier,
    lowering,
  });
  setCarrierFact(walk, expression, resultCarrier);
  return { carrier: resultCarrier };
}

export function validateOwnershipExpressionAgainstContract(
  walk: RustFactWalk,
  argument: Node,
  mode: "value" | "ref" | "mut-ref",
  sourceContract?: import("../../target-model/operations/model.js").RustSourceParameterContract,
): boolean {
  const rustFact = walk.context.facts.get(argument, rustTargetOperationFactKey);
  const operation = rustFact?.kind === "ownership-marker" ? rustFact.operation : undefined;
  const declaration = walk.context.source.navigation.sourceReferenceFor(argument)?.declaration;
  const declaredContract = declaration === undefined
    ? "ordinary"
    : rustOwnershipContractForDeclaration(walk, declaration);
  const expectedContract = sourceContract ?? declaredContract;
  const declarationKind = declaration === undefined
    ? undefined
    : walk.context.ast.kindName(declaration);
  const directOwnedRvalue = mode === "value" &&
    (declaredContract === "owned" || expectedContract === "owned") &&
    operation === undefined &&
    (declarationKind === undefined || !isOwnedStorageDeclaration(declarationKind));
  const directReference = operation === undefined &&
    ((mode === "ref" && declaredContract === "shared-reference") ||
      (mode === "mut-ref" && declaredContract === "mutable-reference"));
  if (directReference || directOwnedRvalue) {
    return true;
  }
  const ownedResultRequired = mode === "value" &&
    (declaredContract === "owned" || expectedContract === "owned");
  const compatible = mode === "ref"
    ? operation === "shared-borrow"
    : mode === "mut-ref"
      ? operation === "mutable-borrow"
      : ownedResultRequired
        ? operation === "move" || operation === "clone" || operation === "own" ||
          operation === "replace" || operation === "take"
        : operation === undefined || operation === "move" || operation === "clone" ||
          operation === "own" || operation === "load" || operation === "replace" ||
          operation === "take" || operation === "capture-move";
  if (!compatible) {
    const requiredOperation = mode === "ref"
      ? "shared-borrow"
      : mode === "mut-ref"
        ? "mutable-borrow"
        : ownedResultRequired
          ? "an ownership-producing operation"
          : "a value-producing operation";
    appendRustDiagnostic(
      walk,
      "RUST_OWNERSHIP_MARKER_MISMATCH",
      `Rust source contract '${expectedContract}' requires explicit ${requiredOperation} with finalized value mode '${mode}', but received '${operation ?? "no operation"}'.`,
      argument,
      ["target.capability=rust.ownership.explicit-operation"],
    );
    return false;
  }
  return true;
}

export function rustOwnershipContractForStorageExpression(
  walk: RustFactWalk,
  expression: Node | undefined,
): import("../../target-model/operations/model.js").RustSourceParameterContract {
  if (expression === undefined) return "ordinary";
  const declaration = storageDeclarationForExpression(walk, expression);
  return declaration === undefined
    ? "ordinary"
    : rustOwnershipContractForDeclaration(walk, declaration);
}

function rustOwnershipContractForDeclaration(
  walk: RustFactWalk,
  declaration: Node,
): import("../../target-model/operations/model.js").RustSourceParameterContract {
  const sourceFile = walk.context.ast.getSourceFile(declaration);
  if (sourceFile === undefined || !walk.context.sourceFiles.includes(sourceFile)) {
    return "ordinary";
  }
  const authored = rustSourceOwnershipContractForType(
    Node_Type(walk.context.ast, declaration),
    rustResolutionContext(walk, declaration),
  );
  if (authored !== "ordinary") return authored;
  const initializer = Node_Initializer(walk.context.ast, declaration);
  const operation = initializer === undefined
    ? undefined
    : walk.context.facts.get(initializer, rustTargetOperationFactKey);
  if (operation?.kind !== "ownership-marker") return "ordinary";
  if (operation.operation === "shared-borrow") return "shared-reference";
  if (operation.operation === "mutable-borrow") return "mutable-reference";
  return operation.operation === "move" || operation.operation === "clone" ||
      operation.operation === "own" || operation.operation === "replace" ||
      operation.operation === "take"
    ? "owned"
    : "ordinary";
}

export function rustArgumentModeForSourceContract(
  contract: import("../../target-model/operations/model.js").RustSourceParameterContract,
): "value" | "ref" | "mut-ref" {
  return contract === "shared-reference"
    ? "ref"
    : contract === "mutable-reference"
      ? "mut-ref"
      : "value";
}

function storageDeclarationForExpression(
  walk: RustFactWalk,
  expression: Node,
): Node | undefined {
  const reference = walk.context.source.navigation.sourceReferenceFor(expression);
  if (reference?.declaration !== undefined) return reference.declaration;
  const sourceFile = walk.context.ast.getSourceFile(expression);
  if (sourceFile === undefined || !walk.context.source.semantics.includes(sourceFile)) {
    return undefined;
  }
  const semantics = walk.context.source.semantics.forNode(expression);
  const kind = walk.context.ast.kindName(expression);
  if (kind === KindPropertyAccessExpression) {
    return semantics.operations.propertyAccess(expression)?.selectedDeclaration;
  }
  if (kind === KindElementAccessExpression) {
    return semantics.operations.elementAccess(expression)?.selectedDeclaration;
  }
  return undefined;
}

function isOwnedStorageDeclaration(kind: string): boolean {
  return kind === "KindVariableDeclaration" || kind === "KindBindingElement" ||
    kind === "KindParameter" || kind === "KindPropertyDeclaration" ||
    kind === "KindPropertySignature";
}

// --- Error model -------------------------------------------------------------

// Fallibility: a declaration lowers to TsonicResult when it throws or calls a
// fallible operation outside a try boundary. Computed to a fixpoint over all
// project declarations after operation facts are closed.
