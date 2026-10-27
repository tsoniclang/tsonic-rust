import type { Node } from "@tsonic/tsts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustErrorEmissionProducer } from "../program/records/errors/error-emission.js";
import { selectRustPhysicalProgramErrorOwner } from "./error-types.js";

export function analyzeRustDeclarationErrorOwners(
  program: Omit<RustAnalysisProgram, "reachability">,
  nodes: readonly Node[],
  producer: RustErrorEmissionProducer,
): void {
  const { ast } = program.source;
  const declarations = new Set([...nodes, ...program.projectTypes.definitions.flatMap(definition =>
    [definition.declaration, ...ast.members(definition.declaration).filter((node): node is Node => node !== undefined)])]);
  for (const node of declarations) {
    const file = ast.getSourceFile(node);
    const component = file === undefined ? undefined : program.sourcePackageComponents.componentForFile(ast.getFileName(file));
    if (component === undefined) continue;
    producer.declarationOwner(node, component.componentId);
    const member = program.records.projectMemberError.get(node)?.owner;
    const owner = member === undefined ? selectRustPhysicalProgramErrorOwner(node, { ast, components: program.sourcePackageComponents }) : member;
    if (owner !== undefined) producer.memberOwner(node, owner);
  }
}
