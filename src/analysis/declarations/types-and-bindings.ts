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
} from "@tsonic/target-api/source";
import {
  rustMutatedBindingFactKey,
  rustMutatedReferentFactKey,
  rustSourceParameterAbiFactKey,
  rustTargetOperationFactKey,
  rustTypeAliasDeclarationFactKey,
} from "../facts/keys.js";
import { appendRustDiagnostic, rustResolutionContext } from "../program/walk.js";
import { flowStateFactKey } from "@tsonic/tsts";
import { isDenseDataArray } from "../../policy/model/closed-data.js";
import { recordRustBindingPatternFacts } from "../control-flow/binding-patterns.js";
import { resolveExpressionCarrier } from "../expressions/carriers.js";
import { resolveRustTargetTypeRef } from "../../policy/types/resolution.js";
import { rustSourceUnionTargetType } from "../../policy/types/target-types.js";
import { rustTargetTypeRefEquals } from "../../policy/types/equality.js";
import { setCarrierFact, setRustOperationFact } from "../operations/project-calls.js";
import { sourceTypeCarrierForDeclaration } from "../operations/inputs.js";
import type { Node, SourceFile, Type } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { TargetTypeRef } from "../../policy/types/model.js";

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
  if (ast.typeParameters(declaration).length !== 0) {
    return;
  }
  const nameNode = ast.name(declaration);
  const typeName = nameNode === undefined ? "" : ast.text(nameNode);
  const fileName = ast.getFileName(ast.getSourceFile(declaration));
  const semantics = walk.context.semanticsFor(declaration);
  const symbol = nameNode === undefined ? undefined : semantics.getSymbolAtLocation(nameNode);
  const sourceType = symbol === undefined ? undefined : semantics.getDeclaredTypeOfSymbol(symbol);
  if (sourceType === undefined || typeName.length === 0 || fileName.length === 0) {
    return;
  }
  if (!semantics.isUnion(sourceType)) {
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
  const sourceMembers = semantics.getUnionOrIntersectionTypes(sourceType);
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
  const selectedProperties = semantics.getPropertyInfos(sourceType).map((property) => {
    const declarations = semantics.getSymbolDeclarations(property.symbol);
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

export function recordParameterAbiFacts(walk: RustFactWalk, parameter: Node): void {
  const parameterAbi = resolveParameterAbi(walk, parameter);
  if (parameterAbi === undefined) {
    appendRustDiagnostic(
      walk,
      "RUST_PARAMETER_CARRIER_UNSUPPORTED",
      "Parameter type has no closed Rust runtime carrier under the selected source-profile and surface policy.",
      parameter,
      ["target.capability=rust.callable.parameter-carrier"],
    );
    return;
  }
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
    const operation = walk.context.facts.get(target, rustTargetOperationFactKey) ??
      walk.context.facts.resolve(target, rustTargetOperationFactKey);
    if (operation?.kind === "source-field" ||
      operation?.kind === "source-union-field" ||
      operation?.kind === "source-accessor" ||
      operation?.kind === "source-method-property") {
      return;
    }
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
    if (fact !== undefined && fact.kind === "flow-marker") {
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

// --- Source-core flow markers ----------------------------------------------

interface FlowMarkerResolution {
  readonly carrier: TargetTypeRef | undefined;
}

// The generic source-semantics extension records flowStateFactKey on neutral
// sharedBorrow/mutableBorrow/move operations (including exact Rust aliases).
// This target converts those source facts into Rust-owned operation facts.
// Flow operations erase at emission because the consuming position's finalized
// Rust argument mode owns the passing shape. Non-flow source markers are
// rejected by the checked source-call operation provider, which is the sole
// owner of marker legality.
export function tryFlowMarkerCall(
  walk: RustFactWalk,
  expression: Node,
  callArguments: readonly (Node | undefined)[],
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): FlowMarkerResolution | undefined {
  const facts = walk.context.facts;
  const flow = facts.get(expression, flowStateFactKey);
  if (flow === undefined) {
    return undefined;
  }
  const [argument] = callArguments;
  const argumentCarrier = argument === undefined
    ? undefined
    : resolveExpressionCarrier(walk, argument, sourceFile, expected);
  if (flow.state !== "moved" && flow.state !== "borrowed-shared" && flow.state !== "borrowed-mut") {
    return { carrier: undefined };
  }
  setRustOperationFact(walk, expression, {
    kind: "flow-marker",
    operationId: `tsonic.rust.flow.${flow.state}`,
    state: flow.state,
  });
  if (argumentCarrier !== undefined) {
    setCarrierFact(walk, expression, argumentCarrier);
  }
  return { carrier: argumentCarrier };
}

export function validateFlowMarkerAgainstMode(
  walk: RustFactWalk,
  argument: Node,
  mode: "value" | "ref" | "mut-ref",
): void {
  const flow = walk.context.facts.resolve(argument, flowStateFactKey) ??
    walk.context.facts.get(argument, flowStateFactKey);
  const rustFact = walk.context.facts.get(argument, rustTargetOperationFactKey);
  const markerState = rustFact !== undefined && rustFact.kind === "flow-marker" ? rustFact.state : flow?.state;
  if (markerState === undefined) {
    return;
  }
  const compatible =
    (markerState === "moved" && mode === "value") ||
    (markerState === "borrowed-shared" && mode === "ref") ||
    (markerState === "borrowed-mut" && mode === "mut-ref");
  if (!compatible) {
    appendRustDiagnostic(
      walk,
      "RUST_FLOW_MARKER_MISMATCH",
      `Flow marker state '${markerState}' does not match the finalized argument mode '${mode}' for this position.`,
      argument,
      ["target.capability=rust.source.flow-marker"],
    );
  }
}

// --- Error model -------------------------------------------------------------

// Fallibility: a declaration lowers to TsonicResult when it throws or calls a
// fallible operation outside a try boundary. Computed to a fixpoint over all
// project declarations after operation facts are closed.
