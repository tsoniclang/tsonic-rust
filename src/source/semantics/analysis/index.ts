import type { SourceAnalysisContext } from "@tsonic/tsts";
import { analyzeRustSourceOperations } from "./operations.js";
import { analyzeRustSourceTypes } from "./types.js";

export function analyzeRustSourceSemantics(context: SourceAnalysisContext): void {
  analyzeRustSourceTypes(context);
  analyzeRustSourceOperations(context);
}
