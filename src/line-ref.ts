import { computeLineHash } from "./hashline";

const CHECKSUM_ALPHABET = "abcdefghijklmnopqrstuvwxyz";

export function getVisibleLineCount(content: string): number {
  if (content.length === 0) return 0;
  const fileLines = content.split("\n");
  return content.endsWith("\n") ? fileLines.length - 1 : fileLines.length;
}

export function publicChecksumFromHash(hash: string): string {
  const byte = Number.parseInt(hash, 16);
  const index = Number.isFinite(byte) ? byte % CHECKSUM_ALPHABET.length : 0;
  return CHECKSUM_ALPHABET[index]!;
}

export function computePublicLineChecksum(fileLines: string[], lineNumber: number): string {
  return publicChecksumFromHash(computeLineHash(fileLines, lineNumber - 1));
}

export function formatPublicLineRef(fileLines: string[], lineNumber: number): string {
  return `${lineNumber}${computePublicLineChecksum(fileLines, lineNumber)}`;
}

export type PublicLineRef = {
  line: number;
  checksum?: string;
  contentHint?: string;
};

export function parsePublicLineRef(ref: string): PublicLineRef | undefined {
  const core = ref.replace(/^\s*[>+\-]*\s*/, "").trim();
  const checked = core.match(/^(\d+)([a-z])(?:\s*[│|:](.*))?$/);
  if (checked) {
    return {
      line: Number.parseInt(checked[1]!, 10),
      checksum: checked[2]!,
      ...(checked[3] !== undefined ? { contentHint: checked[3]! } : {}),
    };
  }

  const bare = core.match(/^(\d+)$/);
  if (bare) {
    return { line: Number.parseInt(bare[1]!, 10) };
  }

  return undefined;
}
