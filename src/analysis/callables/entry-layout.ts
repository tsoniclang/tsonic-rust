import type { Node } from "@tsonic/tsts";
import type { TargetSourceProgram } from "@tsonic/target-api/source";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { snapshotTargetReadonlyMap } from "@tsonic/target-api/analysis";
import type { RustCallableLeadingEmission, RustNativeCallableEntries, RustNativeCallableEntry,
  RustNativeCallableEntryFacets, RustNativeCallableEntrySlot } from "../../target-model/records/declaration-emission.js";
import type { RustNativeCallableGenericHeader } from "../../target-model/records/native-generics.js";
import type { RustProgramRecords } from "../../target-model/records/program.js";
import type { RustClassValuePlan } from "../../target-model/records/class-values.js";
import type { RustProjectTypePolicy } from "../project-types/index.js";
import type { RustStructuralShapePlan } from "../objects/shapes/structural-shape-plan.js";
import type { RustStructuralShapeDefinition, RustStructuralShapeField } from "../../target-model/records/structural-shapes.js";
import type { RustNativeCallableInputPlan } from "./native-inputs.js";
import type { RustTargetGenericArgument, TargetTypeRef } from "../../target-model/types/model.js";
import { closedMetadataKey } from "../../target-model/metadata/closed-data.js";
import { selectRustNativeStructuralReceiverPassing } from "../../policy/ownership/generic-callables.js";

export function createRustNativeEntryLayouts(input: {
  readonly source: TargetSourceProgram;
  readonly records: RustProgramRecords;
  readonly projectTypes: RustProjectTypePolicy;
  readonly structuralShapes: RustStructuralShapePlan;
  readonly classValues: RustClassValuePlan;
  readonly native: Pick<RustNativeCallableInputPlan, "inputsFor" | "capturesFor">;
}) {
  const fixed = new Map<Node, Map<RustStructuralShapeDefinition, readonly RustStructuralShapeField[]>>();
  for (const owner of input.structuralShapes.definitions) {
    const declarations = new Map<Node, RustStructuralShapeField[]>();
    for (const field of owner.fields) if (field.methodPlan?.kind === "fixed") {
      const fields = declarations.get(field.methodPlan.declaration) ?? [];
      fields.push(field);
      declarations.set(field.methodPlan.declaration, fields);
    }
    for (const [declaration, names] of declarations) {
      const owners = fixed.get(declaration) ?? new Map<RustStructuralShapeDefinition, readonly RustStructuralShapeField[]>();
      owners.set(owner, Object.freeze(names));
      fixed.set(declaration, owners);
    }
  }
  const argument = (parameter: RustNativeCallableGenericHeader["sourceContract"]["parameters"][number]): RustTargetGenericArgument =>
    parameter.kind === "lifetime" ? Object.freeze({ kind: "lifetime", lifetime: parameter.lifetime })
      : Object.freeze({ kind: "type", type: Object.freeze({ kind: "type-parameter", identity: parameter.identity, name: parameter.targetName }) });
  return (declaration: Node, leading: RustCallableLeadingEmission["parameters"],
    parameters: ReadonlyMap<Node, TargetTypeRef>, header: RustNativeCallableGenericHeader | undefined): RustNativeCallableEntries => {
    const { ast } = input.source;
    const lexical = input.records.lexicalFunction.get(declaration);
    const captured = [...(header?.sourceContract.parameters ?? []), ...(header?.implicitLifetimes ?? []), ...(lexical?.genericParameters ?? [])];
    const arguments_: RustTargetGenericArgument[] = captured.map(argument);
    for (const selected of [...input.native.inputsFor(declaration), ...input.native.capturesFor(declaration),
      ...(header?.futureEnvironment.inputs ?? []), ...(header?.futureEnvironment.captures ?? [])])
      arguments_.push(Object.freeze({ kind: "type", type: selected.implementation }));
    const owner = input.projectTypes.definitionContainingDeclaration(declaration);
    if (owner !== undefined) arguments_.push(...owner.genericParameters.map(argument));
    const captures = (extra: readonly RustTargetGenericArgument[]): readonly RustTargetGenericArgument[] => Object.freeze(
      [...new Map([...arguments_, ...extra].map(value => [closedMetadataKey(value), value])).values()]);
    const sourceSlots: RustNativeCallableEntrySlot[] = [];
    for (const parameter of ast.parameters(declaration)) {
      if (parameter === undefined) continue;
      const carrier = parameters.get(parameter);
      if (carrier !== undefined) sourceSlots.push(Object.freeze({ kind: "source", declaration: parameter, carrier }));
    }
    const tail: RustNativeCallableEntrySlot[] = [...sourceSlots,
      ...(lexical?.captures.map(capture => Object.freeze({ kind: "lexical" as const, capture, carrier: capture.parameterCarrier })) ?? [])];
    const task = input.records.nativeTaskUse.get(declaration);
    if (task?.kind === "owner") tail.push(Object.freeze({ kind: "task", use: task, carrier: task.inputCarrier }));
    const facets = (prefix: readonly RustNativeCallableEntrySlot[], arguments_: readonly RustTargetGenericArgument[],
      objectPrefix = prefix): RustNativeCallableEntryFacets => {
      const entry = (selected: readonly RustNativeCallableEntrySlot[]): RustNativeCallableEntry => Object.freeze({
        slots: Object.freeze([...selected, ...tail]), captureArguments: arguments_ });
      const body = entry(prefix);
      return Object.freeze({ body, object: objectPrefix === prefix ? body : entry(objectPrefix) });
    };
    const leadingSlots = leading.map(parameter => Object.freeze({ kind: "leading" as const, parameter, carrier: parameter.carrier }));
    const prefix: RustNativeCallableEntrySlot[] = [...leadingSlots];
    const method = ast.is.IsMethodDeclaration(declaration) || ast.is.IsGetAccessorDeclaration(declaration) || ast.is.IsSetAccessorDeclaration(declaration);
    if (method && owner?.kind === "class") {
      if (!ast.hasModifierKind(declaration, "static")) {
        const self = input.records.selfMode.get(declaration);
        if (self === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native class entry requires its original selected receiver mode.", declaration);
        prefix.unshift(Object.freeze({ kind: "method-receiver", owner, carrier: input.projectTypes.openCarrier(owner), passing: self.mode }));
      } else {
        const environment = input.classValues.forDeclaration(owner.declaration)?.environment;
        if (environment?.consumers.includes(declaration) === true) prefix.unshift(Object.freeze({ kind: "class-environment",
          declaration: owner.declaration, carrier: environment.carrier, name: environment.parameterName,
          genericParameterIndexes: environment.genericParameterIndexes, environment }));
      }
    }
    const structuralFixed = new Map<RustStructuralShapeDefinition, ReadonlyMap<string, RustNativeCallableEntryFacets>>();
    for (const [shape, fields] of fixed.get(declaration) ?? []) {
      const entries = new Map<string, RustNativeCallableEntryFacets>();
      for (const field of fields) {
        if (field.methodPlan?.kind !== "fixed" || field.methodPlan.declaration !== declaration)
          failTargetAnalysisInvariant("tsonic-rust", "A fixed native entry requires its original canonical shape and field.", declaration);
        const remaining = leadingSlots.filter(slot => slot.parameter.kind !== "this");
        const passing = selectRustNativeStructuralReceiverPassing(field.methodPlan.factoryReceiver);
        const receiver = Object.freeze({ kind: "structural-receiver" as const, owner: shape, sourceName: field.sourceName,
          carrier: shape.carrier, passing: passing.body });
        const objectReceiver = passing.object === passing.body ? receiver : Object.freeze({ ...receiver, passing: passing.object });
        entries.set(field.sourceName, facets([receiver, ...remaining], captures(shape.genericArguments), [objectReceiver, ...remaining]));
      }
      structuralFixed.set(shape, snapshotTargetReadonlyMap(entries));
    }
    const module = ast.is.IsConstructorDeclaration(declaration) ? undefined : facets(leadingSlots, captures([]));
    return Object.freeze({ direct: prefix.length === leadingSlots.length ? module : facets(prefix, captures([])), module,
      structuralFixed: snapshotTargetReadonlyMap(structuralFixed) });
  };
}
