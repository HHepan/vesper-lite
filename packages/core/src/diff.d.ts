declare module 'diff' {
  interface StructuredPatchHunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    lines: string[];
  }
  interface StructuredPatchResult {
    hunks: StructuredPatchHunk[];
  }
  export function structuredPatch(
    oldFileName: string,
    newFileName: string,
    oldStr: string,
    newStr: string,
    oldHeader?: string,
    newHeader?: string,
    options?: { context?: number },
  ): StructuredPatchResult;

  interface Change {
    value: string;
    added?: boolean;
    removed?: boolean;
    count?: number;
  }
  export function diffWordsWithSpace(oldStr: string, newStr: string): Change[];
}
