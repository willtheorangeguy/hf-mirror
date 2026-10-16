import { describe, test, expect } from 'bun:test';
import {
  repositoryIdentityKey,
  repositoryIdentityKeys,
  selectNewRepositoriesByIdentity,
  dedupeRepositoriesByIdentity,
} from './repo-utils';

describe('repositoryIdentityKey', () => {
  test('is the host plus the full name, independent of the source row', () => {
    const a = repositoryIdentityKey({ sourceProvider: 'huggingface', sourceUrl: 'https://huggingface.co', normalizedFullName: 'acme/tools' });
    const b = repositoryIdentityKey({ sourceProvider: 'huggingface', sourceUrl: 'https://huggingface.co/', normalizedFullName: 'ACME/Tools' });
    expect(a).toBe(b);
  });

  test('treats missing provider and url as huggingface.co, like legacy rows', () => {
    expect(repositoryIdentityKey({ normalizedFullName: 'acme/tools' })).toBe(
      repositoryIdentityKey({ sourceProvider: 'huggingface', sourceUrl: 'https://huggingface.co', normalizedFullName: 'acme/tools' })
    );
  });

  test('keeps the same name on two hosts apart', () => {
    const ghe = repositoryIdentityKey({ sourceProvider: 'huggingface', sourceUrl: 'https://hf.example.com', normalizedFullName: 'acme/tools' });
    const com = repositoryIdentityKey({ sourceProvider: 'huggingface', sourceUrl: 'https://huggingface.co', normalizedFullName: 'acme/tools' });
    expect(ghe).not.toBe(com);
  });
});

describe('selectNewRepositoriesByIdentity', () => {
  test('skips a repository already tracked on the same host under another source', () => {
    const existing = repositoryIdentityKeys([
      { sourceProvider: 'huggingface', sourceUrl: 'https://huggingface.co', normalizedFullName: 'acme/tools' },
    ]);
    const { fresh, alreadyTracked } = selectNewRepositoriesByIdentity(
      [
        { sourceProvider: 'huggingface', sourceUrl: 'https://huggingface.co', normalizedFullName: 'acme/tools', sourceId: 'public-only' },
        { sourceProvider: 'huggingface', sourceUrl: 'https://huggingface.co', normalizedFullName: 'acme/new', sourceId: 'public-only' },
      ],
      existing
    );
    expect(fresh.map((r) => r.normalizedFullName)).toEqual(['acme/new']);
    expect(alreadyTracked.map((r) => r.normalizedFullName)).toEqual(['acme/tools']);
  });

  test('extends the existing set so a later source does not re-add the same repository', () => {
    const existing = new Set<string>();
    const first = selectNewRepositoriesByIdentity(
      [{ sourceProvider: 'huggingface', sourceUrl: 'https://huggingface.co', normalizedFullName: 'acme/tools' }],
      existing
    );
    const second = selectNewRepositoriesByIdentity(
      [{ sourceProvider: 'huggingface', sourceUrl: 'https://huggingface.co', normalizedFullName: 'acme/tools' }],
      existing
    );
    expect(first.fresh).toHaveLength(1);
    expect(second.fresh).toHaveLength(0);
    expect(second.alreadyTracked).toHaveLength(1);
  });

  test('still allows the same name from a different host', () => {
    const existing = repositoryIdentityKeys([
      { sourceProvider: 'huggingface', sourceUrl: 'https://huggingface.co', normalizedFullName: 'acme/tools' },
    ]);
    const { fresh } = selectNewRepositoriesByIdentity(
      [{ sourceProvider: 'huggingface', sourceUrl: 'https://hf.example.com', normalizedFullName: 'acme/tools' }],
      existing
    );
    expect(fresh).toHaveLength(1);
  });
});

describe('dedupeRepositoriesByIdentity', () => {
  test('keeps one row per upstream repository in a batch', () => {
    const { kept, dropped } = dedupeRepositoriesByIdentity([
      { id: 'a', sourceId: 's1', sourceProvider: 'huggingface', sourceUrl: 'https://huggingface.co', normalizedFullName: 'acme/tools' },
      { id: 'b', sourceId: 's2', sourceProvider: 'huggingface', sourceUrl: 'https://huggingface.co', normalizedFullName: 'acme/tools' },
      { id: 'c', sourceId: 's1', sourceProvider: 'huggingface', sourceUrl: 'https://huggingface.co', normalizedFullName: 'acme/other' },
    ]);
    expect(kept.map((r) => r.id)).toEqual(['a', 'c']);
    expect(dropped.map((r) => r.id)).toEqual(['b']);
  });

  test('prefers a row linked to a source over a legacy row without one', () => {
    const { kept, dropped } = dedupeRepositoriesByIdentity([
      { id: 'legacy', sourceId: null, normalizedFullName: 'acme/tools' },
      { id: 'linked', sourceId: 's1', sourceProvider: 'huggingface', sourceUrl: 'https://huggingface.co', normalizedFullName: 'acme/tools' },
    ]);
    expect(kept.map((r) => r.id)).toEqual(['linked']);
    expect(dropped.map((r) => r.id)).toEqual(['legacy']);
  });

  test('leaves a batch without duplicates alone', () => {
    const rows = [
      { id: 'a', sourceId: 's1', normalizedFullName: 'acme/a' },
      { id: 'b', sourceId: 's1', normalizedFullName: 'acme/b' },
    ];
    const { kept, dropped } = dedupeRepositoriesByIdentity(rows);
    expect(kept).toEqual(rows);
    expect(dropped).toEqual([]);
  });
});
