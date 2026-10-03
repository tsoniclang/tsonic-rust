export function errorBorrowEffectsSource(representation) {
  const declarations = representation === "arrow" ? `
    const read = (): string => alias.message;
    const other = (): string => { unrelated.message = "unrelated"; return "before"; };
    const write = (): string => { alias.message = "after"; return "before"; };
    const writeStack = (): string => { original.stack = "next"; return "prior"; };
  ` : `
    function read(): string { return alias.message; }
    function other(): string { unrelated.message = "unrelated"; return "before"; }
    function write(): string { alias.message = "after"; return "before"; }
    function writeStack(): string { original.stack = "next"; return "prior"; }
  `;
  return `
    export function main(): void {
      const original = new Error("before"); const alias = original; const unrelated = new Error("other");
      ${declarations}
      if (original.message !== read() || original.message !== other()) throw new Error("pure reads changed");
      if (original.message !== write() || original.message !== "after") throw new Error("message guard retained");
      original.stack = "prior";
      if (original.stack !== writeStack() || original.stack !== "next") throw new Error("stack guard retained");
    }`;
}

export function errorStackRecaptureSource(representation) {
  const declaration = representation === "arrow"
    ? "const recapture = (): string | undefined => { Error.captureStackTrace(error); return undefined; };"
    : "function recapture(): string | undefined { Error.captureStackTrace(error); return undefined; }";
  return `
    export function main(): void {
      const error = new Error("immutable native owner");
      Error.captureStackTrace(error);
      ${declaration}
      if (error.stack === recapture() || error.stack === undefined) throw new Error("captured stack was lost");
    }`;
}
