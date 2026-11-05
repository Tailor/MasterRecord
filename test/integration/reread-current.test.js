/**
 * A tracked re-read returns the row as it is now, against LIVE MySQL / Postgres.
 *
 * 1.32.0 and 1.32.1 returned the tracked instance without refreshing it. CodeBook
 * production (Postgres) showed it as a conditional UPDATE followed by a read that
 * answered with the row from before the UPDATE. `test/identity-resolution.test.js`
 * covers the same behaviour on SQLite.
 *
 * Opt in as in cross-engine.test.js: MR_TEST_MYSQL_URL, MR_TEST_PG_URL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mysqlTarget, postgresTarget } from './engineTargets.js';

const { default: context } = await import('../../context.js');

class Lease {
    id(db) { db.integer().primary().auto(); }
    fence(db) { db.integer(); }
    holder(db) { db.string(); }
}

const ENGINES = [
    { name: 'mysql', envVar: 'MR_TEST_MYSQL_URL', target: mysqlTarget(), pkDdl: 'INT AUTO_INCREMENT PRIMARY KEY' },
    { name: 'postgres', envVar: 'MR_TEST_PG_URL', target: postgresTarget(), pkDdl: 'SERIAL PRIMARY KEY' },
];

let envRoot;
function contextClass(eng, tag) {
    if (!envRoot) {
        envRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'masterrecord-reread-'));
        process.on('exit', () => fs.rmSync(envRoot, { recursive: true, force: true }));
    }
    const master = `reread_${eng.name}_${tag}`;
    const ctxName = `RereadCtx_${eng.name}_${tag}`;
    const envDir = path.join(envRoot, master, 'config', 'environments');
    fs.mkdirSync(envDir, { recursive: true });
    fs.writeFileSync(path.join(envDir, `env.${master}.json`), JSON.stringify({ [ctxName]: eng.target }), { mode: 0o600 });
    process.env.master = master;
    return { [ctxName]: class extends context {
        constructor() { super(); this.env(envDir); this.dbset(Lease); }
    } }[ctxName];
}

for (const eng of ENGINES) {
    const skip = eng.target ? false : `set ${eng.envVar} to run`;
    const table = eng.name === 'mysql' ? 'Lease' : '"Lease"';
    const open = async (tag) => {
        const Cls = contextClass(eng, tag);
        const ctx = new Cls();
        await ctx._ensureReady();
        await ctx._execute(`DROP TABLE IF EXISTS ${table}`);
        await ctx._execute(`CREATE TABLE ${table} (id ${eng.pkDdl}, fence INTEGER, holder VARCHAR(64))`);
        return { Cls, ctx };
    };
    const seed = async (ctx) => {
        const l = new Lease(); l.fence = 1; l.holder = 'first';
        ctx.Lease.add(l);
        await ctx.saveChanges();
        return l.id;
    };

    test(`[${eng.name}] a read after a conditional executeUpdate answers with the new row`, { skip }, async () => {
        const { ctx } = await open('update');
        const id = await seed(ctx);
        const before = await ctx.Lease.findById(id);
        assert.equal(Number(before.fence), 1);

        const n = await ctx.Lease.where('l => l.id == $$', id).and('l => l.fence == $$', 1).executeUpdate({ fence: 2, holder: 'second' });
        assert.equal(Number(n), 1);

        const after = await ctx.Lease.findById(id);
        assert.equal(Number(after.fence), 2);
        assert.equal(after.holder, 'second');
        assert.equal(Number((await ctx.Lease.where('l => l.id == $$', id).single()).fence), 2);

        const stale = await ctx.Lease.where('l => l.id == $$', id).and('l => l.fence == $$', 1).executeUpdate({ fence: 3 });
        assert.equal(Number(stale), 0, 'a stale fence still changes nothing');
        assert.equal(Number((await ctx.Lease.findById(id)).fence), 2);
        await ctx.close();
    });

    test(`[${eng.name}] a read sees another context's save; memory follows rows; pending edits survive`, { skip }, async () => {
        const { Cls, ctx } = await open('other');
        const id = await seed(ctx);
        assert.equal((await ctx.Lease.findById(id)).holder, 'first');

        const other = new Cls();
        await other._ensureReady();
        const theirs = await other.Lease.findById(id);
        theirs.holder = 'other-context';
        await other.saveChanges();
        await other.close();
        assert.equal((await ctx.Lease.findById(id)).holder, 'other-context');

        for (let i = 0; i < 25; i++) await ctx.Lease.toList();
        assert.equal(ctx.__trackedEntitiesMap.size, 1, 'one clean copy of the row');

        const mine = await ctx.Lease.findById(id);
        mine.holder = 'pending';
        for (let i = 0; i < 25; i++) assert.equal((await ctx.Lease.findById(id)).holder, 'other-context');
        assert.equal(ctx.__trackedEntitiesMap.size, 2, 'the edited instance and one clean copy');
        await ctx.saveChanges();
        assert.equal((await ctx.Lease.findById(id)).holder, 'pending');
        assert.equal(ctx.__trackedEntitiesMap.size, 1);
        await ctx.close();
    });
}
