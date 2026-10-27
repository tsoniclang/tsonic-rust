import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustObjectProjectionProducer } from "../program/records/objects/object-projections.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import type { RustProjectDowncastFact } from "../../target-model/types/project-projections.js";
import type { RustProjectProjectionEmission } from "../../target-model/records/objects/object-projections.js";
import type { RustClosedTypeTestPlan, RustProjectTypeTestPlan } from "../../target-model/operations/type-tests.js";
import type { RustFlowReadProjectionFact } from "../../target-model/records/objects/value-projections.js";
import { closedMetadataKey, closedMetadataEquals } from "../../target-model/metadata/closed-data.js";
import { isRustProgramErrorCarrier, rustOptionElementCarrier } from "../../target-model/types/index.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import { rustTargetTypeChildren } from "../../target-model/types/carriers/children.js";
import { rustClosedValueRetainsError } from "../../target-model/types/carriers/closed-values.js";
import { selectRustClosedNativeProjection } from "../../policy/types/objects/closed-native-values.js";

export function analyzeRustObjectProjections(program: Omit<RustAnalysisProgram, "reachability">, nodes: readonly Node[], producer: RustObjectProjectionProducer): void {
  const closed = new WeakMap<Node, Set<string>>();
  const projects = new WeakMap<Node, Map<string, RustProjectProjectionEmission>>();
  const carriers: TargetTypeRef[] = program.projectTypes.definitions.map(definition => program.projectTypes.openCarrier(definition));
  const native = (node: Node, source: TargetTypeRef, target: TargetTypeRef): void => {
    let requests = closed.get(node);
    if (requests === undefined) { requests = new Set(); closed.set(node, requests); }
    const key = closedMetadataKey([source, target]);
    if (requests.has(key)) return;
    requests.add(key);
    carriers.push(source, target);
    const representation = program.objectRepresentations.representationFor(program.projectTypes.definitionForCarrier(target));
    if (representation === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted closed native projection requires its exact physical object representation.", node);
    const optional = rustOptionElementCarrier(source);
    for (const domain of ["runtime", "project"] as const) producer.closed(node, source, target, domain,
      selectRustClosedNativeProjection({ target, representation, optional: optional !== undefined,
        programError: isRustProgramErrorCarrier(optional ?? source), domain }));
  };
  const project = (node: Node, fact: RustProjectDowncastFact): void => {
    carriers.push(fact.sourceCarrier, fact.dispatchCarrier, fact.targetCarrier);
    const source = program.projectTypes.definitionForCarrier(fact.dispatchCarrier);
    const target = program.projectTypes.definitionForCarrier(fact.targetCarrier);
    const optional = rustOptionElementCarrier(fact.sourceCarrier);
    const route = source === undefined ? undefined : program.projectTypes.downcastRoute(source, fact.targetCarrier);
    const matches = fact.projection.kind === "generic" || fact.projection.kind === "structural" ||
      route?.kind === fact.projection.kind && route.slot === fact.projection.slot;
    if (source === undefined || target === undefined && fact.projection.kind !== "structural" || !matches ||
      !rustTargetTypeRefEquals(fact.sourceCarrier, fact.dispatchCarrier) && !rustTargetTypeRefEquals(optional, fact.dispatchCarrier))
      failTargetAnalysisInvariant("tsonic-rust", "An admitted project projection requires its exact checked carriers and native dispatch route.", node);
    let requests = projects.get(node);
    if (requests === undefined) { requests = new Map(); projects.set(node, requests); }
    const key = closedMetadataKey([fact.sourceCarrier, fact.targetCarrier]);
    const selected = Object.freeze({ carrier: fact.targetCarrier, optional: optional !== undefined, projection: fact.projection, route });
    const existing = requests.get(key);
    if (existing !== undefined) {
      if (!closedMetadataEquals(existing.projection, selected.projection) || !closedMetadataEquals(existing.route, route))
        failTargetAnalysisInvariant("tsonic-rust", "A checked project projection has one exact native route.", node);
      return;
    }
    requests.set(key, selected);
    producer.project(node, fact.sourceCarrier, fact.targetCarrier, selected);
  };
  const test = (node: Node, plan: RustProjectTypeTestPlan): void => {
    if (plan.lowering.kind === "closed-native") native(node, plan.sourceCarrier, plan.targetCarrier);
    else if (plan.lowering.kind === "dispatch") {
      const definition = program.projectTypes.definitionForCarrier(plan.dispatchCarrier);
      const route = definition === undefined ? undefined : program.projectTypes.downcastRoute(definition, plan.targetCarrier);
      if (route === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native type test requires its exact dispatch route.", node);
      project(node, { sourceCarrier: plan.sourceCarrier, dispatchCarrier: plan.dispatchCarrier, targetCarrier: plan.targetCarrier,
        projection: Object.freeze({ kind: route.kind, slot: route.slot }) });
    }
  };
  const flowProjection = (node: Node, flow: RustFlowReadProjectionFact | undefined): void => {
    if (flow?.kind === "closed-native") native(node, flow.sourceCarrier, flow.selectedCarrier);
    else if (flow?.kind === "project-downcast") project(node, { ...flow, targetCarrier: flow.selectedCarrier });
    else if ((flow?.kind === "source-union" || flow?.kind === "runtime-union") && flow.project !== undefined) project(node, flow.project);
  };
  const closedTest = (node: Node, plan: RustClosedTypeTestPlan): void => {
    if (plan.kind === "project") test(node, plan.plan);
    else if (plan.kind === "option") closedTest(node, plan.test);
    else if (plan.kind === "union") for (const arm of plan.arms) closedTest(node, arm.test);
  };
  for (const node of new Set(nodes)) {
    const carrier = program.records.runtimeCarrier.get(node)?.carrier;
    if (carrier !== undefined) carriers.push(carrier);
    const conversion = program.records.contextualValueConversion.get(node);
    if (conversion !== undefined) carriers.push(conversion.sourceCarrier, conversion.targetCarrier);
    const downcast = program.records.projectDowncast.get(node);
    if (downcast !== undefined) project(node, downcast);
    flowProjection(node, program.records.flowReadProjection.get(node));
    const operation = program.records.targetOperation.get(node);
    if (operation?.kind === "project-type-test") test(node, operation);
    else if (operation?.kind === "closed-type-test") closedTest(node, operation.test);
    // A source call whose result is projected (`value.retain()` returning a narrowed class) plans the same value
    // projection as a flow read (flow-read-emission prepares it), so its native route is sealed here as well.
    else if (operation?.kind === "source-call") flowProjection(node, operation.resultProjection);
  }
  const seen = new Set<string>();
  for (let index = 0; index < carriers.length; index++) {
    const carrier = carriers[index]!;
    const key = closedMetadataKey(carrier);
    if (seen.has(key)) continue;
    seen.add(key);
    const definition = program.projectTypes.definitionForCarrier(carrier);
    const representation = program.objectRepresentations.representationFor(definition);
    if (definition !== undefined && program.projectTypes.sourceErrorDefinitions.includes(definition) && rustClosedValueRetainsError(carrier, program.typeDefinitions))
      producer.value(carrier, { kind: "error" });
    else if (representation !== undefined) producer.value(carrier, representation.kind === "value" ? { kind: "value" } : { kind: "shared", representation });
    carriers.push(...rustTargetTypeChildren(carrier));
  }
}
