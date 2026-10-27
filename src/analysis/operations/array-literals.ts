import { type Node, type SourceFile, type Type } from "@tsonic/tsts";
import { rustCallableTargetForSourceLifetime } from "../../policy/conversions/value-carrier-reconciliation.js";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";
import { isSourceCallableBodyBoundary, sourceBoundTypeRelationship, sourceSequenceInputChoice, sourceSequenceInputIsEmpty, KindOmittedExpression, Node_Expression, type SourceLiteralValue } from "@tsonic/target-api/source";
import { type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { type RustAnalysisProgram } from "../program/model.js";
import { type RustArrayLiteralProducer } from "../program/records/operations/array-literals.js";
import { type RustBorrowedSequenceEmission } from "../../target-model/records/operations/array-literals.js";
import { rustValueConversionContract } from "../../policy/conversions/contracts.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustVecTargetType, isRustJsArrayCarrier, isRustNumericCarrier, rustJsArrayLikeElementTargetType, rustOptionElementCarrier, rustOptionTargetType, isRustVecCarrier, rustFixedArrayCarrierValue, rustTargetConstInteger } from "../../target-model/types/index.js";
import { rustArrayLiteralCarrier } from "../../policy/types/collections/array-literals.js";
import { requireRustRecord } from "../program/records/objects/required-records.js";
import { appendMalformedSourceAst } from "../declarations/project-types.js";
import { appendRustDiagnostic, rustResolutionContext, type RustFactWalk } from "../program/walk.js";
import { resolveExpressionCarrier } from "../source-evidence/types/resolution/expression-carriers.js";
import { createRustCarrierProbe } from "../program/carrier-probe.js";
import { resolveRustTupleElementTargetType } from "../source-evidence/types/resolution/index.js";
import { resolveRustTargetTypeRef } from "../source-evidence/types/resolution/source.js";
import { resolveRustInferredUnion } from "../source-evidence/types/resolution/inferred-unions.js";
import { resolveRustSourceUnionCarrier, resolveRustUnionValueCarrier } from "../source-evidence/types/resolution/source-unions.js";
import { setCarrierFact } from "./project-calls.js";
import { type RustTargetOperationFact } from "../../target-model/records/operations/operations.js";
import { type TargetTypeRef } from "../../target-model/types/model.js";
import { rustBorrowedSequenceElementCandidates, selectRustBorrowedSequenceInput } from "./borrowed-sequences.js";
import { collectRustArrayElementStorageDemands } from "../storage/array-storage.js";
import { selectRustInferredNumericArrayElement } from "../../policy/types/collections/array-elements.js";
import { selectRustArrayElementStorage } from "../../policy/types/collections/array-storage.js";
import { hasExactObjectKeys, isClosedMetadata, isDenseDataArray } from "../../target-model/metadata/closed-data.js";
import { rustEffectiveValueCarrier } from "../conversions/value-carrier-queries.js";

export function analyzeRustArrayLiterals(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustArrayLiteralProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const refuse = (node: Node): void => {
    issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
      message: `Array construction requires exact source contributions, native storage and element conversions. Node kind: ${program.source.ast.kindName(node)}.`,
      evidence: ["target.capability=rust.backend.array-literal"] });
  };
  for (const node of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, node)) continue;
    const literal = program.records.targetOperation.get(node);
    if (literal?.kind !== "array-literal") continue;
    if (!arrayLiteralMatchesSource(program, node, literal)) { refuse(node); continue; }
    let owner: Node | undefined = program.source.ast.parent(node);
    while (owner !== undefined && !isSourceCallableBodyBoundary(program.source.ast, owner)) owner = program.source.ast.parent(owner);
    const body = owner !== undefined && program.records.callableDeclaration.get(owner)?.nativeBody !== undefined ? true : undefined;
    const pending: { readonly input: import("../../target-model/records/storage/borrowed-sequences.js").RustBorrowedSequenceInput;
      readonly inputs: RustBorrowedSequenceEmission["inputs"] }[] = [];
    let valid = true;
    for (const contribution of literal.contributions) {
      if (contribution.kind !== "spread" || producer.records.borrowedSequenceEmission.get(contribution.input, literal.elementCarrier) !== undefined) continue;
      const branches: RustBorrowedSequenceEmission["inputs"][number][] = [];
      for (const input of contribution.input.inputs) {
        if (input.kind === "empty") { branches.push(Object.freeze({ kind: "empty" })); continue; }
        const contract = rustValueConversionContract(input.conversion, program.typeDefinitions);
        if (contract?.lowering !== "rest-sequence" || !rustTargetTypeRefEquals(contract.source, input.presentCarrier) ||
          !rustTargetTypeRefEquals(contract.target, rustVecTargetType(literal.elementCarrier))) {
          refuse(node); valid = false; break;
        }
        const clone = contract.cloneSources.every(carrier => owner === undefined ? program.records.carrierRead.get(carrier)?.clone === true
          : program.records.carrierClone.get(carrier, owner, body) === true);
        if (!clone) {
          issues.push({ code: "RUST_MISSING_TARGET_FACT", category: "error", source: "tsonic-rust", sourceNode: node,
            message: `Borrowed sequence selection lost its exact native presence, storage or element conversion. Node kind: ${program.source.ast.kindName(node)}.`,
            evidence: ["target.capability=rust.backend.borrowed-sequence"] });
          valid = false; break;
        }
        branches.push(Object.freeze({ kind: "sequence", expression: input.expression, optional: input.optional, contract,
          mode: input.optional || contract.collection === "js-array" || input.presentCarrier.kind === "reference" ? "shared-receiver" : "shared-reference" }));
      }
      if (!valid) break;
      pending.push({ input: contribution.input, inputs: Object.freeze(branches) });
    }
    if (valid) for (const input of pending) producer.borrowed(input.input, literal.elementCarrier, { inputs: input.inputs });
  }
  return Object.freeze(issues);
}

function arrayLiteralMatchesSource(program: Omit<RustAnalysisProgram, "reachability">, node: Node,
  literal: Extract<RustTargetOperationFact, { readonly kind: "array-literal" }>): boolean {
  const { ast } = program.source;
  const sources = ast.elements(node);
  if (!hasExactObjectKeys(literal, ["kind", "operationId", "lane", "elementCarrier", "resultCarrier", "length", "contributions"]) ||
    !isDenseDataArray(literal.contributions) || literal.contributions.length !== sources.length || literal.length !== sources.length ||
    (literal.lane !== "native" && literal.lane !== "js") ||
    literal.operationId !== `tsonic.rust.js.array-literal.${literal.lane}` ||
    !rustTargetTypeRefEquals(literal.resultCarrier, rustArrayLiteralCarrier(literal.elementCarrier, literal.lane)) ||
    !rustTargetTypeRefEquals(literal.resultCarrier, program.records.runtimeCarrier.get(node)?.carrier)) return false;
  return literal.contributions.every((contribution, index) => {
    const source = sources[index];
    if (contribution === undefined || source === undefined || ast.kindName(source) === KindOmittedExpression) return false;
    if (hasExactObjectKeys(contribution, ["kind", "carrier"])) return contribution.kind === "value" &&
      !ast.is.IsSpreadElement(source) && rustTargetTypeRefEquals(contribution.carrier, rustEffectiveValueCarrier(program.records, source));
    if (!hasExactObjectKeys(contribution, ["kind", "input"]) || contribution.kind !== "spread" || !ast.is.IsSpreadElement(source)) return false;
    const input = contribution.input;
    const operand = Node_Expression(ast, source);
    if (input === undefined || !hasExactObjectKeys(input, ["expression", "controlNodes", "inputs"]) || input.expression !== operand ||
      !isDenseDataArray(input.controlNodes) || !isDenseDataArray(input.inputs) || operand === undefined) return false;
    const choice = sourceSequenceInputChoice(ast, operand);
    if (choice === undefined || input.inputs.length !== choice.inputs.length || input.controlNodes.length !== choice.controlNodes.length ||
      !input.controlNodes.every((control, position) => control === choice.controlNodes[position])) return false;
    return input.inputs.every((branch, position) => {
      const expression = choice.inputs[position];
      if (branch === undefined || expression === undefined) return false;
      if (hasExactObjectKeys(branch, ["kind", "expression"])) return branch.kind === "empty" &&
        branch.expression === expression && sourceSequenceInputIsEmpty(ast, expression);
      if (!hasExactObjectKeys(branch, ["kind", "expression", "carrier", "presentCarrier", "optional", "conversion"]) ||
        branch.kind !== "sequence" || branch.expression !== expression || sourceSequenceInputIsEmpty(ast, expression) ||
        !rustTargetTypeRefEquals(branch.carrier, rustEffectiveValueCarrier(program.records, expression)) || !isClosedMetadata(branch.conversion)) return false;
      const optional = rustOptionElementCarrier(branch.carrier);
      return branch.optional === (optional !== undefined) && rustTargetTypeRefEquals(branch.presentCarrier, optional ?? branch.carrier);
    });
  });
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

  const selected = expected !== undefined && (expected.kind === "tuple" ||
    isRustVecCarrier(expected) || isRustJsArrayCarrier(expected) || rustFixedArrayCarrierValue(expected) !== undefined)
    ? expected : resolveRustTargetTypeRef(
    expression, rustResolutionContext(walk, expression), walk.operationOptions,
  );
  if (selected?.kind === "tuple" && !hasHoles) {
    const omittedOptionalElementIndexes = contextualTupleOmissions(
      walk,
      expression,
      sourceFile,
      selected,
      presentElements.length,
    );
    if (omittedOptionalElementIndexes !== undefined) {
      const inferred = expected === undefined && omittedOptionalElementIndexes.length === 0 &&
        !presentElements.some(element => ast.is.IsSpreadElement(element));
      const carriers = presentElements.map((element, index) => resolveArrayElementCarrier(
        walk, element, sourceFile, inferred ? undefined : selected.elements[index],
      ));
      if (carriers.some(carrier => carrier === undefined)) return undefined;
      const resultCarrier = inferred
        ? { ...selected, elements: carriers as readonly TargetTypeRef[] } : selected;
      requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, "tuple-literal", "analysis/operations/inputs.ts");
      walk.context.records.targetOperations.source(expression, {
        kind: "tuple-literal",
        operationId: "tsonic.rust.tuple.literal",
        resultCarrier,
        omittedOptionalElementIndexes,
      });
      return setCarrierFact(walk, expression, resultCarrier);
    }
  }
  let expectedElement: TargetTypeRef | undefined;
  const lane: "native" | "js" = walk.jsEnabled ? "js" : "native";
  if (expected !== undefined && isRustVecCarrier(expected)) {
    expectedElement = expected.element;
  } else if (expected?.kind === "target-named" && isRustJsArrayCarrier(expected)) {
    expectedElement = rustJsArrayLikeElementTargetType(expected);
  }
  const fixedArray = rustFixedArrayCarrierValue(expected);
  if (expected !== undefined && fixedArray !== undefined) {
    const length = rustTargetConstInteger(fixedArray.length);
    if (length === undefined || BigInt(presentElements.length) !== length) {
      appendRustDiagnostic(walk, "RUST_FIXED_ARRAY_LITERAL_LENGTH_MISMATCH",
        length === undefined
          ? "Fixed-array literal initialization requires one closed integer extent."
          : `Fixed-array literal has ${presentElements.length} elements, but its exact extent is ${length}.`,
        expression, []);
      return undefined;
    }
    for (const element of presentElements) {
      if (resolveArrayElementCarrier(walk, element, sourceFile, fixedArray.element) === undefined) return undefined;
    }
    requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, "fixed-array-literal", "analysis/operations/inputs.ts");
    walk.context.records.targetOperations.source(expression, { kind: "fixed-array-literal", operationId: "tsonic.rust.fixed-array.literal" });
    return setCarrierFact(walk, expression, expected);
  }
  if (expectedElement === undefined) {
    const demands = collectRustArrayElementStorageDemands(walk, expression);
    expectedElement = inferArrayLiteralElement(walk, expression, sourceFile, presentElements, selected, demands);
    if (expectedElement !== undefined) expectedElement = selectRustArrayElementStorage(
      expectedElement, demands, walk.context.typeDefinitions);
  }
  if (expectedElement === undefined) {
    return undefined;
  }
  if (hasHoles) {
    appendRustDiagnostic(
      walk,
      "RUST_SPARSE_ARRAY_UNSUPPORTED",
      "Ordinary arrays use dense native storage. Write explicit optional elements instead of omitted array elements.",
      expression,
      ["target.capability=rust.js.sparse-array"],
    );
    return undefined;
  }
  const contributions: Extract<RustTargetOperationFact, { readonly kind: "array-literal" }>["contributions"][number][] = [];
  for (const element of presentElements) {
    const spread = ast.is.IsSpreadElement(element);
    const operand = spread ? Node_Expression(ast, element) : element;
    if (spread) {
      const input = operand === undefined ? undefined : selectRustBorrowedSequenceInput(walk, operand, sourceFile, expectedElement);
      if (input === undefined) {
        appendRustDiagnostic(walk, "RUST_ARRAY_SPREAD_CARRIER_MISMATCH",
          "Array spread requires finalized borrowed alternatives with exact native element conversions.", element, []);
        return undefined;
      }
      contributions.push(Object.freeze({ kind: "spread", input }));
      continue;
    }
    const carrier = operand === undefined ? undefined : resolveArrayElementCarrier(
      walk, operand, sourceFile, expectedElement);
    if (carrier === undefined) return undefined;
    contributions.push(Object.freeze({ kind: "value", carrier }));
  }
  const resultCarrier = rustArrayLiteralCarrier(expectedElement, lane);
  requireRustRecord(walk.context.requiredRecords, "targetOperation", expression, "array-literal", "analysis/operations/inputs.ts");
  walk.context.records.targetOperations.source(expression, {
    kind: "array-literal",
    operationId: `tsonic.rust.js.array-literal.${lane}`,
    lane,
    elementCarrier: expectedElement,
    resultCarrier,
    length: elements.length,
    contributions: Object.freeze(contributions),
  });
  return setCarrierFact(walk, expression, resultCarrier);
}

function inferArrayLiteralElement(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  elements: readonly Node[],
  selected: TargetTypeRef | undefined,
  demands: readonly TargetTypeRef[],
): TargetTypeRef | undefined {
  const { ast } = walk.context;
  const types = walk.context.semanticsFor(expression).types;
  const sourceArray = types.expressionType(expression);
  const sourceElement = sourceArray === undefined ? undefined : types.typeArguments(sourceArray)[0];
  const selectedElement = selected !== undefined && isRustVecCarrier(selected)
    ? selected.element : rustJsArrayLikeElementTargetType(selected);
  if (elements.length === 0 || sourceElement !== undefined && (types.isAny(sourceElement) || types.isUnknown(sourceElement))) {
    return selectedElement;
  }
  const probe = createRustCarrierProbe(walk);
  const rows: { readonly type: Type; readonly carrier: TargetTypeRef; readonly literal: SourceLiteralValue | undefined }[] = [];
  for (const element of elements) {
    const spread = ast.is.IsSpreadElement(element);
    const operand = spread ? Node_Expression(ast, element) : element;
    if (operand === undefined) return undefined;
    if (spread) {
      const candidates = rustBorrowedSequenceElementCandidates(walk, operand, sourceFile);
      if (candidates === undefined) return undefined;
      if (candidates.length === 0) continue;
      const source = types.expressionType(operand);
      const type = source === undefined ? undefined : types.typeArguments(source)[0] ?? sourceElement;
      if (type === undefined) return undefined;
      for (const carrier of candidates) rows.push({ type, carrier, literal: undefined });
      continue;
    }
    const carrier = resolveExpressionCarrier(probe, operand, sourceFile, undefined);
    const source = types.expressionType(operand);
    const elementType = source === undefined ? undefined : spread ? types.typeArguments(source)[0] : source;
    const type = elementType === undefined ? undefined : types.literalBaseType(elementType);
    if (carrier === undefined || type === undefined) return undefined;
    rows.push({ type, carrier, literal: walk.context.literalValues.literalValue.get(operand) });
  }
  const numeric = selectRustInferredNumericArrayElement(selectedElement, rows, demands);
  if (numeric.kind === "resolved") return numeric.carrier;
  if (numeric.kind === "rejected") {
    appendRustDiagnostic(walk, "RUST_ARRAY_ELEMENT_CARRIER_MISMATCH", numeric.reason, expression, []);
    return undefined;
  }
  const first = rows[0]?.carrier;
  if (rows.every(row => rustTargetTypeRefEquals(first, row.carrier))) return first;
  if (sourceElement === undefined) return undefined;
  const refuseElement = (): undefined => {
    if (rows.every(row => isRustNumericCarrier(row.carrier))) {
      appendRustDiagnostic(walk, "RUST_ARRAY_ELEMENT_CARRIER_MISMATCH",
        "Array literal requires one exact native element carrier for every checked source contribution.", expression, []);
    }
    return undefined;
  };
  const members = types.isUnion(sourceElement) ? types.unionOrIntersectionTypes(sourceElement) : [sourceElement];
  const numericRows = rows.every(row => isRustNumericCarrier(row.carrier));
  if (numericRows && rows.some(row => !members.some(member => {
    const base = types.literalBaseType(member);
    return base !== undefined && sourceBoundTypeRelationship(
      row.type, base, walk.context.semanticsFor(expression), () => undefined,
    ) === "identity";
  }))) return refuseElement();
  const unionMembers: Type[] = [];
  const carriers: TargetTypeRef[] = [];
  for (const member of members) {
    const base = types.literalBaseType(member);
    const matches = base === undefined ? [] : rows.filter(row => sourceBoundTypeRelationship(
      row.type, base, walk.context.semanticsFor(expression), () => undefined,
    ) === "identity");
    const carrier = matches[0]?.carrier;
    if (carrier === undefined) return refuseElement();
    if (numericRows) {
      for (const match of matches) {
        unionMembers.push(member);
        carriers.push(match.carrier);
      }
    } else {
      if (matches.some(row => !rustTargetTypeRefEquals(row.carrier, carrier))) return refuseElement();
      unionMembers.push(member);
      carriers.push(carrier);
    }
  }
  const inferred = (): TargetTypeRef | undefined => resolveRustInferredUnion(
    sourceElement, unionMembers, carriers, rustResolutionContext(walk, expression), walk.operationOptions,
  );
  return resolveRustSourceUnionCarrier(carriers, values =>
    resolveRustUnionValueCarrier(values, walk.operationOptions, inferred)) ?? refuseElement();
}

function resolveArrayElementCarrier(
  walk: RustFactWalk,
  expression: Node,
  sourceFile: SourceFile,
  expected: TargetTypeRef | undefined,
): TargetTypeRef | undefined {
  const carrier = resolveExpressionCarrier(walk, expression, sourceFile, expected);
  // An element destination whose callable lifetime is still a placeholder takes the lifetime of the element value.
  if (carrier !== undefined && expected !== undefined &&
    !rustTargetTypeRefEquals(carrier, rustCallableTargetForSourceLifetime(carrier, expected))) {
    appendRustDiagnostic(walk, "RUST_ARRAY_ELEMENT_CARRIER_MISMATCH",
      "Array element requires an exact carrier matching its selected destination storage.", expression, []);
    return undefined;
  }
  return carrier;
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
