export function splitFileName(filename: string): { stem: string; ext: string } {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === filename.length - 1) {
    return { stem: filename, ext: '' };
  }
  return {
    stem: filename.slice(0, lastDot),
    ext: filename.slice(lastDot),
  };
}

export function resolveUniqueName(
  desired: string,
  taken: Iterable<string>,
  options: { treatAsFile?: boolean } = {},
): string {
  const takenSet = taken instanceof Set ? taken : new Set(taken);
  const trimmed = desired.trim();
  if (!takenSet.has(trimmed)) {
    return trimmed;
  }

  const { stem, ext } = options.treatAsFile
    ? splitFileName(trimmed)
    : { stem: trimmed, ext: '' };

  let n = 2;
  let candidate = `${stem} (${n})${ext}`;
  while (takenSet.has(candidate)) {
    n += 1;
    candidate = `${stem} (${n})${ext}`;
  }
  return candidate;
}

export function ancestorIdsFromPath(path: string): string[] {
  return path.split('/').filter(Boolean);
}

export function isPdfUpload(file: {
  originalname: string;
  mimetype: string;
}): boolean {
  const name = file.originalname.toLowerCase();
  return file.mimetype === 'application/pdf' || name.endsWith('.pdf');
}

export function serializeSize(value: bigint | number): string {
  return typeof value === 'bigint' ? value.toString() : String(value);
}
