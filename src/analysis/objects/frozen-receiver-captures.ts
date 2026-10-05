import type { AstReader, Node, SourceFile } from "@tsonic/tsts";
import type { RustPlanQueries } from "../../target-model/facts/selections.js";
import type { RustProjectTypeDefinition, RustProjectTypePolicy } from "../project-types/type-policy.js";
import type { RustProjectStructuralView } from "./project-structural-views.js";
import type { RustReceiverFieldCaptureQueries } from "../project-types/receiver-captures.js";
import { rustTargetOperationFactKey } from "../facts/keys.js";
import { rustTargetTypeRefEquals } from "../../target-model/types/equality.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export function rustFrozenReceiverCaptureFields(input: {
  readonly ast: AstReader;
  readonly sourceFiles: readonly SourceFile[];
  readonly facts: RustPlanQueries;
  readonly projectTypes: RustProjectTypePolicy;
  readonly views: readonly RustProjectStructuralView[];
  readonly captures: RustReceiverFieldCaptureQueries;
}): ReadonlySet<Node> {
  const frozen = new Set<RustProjectTypeDefinition>();
  const carriers: TargetTypeRef[] = [];
  const pending: Node[] = [...input.sourceFiles];
  let visited = 0;
  while (pending.length !== 0) {
    const node = pending.pop()!;
    if (++visited > 4_194_304) throw new Error("Frozen receiver capture analysis exceeds its finite node budget.");
    const operation = input.facts.getFact(node, rustTargetOperationFactKey);
    if (operation?.kind === "provider-operation" && operation.abi.target.form === "call" &&
      operation.abi.target.path === "tsonic_rust_runtime::freeze_object") {
      const carrier = operation.resultCarrier;
      if (!carriers.some(selected => rustTargetTypeRefEquals(selected, carrier))) carriers.push(carrier);
    }
    input.ast.forEachChild(node, child => { if (child !== undefined) pending.push(child); });
  }
  for (const carrier of carriers) {
    const selected = input.projectTypes.definitionForCarrier(carrier);
    for (const definition of input.projectTypes.definitions) {
      const ownCarrier = input.projectTypes.openCarrier(definition);
      if (selected !== undefined && input.projectTypes.relationship(ownCarrier, selected).kind === "related" ||
        input.views.some(view => rustTargetTypeRefEquals(view.targetCarrier, carrier) &&
          input.projectTypes.definitionForCarrier(view.sourceCarrier) === definition)) frozen.add(definition);
    }
  }
  const frozenOwners = new Set([...frozen].flatMap(definition => input.projectTypes.classLineage(definition) ?? []));
  const fields = new Set<Node>();
  for (const declaration of input.captures.fields) {
    if (input.captures.storageReadonly(declaration)) continue;
    const owner = input.projectTypes.definitionContainingDeclaration(declaration);
    if (owner === undefined || !frozenOwners.has(owner)) continue;
    const name = input.ast.name(declaration);
    if (name !== undefined && input.ast.kindName(name) === "KindPrivateIdentifier") continue;
    fields.add(input.captures.storageDeclaration(declaration));
  }
  return fields;
}
