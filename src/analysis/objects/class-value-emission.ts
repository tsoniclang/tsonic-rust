import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustTargetProgram } from "../program/model.js";
import type { RustClassEmissionProducer } from "../program/records/class-emission.js";
import { rustClassConstructorInstance } from "../../target-model/types/carriers/class-constructors.js";
import { rustSourceItemIdentity } from "../program/source-package-facades.js";

export function analyzeRustClassValueEmission(input: {
  readonly program: Omit<RustTargetProgram, "reachability">;
  readonly nodes: readonly Node[];
  readonly producer: RustClassEmissionProducer;
}): void {
  const { program, producer } = input;
  for (const node of input.nodes) {
    const fact = program.records.classValue.get(node);
    if (fact === undefined) continue;
    const selected = program.records.classEnvironment.get(fact.declaration);
    if (selected === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted class constructor value requires its exact native environment.", node);
    const fresh = program.source.ast.is.IsClassExpression(node);
    const direct = rustClassConstructorInstance(fact.carrier) !== undefined;
    const view = direct ? undefined : program.classValues.viewFor(fact.declaration, fact.sourceCarrier, fact.carrier);
    if (!direct && view === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted class constructor value requires its exact native view.", node);
    producer.valueRead(node, { environment: selected.environment, source: fresh ? "new" : "existing",
      clone: !fresh && !selected.environment.copy && !selected.module, target: view?.targetCarrier });
  }
  for (const definition of program.projectTypes.definitions) {
    const selected = program.records.classEnvironment.get(definition.declaration);
    if (selected?.environment.evaluatedConstructorValue !== true) continue;
    const component = program.sourcePackageComponents.componentForFile(definition.fileName);
    const publicValue = component !== undefined && (component.publishesImplementationAbi ||
      program.sourcePackageFacades.publicImplementationItemIdentitiesForComponent(component.componentId)
        .includes(rustSourceItemIdentity(definition.fileName, selected.environment.bindingName)));
    producer.moduleValue(definition.declaration, { environment: selected.environment, visibility: publicValue ? "public" : "crate" });
  }
}
