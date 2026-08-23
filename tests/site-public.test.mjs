/**
 * @decision DEC-SCV2-008
 * @title Prove SSR collections and DOM-only manual carousels
 * @status accepted
 * @rationale Source and production-helper sequences prove bounded selected data,
 *   full collection pages, escaped expressions, stable geometry, and a tiny
 *   client index that wraps and resets only the reading viewport.
 */
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import {
  TOLKIEN_WORD, bootstrapSiteContent, createProject, createWord,
  getHomepageContent, getLatestPublishedPostPreview, listProjects, listWords,
  updateHomepageProjectSelection, updateHomepageSelection,
} from "../src/lib/site-content.ts";
import { putBlogPost } from "../src/lib/kv-store.ts";
const file = (path) => new URL(`../${path}`, import.meta.url);
function kv() { const records=new Map(); return { async get(key,options){const item=records.get(key);if(!item)return null;return options?.type==="json"?JSON.parse(item.value):item.value;},async put(key,value,options={}){records.set(key,{value,metadata:options.metadata});},async delete(key){records.delete(key);},async list({prefix="",cursor}={}){const start=cursor?Number(cursor):0;const keys=[...records.entries()].filter(([key])=>key.startsWith(prefix)).sort(([a],[b])=>a.localeCompare(b)).map(([name,item])=>({name,metadata:item.metadata}));const page=keys.slice(start,start+2);const next=start+2;return{keys:page,list_complete:next>=keys.length,cursor:next>=keys.length?undefined:String(next)}}}; }
const envFor=()=>({BLOG_POSTS:kv()});

test("public sources use canonical SSR helpers, escaped expressions, exact order, and retained navigation", async () => {
  const [home,words,projects,blog,detail]=await Promise.all(["src/pages/index.astro","src/pages/words/index.astro","src/pages/projects/index.astro","src/pages/blog/index.astro","src/pages/blog/[slug].astro"].map((path)=>readFile(file(path),"utf8")));
  for(const source of [home,words,projects]) { assert.match(source,/export const prerender = false/); assert.match(source,/cloudflare:workers/); assert.doesNotMatch(source,/set:html|client:|fetch\s*\(/i); }
  assert.match(home,/bootstrapSiteContent\(env\)/); assert.match(home,/getLatestPublishedPostPreview\(env\)/);
  assert.match(home,/selectedWords\.map\(\(word, index\)/); assert.match(home,/selectedProjects\.map\(\(project, index\)/);
  for(const expression of ["{word.title}","{word.text}","{word.attribution}","{project.title}","{project.description}","href={project.url}","{latestPost.excerpt}"]) assert.ok(home.includes(expression));
  const latest=home.indexOf(">Latest Blog Post<"), wordSection=home.indexOf(">Words I Like<"), projectSection=home.indexOf(">Featured Projects<"); assert.ok(latest>=0&&latest<wordSection&&wordSection<projectSection);
  for(const link of ['href="/words"','href="/projects"','href="/blog"','href="https://github.com/georgehyde-dot"','href="mailto:hello@georgehyde.dev"']) assert.ok(home.includes(link));
  assert.match(home,/No published posts yet\./); assert.match(blog,/href="\/"[\s\S]*Home/); assert.match(detail,/href="\/" class="back-link">Home/);
  assert.match(words,/await listWords\(env\)/); assert.match(projects,/await listProjects\(env\)/); assert.match(words,/id=\{`word-\$\{word\.id\}`\}/); assert.match(projects,/id=\{`project-\$\{project\.id\}`\}/);
  assert.doesNotMatch(home+words+projects,/TOLKIEN_WORD|INITIAL_FEATURED_PROJECT|FEATURED_PROJECT_KEY/);
});

test("real canonical sequence returns only selected five in server order while collection lists include sixth", async () => {
  const env=envFor(); await bootstrapSiteContent(env);
  for(let i=1;i<=6;i+=1){await createWord(env,{id:`word-${i}`,title:`Word <${i}> & title`,text:`Line ${i}\n<script>${i}</script>`,attribution:`Writer & ${i}`,source:null},`2026-08-23T0${i}:00:00.000Z`);await createProject(env,{id:`project-${i}`,title:`Project <${i}>`,description:`Description ${i}\n<script>${i}</script>`,url:`https://example.com/project-${i}`},`2026-08-23T0${i}:00:00.000Z`);}
  const wordOrder=["word-5",TOLKIEN_WORD.id,"word-2","word-4","word-1"], projectOrder=["project-5","featured-project","project-2","project-4","project-1"];
  await updateHomepageSelection(env,wordOrder); await updateHomepageProjectSelection(env,projectOrder);
  await putBlogPost(env,{slug:"older",title:"Older",body:"<p>Older</p>",author:"George Hyde",createdAt:"2026-08-20T00:00:00.000Z",updatedAt:"2026-08-20T00:00:00.000Z",published:true});
  await putBlogPost(env,{slug:"newest",title:"Newest <Post>",body:"<p>First &amp; newest.</p>",author:"George Hyde",createdAt:"2026-08-22T00:00:00.000Z",updatedAt:"2026-08-22T00:00:00.000Z",published:true});
  await putBlogPost(env,{slug:"draft",title:"Draft",body:"<p>Draft</p>",author:"George Hyde",createdAt:"2026-08-24T00:00:00.000Z",updatedAt:"2026-08-24T00:00:00.000Z",published:false});
  const [content,words,projects,preview]=await Promise.all([getHomepageContent(env),listWords(env),listProjects(env),getLatestPublishedPostPreview(env)]);
  assert.deepEqual(content.selectedWords.map(({id})=>id),wordOrder); assert.deepEqual(content.selectedProjects.map(({id})=>id),projectOrder);
  assert.ok(words.some(({id})=>id==="word-6")); assert.ok(projects.some(({id})=>id==="project-6")); assert.equal(content.selectedWords.some(({id})=>id==="word-6"),false); assert.equal(content.selectedProjects.some(({id})=>id==="project-6"),false);
  assert.deepEqual(preview,{slug:"newest",title:"Newest <Post>",excerpt:"First & newest."});
});

test("both stable top-controlled carousels show first without JS, manually wrap, announce, and reset viewport", async () => {
  const home=await readFile(file("src/pages/index.astro"),"utf8");
  assert.equal((home.match(/data-carousel data-carousel-label=/g)??[]).length,2); assert.match(home,/hidden=\{index !== 0\}/); assert.match(home,/aria-label="Previous Word"/); assert.match(home,/aria-label="Next Project"/); assert.match(home,/aria-live="polite"/); assert.match(home,/height:\s*14rem/); assert.match(home,/overflow:\s*auto/); assert.match(home,/scrollbar-gutter:\s*stable/); assert.match(home,/viewport\.scrollTop = 0/);
  assert.doesNotMatch(home,/setInterval|setTimeout|autoplay|auto-rotate|localStorage|sessionStorage|indexedDB|document\.cookie|location\.|history\.|fetch\s*\(/i);
  const script=home.match(/<script is:inline>([\s\S]*?)<\/script>/)?.[1]; assert.ok(script);
  function carousel(label,count){const slides=Array.from({length:count},()=>({hidden:false}));const handlers={};const viewport={scrollTop:88};const previous={disabled:false,addEventListener(_type,handler){handlers.previous=handler;}};const next={disabled:false,addEventListener(_type,handler){handlers.next=handler;}};const status={textContent:""};return{dataset:{carouselLabel:label},slides,handlers,viewport,previous,next,status,querySelectorAll(selector){assert.equal(selector,"[data-carousel-slide]");return slides;},querySelector(selector){return{"[data-carousel-viewport]":viewport,"[data-carousel-previous]":previous,"[data-carousel-next]":next,"[data-carousel-status]":status}[selector];}};}
  const words=carousel("Word",3),projects=carousel("Project",1);runInNewContext(script,{document:{querySelectorAll:()=>[words,projects]}});
  assert.deepEqual(words.slides.map(({hidden})=>hidden),[false,true,true]);assert.equal(words.viewport.scrollTop,0);assert.equal(words.status.textContent,"Word 1 of 3");words.viewport.scrollTop=55;words.handlers.previous();assert.deepEqual(words.slides.map(({hidden})=>hidden),[true,true,false]);assert.equal(words.viewport.scrollTop,0);words.handlers.next();assert.deepEqual(words.slides.map(({hidden})=>hidden),[false,true,true]);
  assert.equal(projects.previous.disabled,true);assert.equal(projects.next.disabled,true);assert.equal(projects.status.textContent,"Project 1 of 1");
});

test("Words index is sticky, responsive, stable-anchor/focus capable, multiline safe, and Projects is full responsive collection", async () => {
  const [words,projects]=await Promise.all([readFile(file("src/pages/words/index.astro"),"utf8"),readFile(file("src/pages/projects/index.astro"),"utf8")]);
  for(const required of [/class="title-index"/,/aria-label="Words index"/,/href=\{`#word-\$\{word\.id\}`\}/,/tabindex="-1"/,/position:\s*sticky/,/scroll-margin-top/,/data-index-link/,/\.focus\(\{ preventScroll: true \}\)/,/@media \(max-width: 760px\)/]) assert.match(words,required);
  for(const source of [words,projects]){assert.match(source,/overflow-wrap:\s*anywhere/);assert.match(source,/white-space:\s*pre-wrap/);assert.match(source,/@media\(max-width:560px\)|@media \(max-width: 560px\)/);}
  assert.match(words,/\{word\.title\}/);assert.match(projects,/projects\.map\(\(project\)/);assert.match(projects,/\{project\.description\}/);assert.match(projects,/href=\{project\.url\}/);
});

test("progress remains a true missing route and every named legacy surface stays absent", async () => {
  const source=(await Promise.all(["src/pages/index.astro","src/pages/words/index.astro","src/pages/projects/index.astro"].map((path)=>readFile(file(path),"utf8")))).join("\n");
  for(const forbidden of ["Work in Progress","Quote of the Day","Current Thoughts","Recent Project","GitHub Activity","api.github","ghchart","contribution","progress-orb","progress-indicator","project-modal","showProjectModal","/progress"])assert.doesNotMatch(source,new RegExp(forbidden,"i"));
  await assert.rejects(access(file("src/pages/progress.astro")),(error)=>error?.code==="ENOENT");
});
