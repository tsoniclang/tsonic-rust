import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustSourceBindingEmissionProducer } from "../program/records/storage/binding-paths.js";
import { isValidRustIdentifier } from "../../target-model/names/identifiers.js";

export function analyzeRustSourceBindingEmission(program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[], producer: RustSourceBindingEmissionProducer): void {
  const published = new Set<Node>();
  for (const node of nodes) {
    if (program.records.nativeParticipation.get(node) === "erased" || program.records.compileTimeSource.get(node) !== undefined) continue;
    const binding = program.records.sourceBinding.get(node);
    if (binding === undefined || published.has(binding.sourceDeclaration)) continue;
    const alias = binding.scope === "lexical" ? program.localStorageAliases.owner(binding.sourceDeclaration) : undefined;
    const declaration = alias === undefined ? binding.sourceDeclaration : alias;
    const module = binding.scope === "module" ? program.records.moduleBinding.get(binding.sourceDeclaration) : undefined;
    const name = module?.storage === "native-callable" && module.value !== undefined
      ? module.value.name : program.names.nameForDeclaration(declaration);
    if (name === undefined || !isValidRustIdentifier(name))
      failTargetAnalysisInvariant("tsonic-rust", "An admitted checked source binding requires its selected native storage identity.", node);
    producer.publish(binding.sourceDeclaration, binding.scope === "lexical"
      ? { name, scope: "lexical" } : { name, scope: "module", fileName: binding.fileName });
    published.add(binding.sourceDeclaration);
  }
}
