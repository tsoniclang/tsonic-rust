import {
  ElementAccessExpression_ArgumentExpression,
  BinaryExpression_Left,
  BinaryExpression_Right,
  ForInOrOfStatement_Initializer,
  ForInOrOfStatement_Statement,
  Node_Operand,
  KindBinaryExpression,
  KindCallExpression,
  KindDeleteExpression,
  KindElementAccessExpression,
  KindIdentifier,
  KindArrayBindingPattern,
  KindNewExpression,
  KindNumericLiteral,
  KindObjectBindingPattern,
  KindOmittedExpression,
  KindPostfixUnaryExpression,
  KindPrefixUnaryExpression,
  KindPropertyAccessExpression,
  KindVoidExpression,
  KindVariableDeclaration,
  Node_Expression,
  Node_Name,
} from "@tsonic/target-api/source";
import {
  isRustJsArrayCarrier,
  rustOptionElementCarrier,
  rustOptionTargetType,
  isRustVecCarrier,
  rustJsArrayTargetType,
  rustSourcePrimitiveTargetType,
  rustVecTargetType,
} from "../../policy/types/target-types.js";
import { appendMalformedSourceAst } from "../declarations/project-types.js";
import { appendRustDiagnostic, recordPolicySelection, rustOperationContext, rustResolutionContext } from "../program/walk.js";
import { recordBindingPatternFacts, recordBindingWrite, validateFlowMarkerAgainstMode } from "../declarations/types-and-bindings.js";
import { recordProjectSourceBinding } from "../expressions/references.js";
import { recordStatementFacts } from "../control-flow/statements.js";
import { resolveExpressionCarrier } from "../expressions/carriers.js";
import { resolveRustTupleElementTargetType } from "../../policy/types/resolution.js";
import { rustMutatedBindingFactKey, rustTargetOperationFactKey } from "../facts/keys.js";
import { rustSelectedAssignmentValueCarrier } from "./operators.js";
import { rustTargetTypeRefEquals } from "../../policy/types/equality.js";
import { selectRustCheckedIteration } from "./provider/index.js";
import { setCarrierFact, setRustOperationFact } from "./project-calls.js";
import type { Node, SourceFile } from "@tsonic/tsts";
import type { RustFactWalk } from "../program/walk.js";
import type { RustTargetOperationFact } from "../facts/keys.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export function recordSelectedOperationInputs(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  fact: RustTargetOperationFact | undefined,
): void {
  const { ast } = walk.context;
  const kind = ast.kindName(expression);
  if (kind === KindBinaryExpression) {
    const left = BinaryExpression_Left(walk.context.ast, expression);
    const right = BinaryExpression_Right(walk.context.ast, expression);
    if (left !== undefined) {
      resolveExpressionCarrier(walk, left, sourceFile, undefined);
    }
    if (right !== undefined) {
      resolveExpressionCarrier(
        walk,
        right,
        sourceFile,
        rustSelectedAssignmentValueCarrier(fact),
      );
    }
    return;
  }
  if (kind === KindPrefixUnaryExpression || kind === KindPostfixUnaryExpression) {
    const operand = Node_Operand(walk.context.ast, expression);
    if (operand !== undefined) {
      resolveExpressionCarrier(walk, operand, sourceFile, undefined);
    }
    return;
  }
  if (kind === KindVoidExpression) {
    const operand = Node_Expression(ast, expression);
    if (operand !== undefined) {
      resolveExpressionCarrier(walk, operand, sourceFile, undefined);
    }
    return;
  }
  if (kind === KindDeleteExpression) {
    const operand = Node_Expression(ast, expression);
    const receiver = operand === undefined ? undefined : Node_Expression(ast, operand);
    const index = operand === undefined
      ? undefined
      : ElementAccessExpression_ArgumentExpression(ast, operand);
    if (receiver !== undefined) {
      resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
      if (providerOperationSourceReceiverMode(fact) === "mut-ref") {
        recordBindingWrite(walk, receiver, "referent");
      }
    }
    if (index !== undefined) {
      resolveExpressionCarrier(
        walk,
        index,
        sourceFile,
        fact?.kind === "provider-operation"
          ? fact.abi.sourceArguments[0]?.carrier
          : undefined,
      );
    }
    return;
  }
  if (kind === "KindAsExpression" || kind === "KindTypeAssertionExpression") {
    const operand = Node_Expression(walk.context.ast, expression);
    if (operand !== undefined) {
      resolveExpressionCarrier(walk, operand, sourceFile, undefined);
    }
    return;
  }
  if (kind === KindPropertyAccessExpression) {
    const receiver = Node_Expression(walk.context.ast, expression);
    if (receiver !== undefined) {
      resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
    }
    return;
  }
  if (kind === KindElementAccessExpression) {
    const receiver = Node_Expression(walk.context.ast, expression);
    const argument = ElementAccessExpression_ArgumentExpression(walk.context.ast, expression);
    if (receiver !== undefined) {
      resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
    }
    if (argument !== undefined) {
      resolveExpressionCarrier(
        walk,
        argument,
        sourceFile,
        fact?.kind === "provider-operation" ? fact.abi.sourceArguments[0]?.carrier : undefined,
      );
    }
    return;
  }
  if (kind === KindCallExpression || kind === KindNewExpression) {
    const callee = Node_Expression(walk.context.ast, expression);
    if (callee !== undefined && ast.kindName(callee) === KindPropertyAccessExpression) {
      const receiver = Node_Expression(walk.context.ast, callee);
      if (receiver !== undefined) {
        resolveExpressionCarrier(walk, receiver, sourceFile, undefined);
        if (providerOperationSourceReceiverMode(fact) === "mut-ref") {
          recordBindingWrite(walk, receiver, "referent");
        }
      }
    }
    const callArguments = ast.arguments(expression);
    const selectedCall = walk.context.facts.getSelectedTargetCall(expression);
    for (const [index, argument] of callArguments.entries()) {
      if (argument === undefined) {
        continue;
      }
      const finalizedProviderArgument = fact?.kind === "provider-operation"
        ? fact.abi.sourceArguments.find((candidate) => candidate.sourceIndex === index)
        : undefined;
      const sourceCallCarriers = fact?.kind === "source-call"
        ? fact.parameters.flatMap((parameter) =>
            parameter.inputs.filter((input) => input.sourceArgumentIndex === index).map((input) => input.carrier))
        : [];
      const finalizedArgumentCarrier = fact?.kind === "source-call"
        ? sourceCallCarriers.length > 0 && sourceCallCarriers.every((carrier) =>
            rustTargetTypeRefEquals(carrier, sourceCallCarriers[0]))
          ? sourceCallCarriers[0]
          : undefined
        : fact?.kind === "provider-operation"
          ? finalizedProviderArgument?.carrier
          : selectedCall?.member.parameters[index]?.type;
      resolveExpressionCarrier(
        walk,
        argument,
        sourceFile,
        finalizedArgumentCarrier,
      );
      if (fact?.kind !== "provider-operation") {
        continue;
      }
      const mode = finalizedProviderArgument?.mode;
      if (mode === undefined) {
        continue;
      }
      validateFlowMarkerAgainstMode(walk, argument, mode);
      if (mode === "mut-ref") {
        recordBindingWrite(walk, argument, "referent");
      }
    }
  }
}

function providerOperationSourceReceiverMode(
  fact: RustTargetOperationFact | undefined,
): "value" | "ref" | "mut-ref" | undefined {
  if (fact?.kind !== "provider-operation") {
    return undefined;
  }
  const directInputs = [
    ...(fact.abi.targetReceiver.kind === "input" ? [fact.abi.targetReceiver.input] : []),
    ...fact.abi.targetArguments.flatMap((input) => {
      if ("mode" in input && "source" in input && input.source.kind === "receiver") {
        return [input];
      }
      return [];
    }),
  ];
  const receiverModes = directInputs
    .filter((input) => input.source.kind === "receiver")
    .map((input) => input.mode);
  return receiverModes.length === 1 ? receiverModes[0] : undefined;
}

export function collectDescendantsOfKind(walk: RustFactWalk, root: Node, kindName: string): readonly Node[] {
  const { ast } = walk.context;
  const results: Node[] = [];
  const visit = (node: Node): void => {
    if (ast.kindName(node) === kindName) {
      results.push(node);
    }
    ast.forEachChild(node, (child) => {
      if (child !== undefined) {
        visit(child);
      }
    });
  };
  visit(root);
  return results;
}

export function resolveArrayLiteralCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const { ast } = walk.context;
  const sourceElements = ast.elements(expression);
  if (sourceElements.some((element) => element === undefined)) {
    appendMalformedSourceAst(walk, "Array literal contains an undefined element slot.");
    return undefined;
  }
  const elements = sourceElements as readonly Node[];
  const hasHoles = elements.some((element) => ast.kindName(element) === KindOmittedExpression);
  const presentElements = elements.filter((element) => ast.kindName(element) !== KindOmittedExpression);

  if (expected?.kind === "tuple" && expected.elements.length > 0 && !hasHoles) {
    const omittedOptionalElementIndexes = contextualTupleOmissions(
      walk,
      expression,
      sourceFile,
      expected,
      presentElements.length,
    );
    if (omittedOptionalElementIndexes !== undefined) {
      for (const [index, element] of presentElements.entries()) {
        resolveExpressionCarrier(walk, element, sourceFile, expected.elements[index]);
      }
      setRustOperationFact(walk, expression, {
        kind: "tuple-literal",
        operationId: "tsonic.rust.tuple.literal",
        resultCarrier: expected,
        omittedOptionalElementIndexes,
      });
      return setCarrierFact(walk, expression, expected);
    }
  }
  let expectedElement: TargetTypeRef | undefined;
  const lane: "native" | "js" = walk.jsEnabled ? "js" : "native";
  if (expected !== undefined && isRustVecCarrier(expected)) {
    expectedElement = expected.element;
  } else if (expected?.kind === "target-named" && isRustJsArrayCarrier(expected)) {
    expectedElement = expected.typeArguments?.[0];
  }
  if (expected?.kind === "target-specific" && expected.name === "fixed-array") {
    const value = expected.value as { element: TargetTypeRef; length: number };
    if (presentElements.length !== value.length) {
      return undefined;
    }
    for (const element of presentElements) {
      resolveExpressionCarrier(walk, element, sourceFile, value.element);
    }
    setRustOperationFact(walk, expression, { kind: "fixed-array-literal", operationId: "tsonic.rust.fixed-array.literal" });
    return setCarrierFact(walk, expression, expected);
  }
  if (expectedElement === undefined) {
    for (const element of presentElements) {
      const carrier = resolveExpressionCarrier(walk, element, sourceFile, undefined);
      if (carrier !== undefined) {
        expectedElement = carrier;
        break;
      }
    }
  }
  if (expectedElement === undefined && presentElements.length > 0 &&
    presentElements.every((element) => ast.kindName(element) === KindNumericLiteral)) {
    expectedElement = rustSourcePrimitiveTargetType("float64");
  }
  if (expectedElement === undefined) {
    return undefined;
  }
  if (hasHoles && lane === "native") {
    appendRustDiagnostic(
      walk,
      "RUST_JS_SURFACE_REQUIRED",
      "Sparse array literals require the js surface for the Rust target.",
      expression,
      ["target.capability=rust.js.sparse-array"],
    );
    return undefined;
  }
  for (const element of presentElements) {
    resolveExpressionCarrier(walk, element, sourceFile, expectedElement);
  }
  const resultCarrier = lane === "js"
    ? rustJsArrayTargetType(expectedElement)
    : rustVecTargetType(expectedElement);
  setRustOperationFact(walk, expression, {
    kind: "array-literal",
    operationId: `tsonic.rust.js.array-literal.${lane}`,
    lane,
    elementCarrier: expectedElement,
    resultCarrier,
    length: elements.length,
  });
  return setCarrierFact(walk, expression, resultCarrier);
}

function contextualTupleOmissions(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: Extract<TargetTypeRef, { readonly kind: "tuple" }>,
  presentElementCount: number,
): readonly number[] | undefined {
  if (presentElementCount > expected.elements.length) {
    return undefined;
  }
  if (presentElementCount === expected.elements.length) {
    return [];
  }
  const semantics = walk.context.semantics(sourceFile);
  const contextual = semantics.types.contextualTupleSelection(
    expression,
    presentElementCount,
  );
  if (contextual.kind !== "selected") {
    return undefined;
  }
  const sourceElements = contextual.elements;
  if (sourceElements.length !== expected.elements.length) {
    return undefined;
  }
  for (let index = 0; index < sourceElements.length; index += 1) {
    const sourceElement = sourceElements[index]!;
    if (sourceElement.elementKind !== "required" &&
      sourceElement.elementKind !== "optional") {
      return undefined;
    }
    const sourceCarrier = resolveRustTupleElementTargetType(
      sourceElement,
      semantics,
      rustResolutionContext(walk, expression),
      walk.operationOptions,
    );
    const contextualCarrier = sourceCarrier === undefined
      ? undefined
      : sourceElement.elementKind === "optional"
        ? rustOptionElementCarrier(sourceCarrier) === undefined
          ? rustOptionTargetType(sourceCarrier)
          : sourceCarrier
        : sourceCarrier;
    if (!rustTargetTypeRefEquals(contextualCarrier, expected.elements[index])) {
      return undefined;
    }
  }
  return contextual.omittedOptionalElementIndexes;
}

export function recordForOfFacts(
  walk: RustFactWalk,
  statement: Node,
  sourceFile: SourceFile,
  returnCarrier: TargetTypeRef | undefined,
): void {
  const expression = Node_Expression(walk.context.ast, statement);
  if (expression !== undefined) {
    resolveExpressionCarrier(walk, expression, sourceFile, undefined);
  }
  const source = walk.context.semantics(sourceFile).operations.iteration(statement);
  if (expression !== undefined && source !== undefined) {
    recordPolicySelection(walk, statement, selectRustCheckedIteration({
      target: "rust",
      statement,
      expression,
      initializer: ForInOrOfStatement_Initializer(walk.context.ast, statement),
      source,
    }, rustOperationContext(walk, statement), walk.operationOptions));
  }
  const selected = walk.context.facts.get(statement, rustTargetOperationFactKey);
  if (selected?.kind === "iteration") {
    const initializer = ForInOrOfStatement_Initializer(walk.context.ast, statement);
    if (initializer !== undefined) {
      if (walk.context.ast.kindName(initializer) === KindIdentifier) {
        const declaration = recordProjectSourceBinding(walk, initializer)?.sourceDeclaration;
        if (declaration !== undefined) {
          walk.context.facts.set(declaration, rustMutatedBindingFactKey, { mutated: true }, [
            { message: "rust selected iteration assignment writes the existing binding" },
          ]);
        }
      }
      for (const declaration of collectDescendantsOfKind(walk, initializer, KindVariableDeclaration)) {
        setCarrierFact(walk, declaration, selected.elementCarrier);
        const name = Node_Name(walk.context.ast, declaration);
        const nameKind = name === undefined ? "" : walk.context.ast.kindName(name);
        if (name !== undefined && (nameKind === KindArrayBindingPattern || nameKind === KindObjectBindingPattern) &&
          !recordBindingPatternFacts(walk, name, selected.elementCarrier)) {
          appendRustDiagnostic(
            walk,
            "RUST_BINDING_PATTERN_NOT_CLOSED",
            "Iteration binding pattern has no total Rust projection from its exact finalized element carrier.",
            name,
            ["target.capability=rust.binding-pattern.iteration"],
          );
        }
      }
    }
    const body = ForInOrOfStatement_Statement(walk.context.ast, statement);
    if (body !== undefined) {
      recordStatementFacts(walk, body, sourceFile, returnCarrier);
    }
    return;
  }
  const body = ForInOrOfStatement_Statement(walk.context.ast, statement);
  if (body !== undefined) {
    recordStatementFacts(walk, body, sourceFile, returnCarrier);
  }
}

// --- Project-source classes and enums --------------------------------------

export function sourceTypeCarrierForDeclaration(walk: RustFactWalk, declaration: Node): TargetTypeRef | undefined {
  const definition = walk.context.projectTypes.definitionForDeclaration(declaration);
  return definition === undefined
    ? walk.sourceTypes.carrierForDeclaration(declaration, walk.context.ast)
    : walk.context.projectTypes.openCarrier(definition);
}
