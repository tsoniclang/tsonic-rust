import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustErrorEmissionProducer } from "../program/records/errors/error-emission.js";
import { selectRustPhysicalProgramErrorOwner } from "./error-types.js";
import { closedMetadataEquals } from "../../target-model/metadata/closed-data.js";
import { rustProgramErrorTargetType } from "../../target-model/types/index.js";

export function analyzeRustProjectMemberErrors(program: Omit<RustAnalysisProgram, "reachability">, nodes: readonly Node[], producer: RustErrorEmissionProducer): void {
  const { ast } = program.source;
  const declarations = new Set([...nodes, ...program.projectTypes.definitions.flatMap(definition => ast.members(definition.declaration)
    .filter((member): member is Node => member !== undefined))]);
  for (const declaration of declarations) {
    const definition = program.projectTypes.definitionContainingDeclaration(declaration);
    if (definition === undefined) continue;
    const dispatch = program.projectFieldDispatch.planFor(declaration);
    if (program.records.sourceCallEffects.get(declaration)?.invocation !== "fallible" &&
      program.records.fallible.get(declaration) === undefined && dispatch?.read.fallible !== true && dispatch?.write?.fallible !== true) continue;
    const parent = ast.parent(declaration);
    const kind = ast.kindName(declaration);
    const member = parent !== undefined && (ast.is.IsClassDeclaration(parent) || ast.is.IsInterfaceDeclaration(parent)) &&
      !ast.hasModifierKind(declaration, "static") && (kind === "KindMethodDeclaration" || kind === "KindMethodSignature" ||
        kind === "KindGetAccessor" || kind === "KindSetAccessor" || kind === "KindPropertyDeclaration" || kind === "KindPropertySignature");
    const contracts = member ? program.sourceNavigation.memberContracts(declaration) : undefined;
    if (contracts?.kind === "unresolved") failTargetAnalysisInvariant("tsonic-rust", "An admitted project member requires its exact checked error contracts.", declaration);
    const owners = (contracts === undefined || contracts.contracts.length === 0 ? [declaration] : contracts.contracts)
      .map(subject => selectRustPhysicalProgramErrorOwner(subject, { ast, components: program.sourcePackageComponents }));
    const selected = owners[0];
    if (selected === undefined || owners.some(owner => owner === undefined || !closedMetadataEquals(owner, selected)))
      failTargetAnalysisInvariant("tsonic-rust", "An admitted project member requires one exact declaration-owned native error ABI.", declaration);
    producer.member(declaration, { owner: selected, carrier: rustProgramErrorTargetType(selected) });
  }
}
