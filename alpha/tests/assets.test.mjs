import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,cp,rm,appendFile,writeFile,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {RunStore} from '../runner.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
async function clone(t){
 const dir=await mkdtemp(join(tmpdir(),'alpha-skills-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 await mkdir(join(dir,'alpha'));await mkdir(join(dir,'.dsh/skills'),{recursive:true});
 for(const f of ['core.mjs','team.json','skills.lock.json'])await cp(join(root,'alpha',f),join(dir,'alpha',f));
 for(const d of (await readdir(join(root,'.dsh/skills'))).filter(x=>x.startsWith('alpha-')))await cp(join(root,'.dsh/skills',d),join(dir,'.dsh/skills',d),{recursive:true});
 return {dir,load:(await import(pathToFileURL(join(dir,'alpha/core.mjs')).href)).loadTeam};
}
test('editing a locked skill without its reviewed lock is rejected',async t=>{const {dir,load}=await clone(t);await appendFile(join(dir,'.dsh/skills/alpha-research/SKILL.md'),'unreviewed');await assert.rejects(load(),{code:'SKILL_CHANGED'});});
test('silently adding a skill is rejected',async t=>{const {dir,load}=await clone(t);await mkdir(join(dir,'.dsh/skills/alpha-injected'));await assert.rejects(load(),{code:'SKILL_INVENTORY'});});
test('silently adding an executable skill resource is rejected',async t=>{const {dir,load}=await clone(t);await writeFile(join(dir,'.dsh/skills/alpha-research/unreviewed.sh'),'exit 0');await assert.rejects(load(),{code:'SKILL_INVENTORY'});});
test('missing required skill cannot be hidden by removing its lock entry',async t=>{const {dir,load}=await clone(t);const lock=JSON.parse(await readFile(join(dir,'alpha/skills.lock.json'),'utf8'));delete lock['.dsh/skills/alpha-research/SKILL.md'];await rm(join(dir,'.dsh/skills/alpha-research'),{recursive:true});await writeFile(join(dir,'alpha/skills.lock.json'),JSON.stringify(lock));await assert.rejects(load(),{code:'SKILL_MISSING'});});
test('exclusive run locks reject a second writer',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'alpha-store-'));t.after(()=>rm(dir,{recursive:true,force:true}));const state={id:randomUUID(),x:1},a=new RunStore(dir),b=new RunStore(dir);
 await a.create(state);try{await assert.rejects(b.create(state),{code:'EEXIST'});}finally{await a.close();}
});
test('an existing run snapshot is never silently overwritten and failed creation releases its lock',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'alpha-store-'));t.after(()=>rm(dir,{recursive:true,force:true}));const state={id:randomUUID(),x:1},a=new RunStore(dir),b=new RunStore(dir);
 await a.create(state);await a.close();await assert.rejects(b.create({...state,x:2}),{code:'EEXIST'});assert.ok(!(await readdir(dir)).some(f=>f.endsWith('.lock')));assert.equal(JSON.parse(await readFile(join(dir,state.id+'.json'),'utf8')).x,1);
});
test('model-shaped filesystem identities cannot escape the run directory',async()=>{await assert.rejects(new RunStore(tmpdir()).create({id:'../../escape'}),{code:'STATE_ID'});});
