import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { readVerdictLog, recordVerdict } from '../verdict-log';

const tmpFile = () => path.join(mkdtempSync(path.join(tmpdir(), 'bonded-verdicts-')), 'verdicts.json');

describe('verdict log (inbox display state)', () => {
  it('reads as empty when no verdict was ever recorded', async () => {
    expect(await readVerdictLog(tmpFile())).toEqual({});
  });

  it('keeps only the latest verdict per invoice', async () => {
    const f = tmpFile();
    await recordVerdict({ invoiceId: 'inv-a', proposalHash: '0x01', outcomeLabel: 'HELD_FOR_STEPUP', reasonCodeLabel: 'PREMISE_HELD_FOR_REVIEW', reviewedAtMs: 1 }, f);
    await recordVerdict({ invoiceId: 'inv-b', proposalHash: '0x02', outcomeLabel: 'REFUSED', reasonCodeLabel: 'PREMISE_MISMATCH', reviewedAtMs: 2 }, f);
    await recordVerdict({ invoiceId: 'inv-a', proposalHash: '0x01', outcomeLabel: 'CLEARED', reasonCodeLabel: 'OK', reviewedAtMs: 3 }, f);
    const log = await readVerdictLog(f);
    expect(Object.keys(log).sort()).toEqual(['inv-a', 'inv-b']);
    expect(log['inv-a']).toMatchObject({ outcomeLabel: 'CLEARED', reviewedAtMs: 3 });
    expect(log['inv-b']).toMatchObject({ outcomeLabel: 'REFUSED', reasonCodeLabel: 'PREMISE_MISMATCH' });
  });
});
