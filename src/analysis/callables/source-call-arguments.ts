import type { Node } from "@tsonic/tsts";
import { rustCallableTargetForSourceLifetime } from "../../policy/conversions/value-carrier-reconciliation.js";
import { rustProgramNodeIsOutsideNativeCode } from "../control-flow/compile-time-statements.js";
import { failTargetAnalysisInvariant, type TargetDiagnostic } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustSourceCallArgumentProducer } from "../program/records/source-call-arguments.js";
import { rustSliceElementCarrier, isRustJsArrayCarrier, isRustVecCarrier, rustFixedArrayCarrierValue } from "../../target-model/types/index.js";
import { isRustCopyCarrier } from "../../policy/constraints/native-traits.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustEffectiveValueCarrier } from "../conversions/value-carrier-queries.js";
import { rustValueCarrierTransitionTarget } from "../conversions/value-carrier-queries.js";
import { rustFinalizedCarrierTransitionMatches } from "../../policy/operations/members/native-contracts.js";
import { mapRustTargetTypes } from "../../target-model/types/carriers/substitution.js";
import { rustSpreadElementCarrier } from "../../target-model/operations/rest-assembly.js";
import { Node_Expression, sourceEnclosingCallable } from "@tsonic/target-api/source";
import { sourceCallSelectedMemberMatches } from "./source-call-evidence.js";
import { rustSourceCallArgumentCarriers } from "./source-call-lifetimes.js";
import { rustRetainedCallSubstitutions } from "./retained-call-lifetimes.js";
import { rustArgumentPassingMode } from "../../policy/ownership/argument-passing.js";
import type { RustSourceCallInputEmission, RustSourceParameterEmission, RustSourceCallEvaluationEmission } from "../../target-model/records/source-call-arguments.js";

export function analyzeRustSourceCallArguments(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustSourceCallArgumentProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const refuse = (node: Node, capability: string, message: string, unsupported = false): void => {
    issues.push({ code: unsupported ? "RUST_UNSUPPORTED_AST" : "RUST_MISSING_TARGET_FACT", source: "tsonic-rust", category: "error", sourceNode: node,
      message: `${message} Node kind: ${program.source.ast.kindName(node)}.`, evidence: [`target.capability=${capability}`] });
  };
  for (const call of nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, call)) continue;
    const fact = program.records.targetOperation.get(call);
    if (fact?.kind !== "source-call") continue;
    const arguments_ = program.source.ast.arguments(call);
    const exact = arguments_.filter((argument): argument is Node => argument !== undefined);
    if (exact.length !== arguments_.length) failTargetAnalysisInvariant("tsonic-rust", "An admitted source call requires its complete checked argument vector.", call);
    const selectedCall = program.records.selectedCall.get(call);
    if (selectedCall === undefined || !sourceCallSelectedMemberMatches(fact, selectedCall, selectedCall.member.returnType, program.typeFamilies.normalize,
      program.projectTypes, rustSourceCallArgumentCarriers(call, program.source.ast, program.records), program.typeDefinitions, rustRetainedCallSubstitutions(program.records, call))) {
      refuse(call, "rust.backend.source-call-selected-signature", "Selected project-source call fact conflicts with the TSTS-selected target member ABI.");
      continue;
    }
    for (const [index, argument] of exact.entries()) {
      const selected = fact.parameters.filter(parameter => parameter.inputs.some(input => input.sourceArgumentIndex === index));
      const parameter = selected.length === 1 ? selected[0] : undefined;
      const input = parameter?.inputs[0];
      const construction = program.records.targetOperation.get(argument);
      const element = program.source.ast.is.IsArrayLiteralExpression(argument) ? program.source.ast.elements(argument)[0] : undefined;
      const contribution = construction?.kind === "array-literal" ? construction.contributions[0] : undefined;
      const singleton = parameter?.mode === "ref" && parameter.inputs.length === 1 && input?.sourceForm === "value" && input.sourceArgumentIndex === index &&
        construction?.kind === "array-literal" && construction.lane === "native" && construction.contributions.length === 1 && contribution?.kind === "value" &&
        element !== undefined && rustTargetTypeRefEquals(rustSliceElementCarrier(parameter.parameterCarrier), construction.elementCarrier) &&
        rustTargetTypeRefEquals(contribution.carrier, construction.elementCarrier) && rustTargetTypeRefEquals(rustEffectiveValueCarrier(program.records, element), construction.elementCarrier);
      producer.publish(argument, singleton ? { kind: "singleton", element, later: Object.freeze(exact.slice(index + 1)) } : { kind: "value" });
    }
    const evaluation = exact.map((source): RustSourceCallEvaluationEmission["arguments"][number] => {
      const expression = program.source.ast.is.IsSpreadElement(source) ? Node_Expression(program.source.ast, source) : source;
      if (expression === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted spread argument requires its exact source operand.", source);
      return { source, expression, destination: program.callableValues.nativeStorage.invocationArgumentWitnessFor(call, source), mutable: false, borrow: "value", elements: [] };
    });
    const elements = new Map<number, Map<number, "value" | "ref" | "mut-ref">>();
    const mutable = new Set<number>();
    const borrowedRoots = new Map<number, "identity" | "ref" | "mut-ref">();
    const parameters = fact.parameters.map((parameter, parameterIndex): RustSourceParameterEmission => {
      if (parameter.form === "rest" ? parameter.mode !== "value" : parameter.inputs.length > 1 ||
        parameter.inputs.length === 0 && parameter.form !== "optional" && parameter.form !== "default")
        failTargetAnalysisInvariant("tsonic-rust", "An admitted source call requires its exact required, optional and rest parameter ABI.", call);
      const inputs: RustSourceCallInputEmission[] = [];
      for (const input of parameter.inputs) {
        const argument = exact[input.sourceArgumentIndex];
        if (argument === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted source parameter requires its exact source argument slot.", call);
        const expected = rustArgumentPassingMode(parameter.mode);
        if (program.records.argumentPassing.get(argument)?.mode !== expected)
          refuse(argument, "rust.backend.source-call-parameter-passing", `Project-source parameter ${parameterIndex} requires finalized passing mode '${expected}'.`);
        const sourceCarrier = program.records.runtimeCarrier.get(argument)?.carrier;
        const converted = rustValueCarrierTransitionTarget(program.records, argument);
        let projection: RustSourceCallInputEmission["projection"];
        let valid = sourceCarrier !== undefined;
        if (sourceCarrier !== undefined && (input.sourceForm === "value" || input.sourceForm === "spread-sequence")) {
          // A callable parameter whose lifetime is still a placeholder takes the concrete lifetime of the value passed.
          const target = rustCallableTargetForSourceLifetime(converted ?? sourceCarrier, input.carrier);
          valid = rustFinalizedCarrierTransitionMatches(mapRustTargetTypes(sourceCarrier, program.typeFamilies.normalize),
            converted === undefined ? undefined : mapRustTargetTypes(converted, program.typeFamilies.normalize), mapRustTargetTypes(target, program.typeFamilies.normalize)) ||
            converted === undefined && program.structuralShapes.sharesStorage(sourceCarrier, input.carrier);
        } else if (sourceCarrier !== undefined && converted === undefined && input.spreadElementIndex !== undefined) {
          const element = rustSpreadElementCarrier(sourceCarrier, input.spreadElementIndex);
          valid = element !== undefined && rustTargetTypeRefEquals(mapRustTargetTypes(element, program.typeFamilies.normalize), mapRustTargetTypes(input.carrier, program.typeFamilies.normalize));
          if (valid && element !== undefined) {
            const expression = evaluation[input.sourceArgumentIndex]!.expression;
            const read = program.records.readOwnership.get(expression);
            if (read === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native spread requires its exact source ownership.", expression);
            const copy = isRustCopyCarrier(element, carrier => program.callableValues.generic.definitionFor(carrier)?.copy === true);
            const fixed = rustFixedArrayCarrierValue(sourceCarrier) !== undefined;
            const borrowed = read.source.kind === "borrow" || read.sharedReference;
            if (borrowed) borrowedRoots.set(input.sourceArgumentIndex, read.sharedReference ? "identity"
              : read.source.kind === "borrow" && read.source.mutable ? "mut-ref" : "ref");
            const destructure = fixed && !copy && !borrowed;
            projection = { kind: destructure ? "element" : fixed ? "fixed" : "tuple", index: input.spreadElementIndex,
              clone: !destructure && !copy && borrowed && parameter.mode === "value" };
            if (destructure) {
              const values = elements.get(input.sourceArgumentIndex) ?? new Map<number, "value" | "ref" | "mut-ref">();
              const existing = values.get(input.spreadElementIndex);
              if (existing !== undefined && (existing !== parameter.mode || existing === "value"))
                failTargetAnalysisInvariant("tsonic-rust", "A checked fixed spread element has one exact native consumption mode.", argument);
              values.set(input.spreadElementIndex, parameter.mode);
              elements.set(input.sourceArgumentIndex, values);
            }
            if (projection.clone) {
              const owner = sourceEnclosingCallable(expression, program.source.ast);
              const nativeBody = owner !== undefined && program.records.callableDeclaration.get(owner)?.nativeBody !== undefined ? true : undefined;
              valid = owner === undefined ? program.records.carrierRead.get(element)?.clone === true
                : program.records.carrierClone.get(element, owner, nativeBody) === true;
            }
          }
        } else valid = false;
        if (!valid) refuse(argument, "rust.backend.source-call-argument-carrier",
          `Project-source argument ${input.sourceArgumentIndex} conflicts with parameter ${parameterIndex}'s exact selected carrier.`, true);
        const sourceAbi = program.records.sourceParameterAbi.get(argument);
        const identity = sourceAbi?.mode === parameter.mode && rustTargetTypeRefEquals(sourceAbi.parameterCarrier, parameter.parameterCarrier);
        if (parameter.mode !== "value" && (parameter.parameterCarrier.kind !== "reference" ||
          !rustTargetTypeRefEquals(parameter.parameterCarrier.referent, input.carrier) && !(isRustVecCarrier(input.carrier) &&
            rustTargetTypeRefEquals(rustSliceElementCarrier(parameter.parameterCarrier), input.carrier.element))))
          failTargetAnalysisInvariant("tsonic-rust", "An admitted reference parameter requires its exact native referent ABI.", argument);
        if (parameter.mode === "mut-ref") mutable.add(input.sourceArgumentIndex);
        inputs.push(Object.freeze({ argumentIndex: input.sourceArgumentIndex, projection,
          passing: parameter.mode === "value" ? "value" : identity || projection?.kind === "element" ? "identity" : parameter.mode,
          sequence: input.sourceForm !== "spread-sequence" ? "value" : isRustJsArrayCarrier(input.carrier) ? "js" : "native" }));
      }
      return Object.freeze({ form: parameter.form, carrier: parameter.parameterCarrier, rest: isRustJsArrayCarrier(parameter.parameterCarrier) ? "js" : "native",
        inputs: Object.freeze(inputs) });
    });
    producer.call(call, fact, { spread: fact.parameters.some(parameter => parameter.inputs.some(input => input.sourceForm !== "value")),
      arguments: Object.freeze(evaluation.map((argument, index) => Object.freeze({ ...argument, mutable: mutable.has(index), borrow: borrowedRoots.get(index) ?? "value",
        elements: Object.freeze([...(elements.get(index) ?? [])].sort(([left], [right]) => left - right).map(([index, mode]) => Object.freeze({ index, mode }))),
      }))) }, Object.freeze(parameters));
  }
  for (const occurrence of program.physicalEmissionContexts.sourceOccurrences) {
    const abi = occurrence.operation.abi;
    for (const argument of abi.sourceArguments) {
      const slot = occurrence.slots.find(slot => slot.source.kind === "argument" && slot.source.row.sourceIndex === argument.sourceIndex);
      if (slot === undefined) {
        refuse(occurrence.node, "rust.backend.provider-argument", `Provider operation selects missing source argument ${argument.sourceIndex}.`);
        continue;
      }
      if (argument.disposition === "evaluation-only" || abi.operationKind !== "method" && abi.operationKind !== "constructor") continue;
      const expected = rustArgumentPassingMode(argument.mode);
      const actual = program.records.argumentPassing.get(slot.node);
      if (actual === undefined) refuse(slot.node, "rust.backend.parameter-passing", `Provider argument ${argument.sourceIndex} requires finalized Rust parameter-passing mode '${expected}'.`);
      else if (actual.mode !== expected) refuse(slot.node, "rust.backend.parameter-passing",
        `Provider argument ${argument.sourceIndex} has finalized parameter-passing mode '${actual.mode}', expected '${expected}'.`, true);
    }
    producer.provider(abi);
  }
  return Object.freeze(issues);
}
