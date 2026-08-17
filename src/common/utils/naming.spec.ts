import { resolveUniqueName, splitFileName } from './naming';

describe('splitFileName', () => {
  it('keeps the last extension', () => {
    expect(splitFileName('Report.final.pdf')).toEqual({
      stem: 'Report.final',
      ext: '.pdf',
    });
  });

  it('handles names without an extension', () => {
    expect(splitFileName('Contracts')).toEqual({
      stem: 'Contracts',
      ext: '',
    });
  });
});

describe('resolveUniqueName', () => {
  it('returns the original name when it is free', () => {
    expect(
      resolveUniqueName('Report.pdf', ['Memo.pdf'], { treatAsFile: true }),
    ).toBe('Report.pdf');
  });

  it('appends (2), (3), ... before the file extension', () => {
    const taken = ['Report.pdf', 'Report (2).pdf'];
    expect(resolveUniqueName('Report.pdf', taken, { treatAsFile: true })).toBe(
      'Report (3).pdf',
    );
  });

  it('treats folder names as a whole string', () => {
    const taken = ['Legal.docs', 'Legal.docs (2)'];
    expect(resolveUniqueName('Legal.docs', taken)).toBe('Legal.docs (3)');
  });
});
