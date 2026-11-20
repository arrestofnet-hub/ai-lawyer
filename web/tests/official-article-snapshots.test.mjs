import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {fileURLToPath} from "node:url";
import {loadOfficialRegistry} from "../legal/sources.mjs";
import {loadArticleSnapshots,validateArticleSnapshot,validateArticleSnapshots,
 retrieveArticleSnapshots,buildArticleSnapshotContext,articleSnapshotStatus}
 from "../legal/snapshots.mjs";
import {auditSourceSnapshotDrift} from "../legal/snapshot-drift.mjs";

const registry=loadOfficialRegistry(fileURLToPath(
 new URL("../legal/official-sources.json",import.meta.url)));
const snapshots=loadArticleSnapshots(fileURLToPath(
 new URL("../legal/source-snapshots.json",import.meta.url)),registry);
const S="2026-11-20";
const options=(q)=>({asOf:S,maxAgeDays:0,relatedActIds:q?["Z100000261_"]:[]});

test("33 official Adilet page snapshots for ГПК АППК ЧСИ and нотариат retain provenance",()=>{
  assert.equal(snapshots.length,33);
  assert.deepEqual([...new Set(snapshots.map(x=>x.actId))].sort(),
    ["K1400000231","K1400000235","K1500000377","K2000000350","Z100000261_","Z970000155_"].sort());
  assert.deepEqual(articleSnapshotStatus(snapshots),{
    snapshotArticles:33,snapshotLastCapture:S,snapshotEditionsVerified:0});
  for(const record of snapshots){
    assert.equal(record.effectiveDateVerified,false);
    assert.equal(record.editionDateVerified,false);
    assert.match(record.canonicalUrl,/^https:\/\/adilet\.zan\.kz\/rus\/docs\//);
    assert.match(record.capturedFrom,/^https:\/\/old\.adilet\.zan\.kz\/rus\/docs\//);
    assert.equal(record.sha256,
      crypto.createHash("sha256").update(record.text).digest("hex"));
    assert.equal(record.snapshotDate,S);
    assert.equal(record.text.startsWith(record.article),true);
  }
  assert.ok(snapshots.some(x=>x.article.includes("Статья 92-1")));
  assert.ok(snapshots.some(x=>x.article.includes("Статья 64")));
});

test("source-snapshot validation refuses unknown law, spoofed source, fabricated validity and incomplete article",()=>{
  const example=snapshots[0];
  assert.throws(()=>validateArticleSnapshot({...example,actId:"Z000000000_"},registry),/known/);
  assert.throws(()=>validateArticleSnapshot({...example,
    capturedFrom:"https://attacker.invalid/rus/docs/"+example.actId},registry),/Untrusted/);
  assert.throws(()=>validateArticleSnapshot({...example,
    canonicalUrl:"https://adilet.zan.kz.attacker.invalid/rus/docs/"+example.actId},registry),/Untrusted/);
  assert.throws(()=>validateArticleSnapshot({...example,
    effectiveDateVerified:true},registry),/may not claim/);
  assert.throws(()=>validateArticleSnapshot({...example,
    editionDateVerified:true},registry),/may not claim/);
  assert.throws(()=>validateArticleSnapshot({...example,
    text:example.text+"\nСтатья 999. Вымышленный заголовок"},registry),/multiple articles/);
  assert.throws(()=>validateArticleSnapshots([example,example],registry),/Duplicate/);
});
test("cross-date historical law questions never receive modern source snapshots",()=>{
  const q="постановление судебного исполнителя";
  assert.ok(retrieveArticleSnapshots(snapshots,q,options()).length>0);
  assert.deepEqual(retrieveArticleSnapshots(snapshots,q,{asOf:"2026-11-19"}),[]);
  assert.deepEqual(retrieveArticleSnapshots(snapshots,q,{asOf:"2026-12-31"}),[]);
  assert.deepEqual(retrieveArticleSnapshots(snapshots,q+" от 2024 года",options()),[]);
  assert.deepEqual(retrieveArticleSnapshots(snapshots,q+" 15.10.2026",options()),[]);
  assert.deepEqual(retrieveArticleSnapshots(snapshots,q+" 2026-10-15",options()),[]);
  assert.deepEqual(retrieveArticleSnapshots(snapshots,q+" 2026-11-21",options()),[]);
});
test("source snapshots can be retrieved via trusted law abbreviations and explanatory queries",()=>{
  const chsi=retrieveArticleSnapshots(snapshots,"ЧСИ",options("chsi"));
  assert.ok(chsi.some(x=>x.actId==="Z100000261_"));
  const notary=retrieveArticleSnapshots(snapshots,"исполнительная надпись нотариуса",{
    asOf:S,relatedActIds:["Z970000155_"],limit:5});
  assert.ok(notary.some(x=>x.article.includes("92-1")));
  const gpk=retrieveArticleSnapshots(snapshots,"доказательство суд исследует оценивает",{
    asOf:S,relatedActIds:["K1500000377"],limit:5});
  assert.ok(gpk.some(x=>x.actId==="K1500000377"));
  const context=buildArticleSnapshotContext(snapshots,"Судебные исполнители постановление",options());
  assert.match(context,/НЕ ПОДТВЕРЖДЁННАЯ ИСТОРИЧЕСКАЯ РЕДАКЦИЯ/);
  assert.match(context,/SHA256 текста/);
  assert.match(context,/https:\/\/adilet\.zan\.kz/);
  assert.ok(context.length<16000);
  assert.equal(buildArticleSnapshotContext(snapshots,"ЧСИ 2024",options("chsi")),"");
});

test("official-source drift audit detects silent changes and never auto-publishes",()=>{
  const one=snapshots.filter(x=>x.actId==="Z100000261_");
  const complete=one.map(x=>x.text).join("\n\n");
  const unchanged=auditSourceSnapshotDrift(snapshots,"Z100000261_",complete);
  assert.equal(unchanged.unchanged,one.length);
  assert.equal(unchanged.changed,0);
  assert.equal(unchanged.cannotVerify,0);
  assert.equal(unchanged.requiresReview,false);
  assert.equal(unchanged.autoPublish,false);
  const changed=auditSourceSnapshotDrift(snapshots,"Z100000261_",
    complete.replace("восстановление нарушенных прав","восстановление иных прав"));
  assert.equal(changed.changed,1);
  assert.equal(changed.requiresReview,true);
  assert.equal(changed.autoPublish,false);
  const missing=auditSourceSnapshotDrift(snapshots,"Z100000261_",one[0].text);
  assert.equal(missing.cannotVerify,one.length-1);
  assert.throws(()=>auditSourceSnapshotDrift(snapshots,"UNKNOWN","Статья 1. A\nSome sufficiently long contents"),/No snapshots/);
});
