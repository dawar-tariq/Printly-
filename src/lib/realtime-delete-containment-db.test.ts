import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/candidates/realtime_pause_delete.sql', 'utf8');

async function flags(db: PGlite) {
  return (await db.query<{ pubinsert: boolean; pubupdate: boolean; pubdelete: boolean; pubtruncate: boolean }>(
    "select pubinsert, pubupdate, pubdelete, pubtruncate from pg_publication where pubname='supabase_realtime'",
  )).rows[0];
}

describe('candidate Realtime DELETE containment', () => {
  it('fails closed when the expected publication is missing', async () => {
    const db = new PGlite();
    try { await expect(db.exec(migration)).rejects.toThrow('supabase_realtime publication is required'); }
    finally { await db.close(); }
  });

  for (const enabled of [
    'insert, update, delete, truncate', 'insert, delete', 'update, delete, truncate', 'delete', 'insert, update',
  ]) {
    it(`removes only DELETE for publication options ${enabled}`, async () => {
      const db = new PGlite();
      try {
        await db.exec(`create table public.orders(id int primary key); create table public.other_table(id int primary key);
          create publication supabase_realtime for table public.orders, public.other_table with (publish = '${enabled}');`);
        const before = await flags(db);
        const tablesBefore = (await db.query("select tablename from pg_publication_tables where pubname='supabase_realtime' order by tablename")).rows;
        await db.exec(migration);
        expect(await flags(db)).toEqual({ ...before, pubdelete: false });
        expect((await db.query("select tablename from pg_publication_tables where pubname='supabase_realtime' order by tablename")).rows).toEqual(tablesBefore);
        await db.exec(migration);
        expect(await flags(db)).toEqual({ ...before, pubdelete: false });
      } finally { await db.close(); }
    });
  }
});
