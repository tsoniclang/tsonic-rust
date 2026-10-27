import type { Node } from "@tsonic/tsts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import type { RustAnalysisProgram } from "../program/model.js";
import type { RustReachability } from "../../target-model/records/program/reachability.js";
import type { RustNativeDeclarationLiveness, RustDeadCodeDisposition } from "../../target-model/records/native/native-liveness.js";
import type { RustNativeLivenessProducer } from "../program/records/native/native-liveness.js";
import { rustSourceItemIdentity } from "../../target-model/names/source-output-identities.js";
import { requireRustRecord, type RustRequiredRecord } from "../program/records/objects/required-records.js";

export function analyzeRustDeclarationLiveness(input: {
  readonly program: Pick<RustAnalysisProgram, "source" | "records" | "sourcePackageComponents" | "sourcePackageFacades">;
  readonly reachability: RustReachability;
  readonly nodes: readonly Node[];
  readonly producer: RustNativeLivenessProducer;
  readonly required: RustRequiredRecord[];
}): void {
  const { program, reachability } = input;
  const { ast } = program.source;
  for (const node of new Set(input.nodes)) {
    const authoredDeadCode = reachability.suppressedDeclarations.has(node) ? "authored-declaration" as const : undefined;
    input.producer.subject(node, { deadCode: authoredDeadCode });
    const form = program.records.nativeDeclaration.get(node);
    if (form === undefined) continue;
    const file = ast.getSourceFile(node);
    const component = file === undefined ? undefined : program.sourcePackageComponents.componentForFile(ast.getFileName(file));
    if (file === undefined || component === undefined)
      failTargetAnalysisInvariant("tsonic-rust", "A native declaration requires its exact source component.", node);
    const publiclyReachable = component.publishesImplementationAbi || program.sourcePackageFacades
      .publicImplementationItemIdentitiesForComponent(component.componentId).includes(rustSourceItemIdentity(ast.getFileName(file), form.name));
    const nativeAlias = form.kind === "alias" && form.fact.kind === "native-alias";
    const visibility = ast.hasModifierKind(node, "export") || !nativeAlias && publiclyReachable || form.kind === "alias" && form.fact.kind === "family"
      ? "public" : "crate";
    const deadCode = authoredDeadCode;
    const enumDiscriminant = reachability.externallyReachable.has(node) || deadCode !== undefined ? undefined : "generated-enum-discriminant";
    const sourceVariants = form.kind === "enum" ? form.variants : form.kind === "alias" &&
      (form.fact.kind === "runtime" || form.fact.kind === "string-literal") ? form.fact.variants : [];
    const observed = reachability.declarationVariants.get(node);
    const variants: RustNativeDeclarationLiveness["variants"] = Object.freeze(sourceVariants.map(variant => {
      let disposition: RustDeadCodeDisposition | undefined;
      if (!reachability.externallyReachable.has(node) && deadCode === undefined) {
        if (observed?.used.has(variant.name) !== true) disposition = "authored-unused-variant";
        else if (form.kind === "alias" && form.fact.kind === "runtime" && !observed?.read.has(variant.name)) disposition = "authored-unread-field";
      }
      return Object.freeze({ name: variant.name, deadCode: disposition, nonUpperCaseConstant: !/^[A-Z][A-Z0-9_]*$/u.test(variant.name) });
    }));
    const interfaceDeadCode: RustDeadCodeDisposition | undefined = publiclyReachable ? undefined
      : deadCode !== undefined ? deadCode
      : reachability.constructedProjectTypes.has(node) || reachability.reifiedProjectTypes.has(node) ? undefined
      : "generated-unconstructed-instance";
    const interfaceLiveness = form.kind !== "interface" ? undefined : Object.freeze({ publiclyReachable,
      deadCode: interfaceDeadCode,
      fields: new Map(form.fields.map(field => [field.declaration,
        publiclyReachable || reachability.externallyReachable.has(node) || reachability.readAuthoredFields.has(field.declaration)
          ? undefined : "authored-unread-field" as const])),
      indexDeadCode: interfaceDeadCode !== undefined || publiclyReachable || reachability.usedProjectFields.get(node)?.has("index-storage") === true
        ? undefined : "generated-unused-storage" as const,
    });
    input.producer.declaration(node, { visibility, deadCode, enumDiscriminant, variants, interface: interfaceLiveness });
    requireRustRecord(input.required, "declarationLiveness", node, "native declaration liveness", "analyzeRustDeclarationLiveness");
  }
}
