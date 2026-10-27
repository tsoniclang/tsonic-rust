import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustClassEmissionProducer } from "../program/records/objects/class-emission.js";
import { rustClassConstructorInstance } from "../../target-model/types/carriers/class-constructors.js";
import { rustSourceItemIdentity } from "../../target-model/names/source-output-identities.js";
import type { RustClassValueCallable } from "../../target-model/records/callables/class-value-callables.js";

export function analyzeRustClassValueEmission(input: {
  readonly program: Omit<RustAnalysisProgram, "reachability">;
  readonly nodes: readonly Node[];
  readonly producer: RustClassEmissionProducer;
}): void {
  const { program, producer } = input;
  const forwarders = new WeakMap<RustClassValueCallable, Set<boolean>>();
  const forwarder = (callable: RustClassValueCallable, construction: boolean): void => {
    let modes = forwarders.get(callable);
    if (modes === undefined) { modes = new Set(); forwarders.set(callable, modes); }
    if (modes.has(construction)) return;
    modes.add(construction);
    const definition = program.projectTypes.definitionForCarrier(callable.ownerCarrier);
    const environment = definition === undefined ? undefined : program.classValues.forDeclaration(definition.declaration)?.environment;
    const moduleFunction = construction ? undefined : program.projectTypes.memberSlotName(callable.declaration, "static");
    const sourceFile = program.source.ast.getSourceFile(callable.declaration);
    if (moduleFunction !== undefined && sourceFile === undefined) failTargetAnalysisInvariant("tsonic-rust", "A native class value forwarder requires its checked module identity.", callable.declaration);
    producer.forwarder(callable, construction, {
      environmentArgument: environment !== undefined && (construction ? environment.instancesUseEnvironment || environment.initializationUsesEnvironment
        : environment.consumers.includes(callable.declaration)),
      moduleFunction: moduleFunction === undefined ? undefined : Object.freeze({ fileName: program.source.ast.getFileName(sourceFile!), name: moduleFunction }),
    });
  };
  for (const view of program.classValues.constructorViewImplementations) {
    if (view.construction !== undefined) forwarder(view.construction, true);
    for (const field of view.fields) if (field.callable !== undefined) forwarder(field.callable, false);
  }
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
