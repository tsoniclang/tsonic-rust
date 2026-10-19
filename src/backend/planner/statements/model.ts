import type { Node } from "@tsonic/tsts";
import type { RustBlock } from "../../target-ast/syntax/nodes.js";
import type { RustPlanContext } from "../program/plan-context.js";

export type RustBlockPlanner = (node: Node, context: RustPlanContext) => RustBlock | undefined;
