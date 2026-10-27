import type { RustAnalysisProgram } from "../program/model.js";
import type { RustReachability } from "../../target-model/records/program/reachability.js";
import type { RustNativeLivenessProducer } from "../program/records/native/native-liveness.js";
import type { RustDeadCodeDisposition, RustStructuralLivenessEmission } from "../../target-model/records/native/native-liveness.js";
import type { TargetTypeRef } from "../../target-model/types/model.js";

export function analyzeRustStructuralLivenessEmission(program: Omit<RustAnalysisProgram, "reachability">,
  reachability: RustReachability, producer: RustNativeLivenessProducer): void {
  const groups = new Map<readonly TargetTypeRef[], { readonly variants: Set<string>; fields: number }>();
  for (const definition of new Set([...program.structuralShapes.definitions, ...program.structuralShapes.instances])) {
    const group = groups.get(definition.sourceCarriers) ?? { variants: new Set<string>(), fields: 0 };
    const dispatch = program.records.structuralShapeEmission.get(definition)?.dispatch;
    group.fields = Math.max(group.fields, definition.fields.length,
      ...dispatch?.members.flatMap(member => member.field === undefined ? [] : [member.field.index + 1]) ?? []);
    groups.set(definition.sourceCarriers, group);
  }
  for (const union of program.structuralShapes.unionDefinitions) {
    const group = groups.get(union.sourceCarriers) ?? { variants: new Set<string>(), fields: 0 };
    for (const variant of union.payloadTemplate.variants) group.variants.add(variant.name);
    groups.set(union.sourceCarriers, group);
  }
  for (const [carriers, group] of groups) {
    const observations = carriers.map(carrier => reachability.structuralCarriers.get(carrier));
    const used = observations.some(observation => observation?.used === true);
    const select = (publiclyReachable: boolean): RustStructuralLivenessEmission => {
      const variants = new Map<string, RustDeadCodeDisposition | undefined>();
      const fields = new Map<number, Readonly<Record<"value" | "getter" | "setter", RustDeadCodeDisposition | undefined>>>();
      for (const name of group.variants) {
        const constructed = observations.some(observation => observation?.variants.constructed.has(name) === true);
        const read = observations.some(observation => observation?.variants.read.has(name) === true);
        variants.set(name, publiclyReachable || !used ? undefined : !constructed ? "generated-unconstructed-variant"
          : read ? undefined : "authored-unread-field");
      }
      for (let index = 0; index < group.fields; index++) {
        const read: RustDeadCodeDisposition | undefined = publiclyReachable || !used ||
          observations.some(observation => observation?.fieldsRead.has(index) === true) ? undefined : "authored-unread-field";
        const write: RustDeadCodeDisposition | undefined = publiclyReachable || !used ||
          observations.some(observation => observation?.fieldsWritten.has(index) === true) ? undefined : "authored-unread-field";
        fields.set(index, Object.freeze({ value: read, getter: read, setter: write }));
      }
      return Object.freeze({ deadCode: publiclyReachable || used ? undefined : "generated-unconstructed-shape", variants, fields });
    };
    producer.structural(carriers, [select(false), select(true)]);
  }
}
