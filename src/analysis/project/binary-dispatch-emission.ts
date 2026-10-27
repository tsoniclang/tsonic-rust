import type { Node } from "@tsonic/tsts";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustDispatchContextEmissionProducer } from "../program/records/operations/dispatch-contexts.js";
import type { RustSourcePackageErrorPlan } from "../../target-model/records/errors/source-package-errors.js";
import type { RustSourcePackageComponentPlan } from "../../target-model/records/program/source-packages.js";
import type { RustBinaryDispatchComponentEmission, RustBinaryDispatchEmission } from "../../target-model/records/operations/dispatch-contexts.js";
import type { RustDispatchContextGroupInput } from "../../target-model/operations/dispatch-contexts.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";
import { isRustProgramErrorCarrier, rustNamedTargetType } from "../../target-model/types/index.js";
import { mapRustTargetTypes } from "../../target-model/types/carriers/substitution.js";
import { rustBinaryHookInputCount } from "../../target-model/operations/binary-hooks.js";
import { rustTargetIdentifier } from "../../target-model/names/identifiers.js";
import { selectRustStandaloneTypeIdentity } from "../../policy/types/resolution/standalone-emission.js";

export function analyzeRustBinaryDispatchEmission(program: Omit<RustAnalysisProgram, "reachability">,
  errors: RustSourcePackageErrorPlan, producer: RustDispatchContextEmissionProducer): readonly TargetDiagnostic[] {
  const issues: TargetDiagnostic[] = [];
  const refuse = (message: string): void => {
    issues.push(Object.freeze({ code: "RUST_BINARY_DISPATCH_INPUT_INVALID", category: "error", source: "tsonic-rust",
      message, evidence: Object.freeze(["rust.backend.binary-dispatch-input"]) }));
  };
  const components = program.records.sourcePackageComponents.get();
  if (components === undefined) failTargetAnalysisInvariant("tsonic-rust", "Binary dispatch requires its admitted source components.");
  const byId = new Map(components.map(component => [component.componentId, component]));
  const root = components.find(component => component.root);
  if (root === undefined) { refuse("Binary context groups have no exact root component."); return Object.freeze(issues); }
  const reserved = new Set<string>();
  const visit = (node: Node): void => {
    if (program.source.ast.is.IsIdentifier(node)) {
      const name = program.source.ast.text(node);
      if (name.length !== 0) { reserved.add(name); reserved.add(rustTargetIdentifier(name)); }
    }
    program.source.ast.forEachChild(node, child => { if (child !== undefined) visit(child); });
  };
  for (const file of program.sourceFiles) visit(file);
  for (const hook of program.binaryHooks) {
    const demanded = program.binaryDispatchDemand.forHook(hook.id);
    if (demanded === undefined) { refuse("A binary hook has no sealed native context-group demand."); continue; }
    const before = issues.length;
    const groups: RustBinaryDispatchEmission["groups"][number][] = [];
    for (const group of demanded) {
      const selected: RustBinaryDispatchComponentEmission[] = [];
      for (const componentDemand of group.components) {
        const component = byId.get(componentDemand.componentId);
        if (component === undefined) { refuse("Binary context grouping lost its exact component owner."); continue; }
        const owner = emptyOwner(component, group.input.empty);
        if (owner === undefined) continue;
        const accesses: RustBinaryDispatchComponentEmission["accesses"][number][] = [];
        const demand = program.dispatchContextDemand.forComponent(component.componentId);
        for (const access of componentDemand.accesses) {
          const index = demand?.rootContextIds.indexOf(access.rootContextId);
          if (index === undefined || index < 0) { refuse("Binary context access has no exact demanded physical root."); continue; }
          const crate = component.root ? program.configuration.crateName : component.crateName;
          if (crate === undefined) { refuse("Binary context access has no exact native crate identity."); continue; }
          const root = producer.records.dispatchRoots.get(component.componentId)?.find(candidate => candidate.index === index);
          if (root === undefined) { refuse("Binary context access has no exact demanded physical root."); continue; }
          accesses.push(Object.freeze({ identity: `${component.componentId}:${access.rootContextId}`,
            path: `${crate}::${component.programModuleName}::${root.name}`, projections: access.projections }));
        }
        selected.push(Object.freeze({ componentId: component.componentId, emptyOwner: owner,
          children: componentDemand.children, accesses: Object.freeze(accesses) }));
      }
      const rootEmptyOwner = emptyOwner(root, group.input.empty);
      if (rootEmptyOwner === undefined) continue;
      const admittedIds = new Set<string>();
      for (const component of selected) {
        for (const child of component.children) if (!admittedIds.has(child)) refuse("Binary context grouping lost its exact dependency-error route.");
        admittedIds.add(component.componentId);
      }
      groups.push(Object.freeze({ components: Object.freeze(selected), rootEmptyOwner,
        targetArgumentIndex: group.input.targetArgumentIndex, prependPath: group.input.prepend.path, emptyMethod: group.input.empty.method }));
    }
    if (issues.length === before) producer.binary(hook.id, { reservedNames: reserved, rootComponentId: root.componentId,
      inputCount: rustBinaryHookInputCount(hook.phase), groups: Object.freeze(groups) });
  }
  return Object.freeze(issues);

  function emptyOwner(component: RustSourcePackageComponentPlan, construction: RustDispatchContextGroupInput["empty"]): TargetTypeRef | undefined {
    const domain = errors.domainsByComponentId.get(component.componentId);
    if (domain === undefined) { refuse("Binary context grouping has no exact component error domain."); return undefined; }
    if (domain.errorDomain === "project" && !component.root && component.crateName === undefined) {
      refuse("Binary dependency error grouping has no exact native crate identity."); return undefined;
    }
    const errorPath = domain.errorDomain === "runtime" ? "tsonic_rust_runtime::TsonicError"
      : `${component.root ? program.configuration.crateName : component.crateName}::${component.programModuleName}::TsonicError`;
    const carrier = mapRustTargetTypes(construction.owner,
      value => isRustProgramErrorCarrier(value) ? rustNamedTargetType(domain.errorTypeIdentity, errorPath) : value);
    if (selectRustStandaloneTypeIdentity(carrier, { programError: false }) === undefined) {
      refuse("Binary context grouping has no exact renderable native empty constructor."); return undefined;
    }
    return carrier;
  }
}
