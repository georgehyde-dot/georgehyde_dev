/**
 * @decision DEC-SCV2-007
 * @title Prove admin collection sequences through actual route handlers
 * @status accepted
 * @rationale Tests invoke the real API exports with production-shaped requests,
 *   exercising authorization before bootstrap, PRG, CRUD, ordered selection,
 *   referential conflicts, and zero-write rejection behavior.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  HOMEPAGE_PROJECT_SELECTION_KEY, HOMEPAGE_SELECTION_KEY, TOLKIEN_WORD,
  bootstrapSiteContent, getHomepageProjectSelection, getHomepageSelection,
  getProject, getWord, listProjects, listWords,
} from "../src/lib/site-content.ts";
import { ALL as wordsAll, POST as createWord } from "../src/pages/admin/api/words/index.ts";
import { ALL as wordAll, POST as mutateWord } from "../src/pages/admin/api/words/[id].ts";
import { ALL as projectsAll, POST as createProject } from "../src/pages/admin/api/projects/index.ts";
import { ALL as projectAll, POST as mutateProject } from "../src/pages/admin/api/projects/[id].ts";
import { ALL as homepageAll, POST as mutateHomepage } from "../src/pages/admin/api/homepage.ts";

function memoryKv() {
  const records = new Map(); const writes = []; let beforePut = async () => {};
  return {
    async get(key, options) { const item = records.get(key); if (!item) return null; return options?.type === "json" ? JSON.parse(item.value) : item.value; },
    async put(key, value, options = {}) { writes.push(key); await beforePut(key); records.set(key, { value, metadata: options.metadata }); },
    async delete(key) { records.delete(key); },
    async list({ prefix = "", cursor } = {}) { const start = cursor ? Number(cursor) : 0; const keys = [...records.entries()].filter(([key]) => key.startsWith(prefix)).sort(([a],[b]) => a.localeCompare(b)).map(([name,item]) => ({ name, metadata: item.metadata })); const page = keys.slice(start,start+2); const next = start+2; return { keys: page, list_complete: next >= keys.length, cursor: next >= keys.length ? undefined : String(next) }; },
    records, writes, setBeforePut(callback) { beforePut = callback; },
  };
}
const prodEnv = (extra = {}) => ({ BLOG_POSTS: memoryKv(), ENVIRONMENT: "production", ADMIN_OWNER_USER_ID: "user_owner", ...extra });
const localEnv = () => prodEnv({ ENVIRONMENT: "local", LOCAL_AUTH_BYPASS: "true", ADMIN_OWNER_USER_ID: "" });
function request(entries, origin = "https://georgehyde.dev") { const form = new FormData(); for (const [key,value] of entries) form.append(key,value); return new Request("https://georgehyde.dev/admin/api/content", { method: "POST", headers: origin === null ? undefined : { Origin: origin }, body: form }); }
function context(env, entries, { id, userId = "user_owner", origin = "https://georgehyde.dev" } = {}) { return { params: id ? { id } : {}, request: request(entries, origin), locals: { runtime: { env }, auth: () => ({ userId }) }, redirect(location,status) { return new Response(null,{status,headers:{Location:location}}); } }; }
const snapshot = (env) => JSON.stringify([...env.BLOG_POSTS.records.entries()]);
const wordFields = (id, extra = {}) => [["id",id],["title",extra.title ?? `${id} title`],["text",extra.text ?? `${id} first\n${id} second`],["attribution",extra.attribution ?? "A. Writer"],["source",extra.source ?? ""]];
const projectFields = (id, extra = {}) => [["id",id],["title",extra.title ?? `${id} title`],["description",extra.description ?? `${id} first\n${id} second`],["url",extra.url ?? `https://example.com/${id}`]];
function slots(action, name, ids) { const values = ids.length <= 5 ? [...ids,...Array(5-ids.length).fill("")] : ids; return [["_action",action],...values.map((id) => [name,id])]; }

test("exact-local real handlers create/edit/order/deselect/delete six titled Words and Projects with PRG", async () => {
  const env = localEnv();
  for (let i=1;i<=6;i+=1) {
    const wordResponse = await createWord(context(env, wordFields(`word-${i}`, { title: `Word ${i}`, text: `Line ${i}\n<script>${i}</script>` }), { userId:null, origin:null }));
    const projectResponse = await createProject(context(env, projectFields(`project-${i}`, { title:`Project ${i}` }), { userId:null, origin:null }));
    assert.equal(wordResponse.status,303); assert.equal(wordResponse.headers.get("Location"),"/admin/words");
    assert.equal(projectResponse.status,303); assert.equal(projectResponse.headers.get("Location"),"/admin/projects");
  }
  assert.equal((await listWords(env)).length,7); assert.equal((await listProjects(env)).length,7);
  const editedWord = await mutateWord(context(env, [["title","Edited poem"],["text","Edited first\nEdited second"],["attribution","Poet"],["source",""]], { id:"word-6",userId:null,origin:null }));
  const editedProject = await mutateProject(context(env, [["title","Edited project"],["description","Edited first\nEdited second"],["url","https://example.com/edited"]], { id:"project-6",userId:null,origin:null }));
  assert.equal(editedWord.status,303); assert.equal(editedProject.status,303);
  assert.equal((await getWord(env,"word-6")).title,"Edited poem"); assert.equal((await getProject(env,"project-6")).title,"Edited project");

  const wordOrder = ["word-5",TOLKIEN_WORD.id,"word-2","word-4","word-1"];
  const projectOrder = ["project-5","featured-project","project-2","project-4","project-1"];
  const wordsSelected = await mutateHomepage(context(env, slots("word-selection","selectedWordIds",wordOrder), {userId:null,origin:null}));
  const projectsSelected = await mutateHomepage(context(env, slots("project-selection","selectedProjectIds",projectOrder), {userId:null,origin:null}));
  assert.equal(wordsSelected.status,303); assert.equal(wordsSelected.headers.get("Location"),"/admin/homepage#words-selection");
  assert.equal(projectsSelected.status,303); assert.equal(projectsSelected.headers.get("Location"),"/admin/homepage#projects-selection");
  assert.deepEqual((await getHomepageSelection(env)).selectedWordIds,wordOrder); assert.deepEqual((await getHomepageProjectSelection(env)).selectedProjectIds,projectOrder);

  assert.equal((await mutateWord(context(env,[["_method","delete"]],{id:"word-5",userId:null,origin:null}))).status,409);
  assert.equal((await mutateProject(context(env,[["_method","delete"]],{id:"project-5",userId:null,origin:null}))).status,409);
  await mutateHomepage(context(env,slots("word-selection","selectedWordIds",[TOLKIEN_WORD.id]),{userId:null,origin:null}));
  await mutateHomepage(context(env,slots("project-selection","selectedProjectIds",["featured-project"]),{userId:null,origin:null}));
  assert.equal((await mutateWord(context(env,[["_method","delete"]],{id:"word-5",userId:null,origin:null}))).status,303);
  assert.equal((await mutateProject(context(env,[["_method","delete"]],{id:"project-5",userId:null,origin:null}))).status,303);
  assert.equal(await getWord(env,"word-5"),null); assert.equal(await getProject(env,"project-5"),null);
});

test("forged zero/six/duplicate/missing selections and invalid records have zero mutation", async () => {
  const env = localEnv(); await bootstrapSiteContent(env);
  for (let i=1;i<=6;i+=1) { await createWord(context(env,wordFields(`word-${i}`),{userId:null,origin:null})); await createProject(context(env,projectFields(`project-${i}`),{userId:null,origin:null})); }
  for (const [action,name,prefix] of [["word-selection","selectedWordIds","word"],["project-selection","selectedProjectIds","project"]]) {
    for (const [ids,status] of [[[],400],[[`${prefix}-1`,`${prefix}-1`],400],[[1,2,3,4,5,6].map((i)=>`${prefix}-${i}`),400],[["missing"],404]]) {
      const before=snapshot(env); const response=await mutateHomepage(context(env,slots(action,name,ids),{userId:null,origin:null})); assert.equal(response.status,status); assert.equal(snapshot(env),before);
    }
  }
  for (const [handler,fields] of [
    [createWord,wordFields("bad-title",{title:"line one\nline two"})],
    [createWord,wordFields("overlong",{title:"x".repeat(161)})],
    [createProject,projectFields("bad-url",{url:"http://example.com"})],
    [createProject,projectFields("bad-project-title",{title:"one\ntwo"})],
  ]) { const before=snapshot(env); const response=await handler(context(env,fields,{userId:null,origin:null})); assert.equal(response.status,400); assert.equal(snapshot(env),before); }
  const duplicateBefore=snapshot(env); assert.equal((await createWord(context(env,wordFields("word-1"),{userId:null,origin:null}))).status,409); assert.equal(snapshot(env),duplicateBefore);
  assert.equal((await mutateProject(context(env,projectFields("missing"),{id:"missing",userId:null,origin:null}))).status,404);
});

test("every mutation family denies production auth and Origin failures before any state write", async () => {
  const cases = [
    [createWord,wordFields("secure-word"),{}], [mutateWord,[["title","Title"],["text","Text"],["attribution","A"],["source",""]],{id:"missing"}],
    [createProject,projectFields("secure-project"),{}], [mutateProject,[["title","Title"],["description","Description"],["url","https://example.com"]],{id:"missing"}],
    [mutateHomepage,slots("word-selection","selectedWordIds",[TOLKIEN_WORD.id]),{}],
  ];
  for (const [handler,entries,extra] of cases) for (const denial of [
    {userId:null,origin:"https://georgehyde.dev"}, {userId:"wrong",origin:"https://georgehyde.dev"},
    {userId:"user_owner",origin:null}, {userId:"user_owner",origin:"https://evil.example"},
  ]) { const env=prodEnv(); const before=snapshot(env); const response=await handler(context(env,entries,{...extra,...denial})); assert.ok([401,403].includes(response.status)); assert.equal(snapshot(env),before); }
  const missingOwner=prodEnv({ADMIN_OWNER_USER_ID:""}); const before=snapshot(missingOwner); const response=await createWord(context(missingOwner,wordFields("x"))); assert.equal(response.status,403); assert.equal(snapshot(missingOwner),before);
});

test("Word and Project selection handlers remain independent under forced interleaving", async () => {
  const env=localEnv(); await bootstrapSiteContent(env); await createWord(context(env,wordFields("parallel-word"),{userId:null,origin:null})); await createProject(context(env,projectFields("parallel-project"),{userId:null,origin:null}));
  let arrivals=0; let release; const both=new Promise((resolve)=>{release=resolve;}); env.BLOG_POSTS.setBeforePut(async(key)=>{if(![HOMEPAGE_SELECTION_KEY,HOMEPAGE_PROJECT_SELECTION_KEY].includes(key))return; arrivals+=1;if(arrivals===2)release();await both;});
  const results=await Promise.all([mutateHomepage(context(env,slots("word-selection","selectedWordIds",["parallel-word"]),{userId:null,origin:null})),mutateHomepage(context(env,slots("project-selection","selectedProjectIds",["parallel-project"]),{userId:null,origin:null}))]);
  assert.deepEqual(results.map(({status})=>status),[303,303]); assert.deepEqual((await getHomepageSelection(env)).selectedWordIds,["parallel-word"]); assert.deepEqual((await getHomepageProjectSelection(env)).selectedProjectIds,["parallel-project"]); assert.equal(arrivals,2);
});

test("admin routes reject unsupported methods and source uses only canonical helpers/forms/navigation", async () => {
  for (const all of [wordsAll,wordAll,projectsAll,projectAll,homepageAll]) { const response=all(); assert.equal(response.status,405); assert.equal(response.headers.get("Allow"),"POST"); }
  const paths=["src/pages/admin/index.astro","src/pages/admin/homepage.astro","src/pages/admin/words/index.astro","src/pages/admin/words/new.astro","src/pages/admin/words/[id]/edit.astro","src/pages/admin/projects/index.astro","src/pages/admin/projects/new.astro","src/pages/admin/projects/[id]/edit.astro","src/pages/admin/api/homepage.ts","src/pages/admin/api/words/index.ts","src/pages/admin/api/words/[id].ts","src/pages/admin/api/projects/index.ts","src/pages/admin/api/projects/[id].ts"];
  const source=(await Promise.all(paths.map((path)=>readFile(new URL(`../${path}`,import.meta.url),"utf8")))).join("\n");
  for (const required of ["Manage Words","Manage Projects","Homepage settings","selectedWordIds","selectedProjectIds","validateWordInput","validateProjectInput","bootstrapSiteContent"]) assert.match(source,new RegExp(required));
  assert.doesNotMatch(source,/BLOG_POSTS\.(?:get|put|delete|list)|["']site:homepage|["']project:/);
  assert.doesNotMatch(source,/fetch\s*\(|localStorage|sessionStorage|client:/);
  assert.match(source,/name="title"/); assert.match(source,/maxlength="160"/);
});
