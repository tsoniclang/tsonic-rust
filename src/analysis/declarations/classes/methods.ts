import type { Node } from "@tsonic/tsts";
import { rustProgramNodeIsOutsideNativeCode } from "../../control-flow/compile-time-statements.js";
import type { TargetDiagnostic } from "@tsonic/target-api/artifacts";
import { failTargetAnalysisInvariant } from "@tsonic/target-api/artifacts";
import { sourceObjectMemberDeclarations } from "@tsonic/target-api/source";
import type { RustAnalysisProgram } from "../../program/model.js";
import type { RustMethodEmissionProducer } from "../../program/records/program/method-emission.js";
import type { RustMethodEmissionVariant } from "../../../target-model/records/program/method-emission.js";
import { instantiateRustProjectMethodDispatchArguments } from "../../project-types/method-dispatch.js";
import { rustSourceItemIdentity } from "../../../target-model/names/source-output-identities.js";
import { isValidRustIdentifier } from "../../../target-model/names/identifiers.js";
import type { RustCallableEntryConstruction } from "../../callables/emission/entry-parameters.js";

export function analyzeRustMethodEmission(input: {
  readonly callableEntries: Pick<RustCallableEntryConstruction, "get">;
  readonly program: Omit<RustAnalysisProgram, "reachability">;
  readonly nodes: readonly Node[];
  readonly producer: RustMethodEmissionProducer;
}): readonly TargetDiagnostic[] {
  const { program } = input;
  const { ast } = program.source;
  const issues: TargetDiagnostic[] = [];
  for (const definition of program.projectTypes.definitions) {
    if (definition.kind === "class" && program.records.classDeclaration.get(definition.declaration) === undefined) continue;
    const members = sourceObjectMemberDeclarations(ast, definition.declaration).filter((member): member is Node =>
      member !== undefined && (ast.is.IsMethodDeclaration(member) || ast.kindName(member) === "KindMethodSignature"));
    input.producer.classDeclaration(definition.declaration, members);
  }
  for (const member of input.nodes) {
    if (rustProgramNodeIsOutsideNativeCode(program, member)) continue;
    if (!ast.is.IsMethodDeclaration(member) && !ast.is.IsGetAccessorDeclaration(member) && !ast.is.IsSetAccessorDeclaration(member)) continue;
    const owner = program.projectTypes.definitionContainingDeclaration(member);
    if (owner === undefined) continue;
    if (owner.kind === "class" && program.records.classDeclaration.get(owner.declaration) === undefined) continue;
    const name = ast.is.IsGetAccessorDeclaration(member) ? program.projectTypes.memberSlotName(member, "read")
      : ast.is.IsSetAccessorDeclaration(member) ? program.projectTypes.memberSlotName(member, "write")
      : program.projectTypes.callableTargetName(member);
    if (name === undefined || !isValidRustIdentifier(name)) {
      issues.push({ code: "RUST_UNSUPPORTED_AST", category: "error", source: "tsonic-rust", sourceNode: member,
        message: `Method name '${name ?? ""}' is not a valid Rust identifier. Node kind: ${ast.kindName(member)}.`,
        evidence: ["target.capability=rust.backend.class"] });
      continue;
    }
    const body = ast.body(member);
    if (body === undefined) {
      const implementation = program.sourceNavigation.callableImplementation(member);
      if (!ast.hasModifierKind(member, "abstract") && owner.kind !== "interface" &&
        (implementation.kind !== "resolved" || implementation.implementation.declaration === member))
        failTargetAnalysisInvariant("tsonic-rust", "An admitted method overload requires its exact concrete source implementation.", member);
    }
    const isStatic = ast.hasModifierKind(member, "static");
    const staticSlot = program.projectTypes.memberSlotName(member, "static");
    const environment = input.callableEntries.get(member)?.nativeEntry.direct?.body.slots
      .find(slot => slot.kind === "class-environment");
    const visibility = ast.hasModifierKind(member, "private") || ast.hasModifierKind(member, "protected") ? "private" as const : "public" as const;
    const nativeBody = program.promiseBodies.declarations.get(member);
    const sourceFile = ast.getSourceFile(member);
    const fileName = sourceFile === undefined ? undefined : ast.getFileName(sourceFile);
    const component = fileName === undefined ? undefined : program.sourcePackageComponents.componentForFile(fileName);
    const publiclyReachable = (targetName: string): boolean => ast.hasModifierKind(owner.declaration, "export") || component !== undefined &&
      (component.publishesImplementationAbi || fileName !== undefined && program.sourcePackageFacades.publicImplementationItemIdentitiesForComponent(component.componentId)
        .includes(rustSourceItemIdentity(fileName, targetName)));
    const variants: RustMethodEmissionVariant[] = [];
    const append = (targetName: string | undefined, promiseBody: boolean, specialization: RustMethodEmissionVariant["specialization"]): void => {
      const moduleName = promiseBody ? targetName! : specialization === undefined ? staticSlot ?? name : specialization.targetName;
      const selectedVisibility = promiseBody ? nativeBody!.visibility : visibility;
      variants.push(Object.freeze({ name: targetName, moduleName, promiseBody, specialization,
        moduleVisibility: selectedVisibility === "public" && !publiclyReachable(moduleName) ? "crate" : selectedVisibility }));
    };
    const specializations = program.sourceCallableSpecializations;
    if (body !== undefined) {
      if (!specializations.requiresSpecialization(member)) {
        if (nativeBody !== undefined) append(nativeBody.name, true, undefined);
        if (nativeBody === undefined || program.promiseBodies.objects.has(member)) append(undefined, false, undefined);
      } else for (const specialization of specializations.variantsForCallable(member)) {
        if (nativeBody !== undefined) {
          if (specialization.nativeBodyName === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted native Promise method requires its exact specialized body name.", member);
          append(specialization.nativeBodyName, true, specialization);
        }
        if (nativeBody === undefined || program.promiseBodies.objects.has(member)) append(specialization.targetName, false, specialization);
      }
    }
    const writable = program.projectMethodProperties.usageFor(member)?.writable === true;
    const overrideName = writable ? program.projectTypes.fieldStorageName(owner, member) : undefined;
    const representation = writable ? program.objectRepresentations.representationFor(owner) : undefined;
    if (writable && (owner.kind !== "class" || overrideName === undefined || representation === undefined || program.records.fallible.get(member) === undefined))
      failTargetAnalysisInvariant("tsonic-rust", "An admitted writable method requires its exact field, representation and error contract.", member);
    for (const variant of program.projectMethodDispatch.variantsForMember(member)) {
      const arguments_ = instantiateRustProjectMethodDispatchArguments(member, variant.targetTypeArguments, program.projectTypes.openCarrier(owner), program.projectTypes);
      if (arguments_ === undefined) failTargetAnalysisInvariant("tsonic-rust", "An admitted method dispatch requires its exact native owner specialization.", member);
      input.producer.dispatch(member, arguments_, variant);
    }
    input.producer.method(member, { kind: body === undefined ? "overload" : "body", name, isStatic, visibility, staticSlot, owner, environment,
      override: overrideName === undefined || representation === undefined ? undefined : Object.freeze({ name: overrideName, representation }),
      variants: Object.freeze(variants) });
  }
  return Object.freeze(issues);
}
