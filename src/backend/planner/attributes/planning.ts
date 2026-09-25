import type { Node } from "@tsonic/tsts";
import type { RustPlanContext } from "../program/plan-context.js";
import type { RustAttribute, RustAttributeArgument } from "../../target-ast/attributes.js";
import { rustListAttribute, rustValueAttribute, rustWordAttribute } from "../../target-ast/attributes.js";
import type { RustAttributeConstant } from "../../../target-model/attributes/model.js";
import type { RustAttributeApplication } from "../../../analysis/attributes/application-index.js";

export function planRustAttributes(declaration: Node, context: RustPlanContext): readonly RustAttribute[] {
  return planRustAttributeApplications(context.input.program.attributeApplications.forDeclaration(declaration));
}

export function planRustAttributeApplications(applications: readonly RustAttributeApplication[]): readonly RustAttribute[] {
  return applications.map(application => {
    const row = application.provider;
    if (row.kind === "derive") return rustListAttribute("derive", [rustWordAttribute(row.path)]);
    return application.arguments.length === 0 ? rustWordAttribute(row.path)
      : rustListAttribute(row.path, application.arguments.flatMap(planConstant));
  });
}

function planConstant(value: RustAttributeConstant): readonly RustAttributeArgument[] {
  if (value.kind === "record") return value.fields.map(field => {
    const values = planConstant(field.value);
    if (values.length !== 1) throw new Error("A named attribute value must be one exact literal or tuple.");
    return rustValueAttribute(field.name, values[0]!);
  });
  if (value.kind === "tuple") return [{ kind: "tuple", elements: value.elements.flatMap(planConstant) }];
  return [value];
}
