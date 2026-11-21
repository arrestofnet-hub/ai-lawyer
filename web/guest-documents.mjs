// Guest document selection and ownership checks. Guest files are encrypted by
// the existing Store and never expose their bytes through a public GET route.
export const GUEST_ATTACH_LIMIT = 3;
export const GUEST_ATTACH_TOTAL_BYTES = 1500000;

export function guestOwnedDocuments(db, guestHash) {
  if(typeof guestHash!=="string"||!guestHash)return [];
  return (db.documents||[]).filter(d=>
    d.guestHash===guestHash && !d.caseId && !d.ownerId);
}

export function selectGuestDocuments(db, guestHash, docIds) {
  if(!Array.isArray(docIds) || docIds.length>GUEST_ATTACH_LIMIT ||
      !docIds.every(id=>typeof id==="string"&&/^[a-f0-9-]{36}$/i.test(id)))
    throw Object.assign(new Error("Выберите не более трёх документов"),{status:400});
  const ids=[...new Set(docIds)];
  if(ids.length!==docIds.length)
    throw Object.assign(new Error("Повторные идентификаторы документов"),{status:400});
  const owned=guestOwnedDocuments(db,guestHash);
  const docs=ids.map(id=>owned.find(d=>d.id===id));
  if(docs.some(d=>!d))
    throw Object.assign(new Error("Документ не найден в вашем гостевом чате"),{status:404});
  const size=docs.reduce((sum,d)=>sum+d.size,0);
  if(size>GUEST_ATTACH_TOTAL_BYTES)
    throw Object.assign(new Error("Для гостевого анализа общий размер выбранных файлов не должен превышать 1,5 МБ. Для большего объёма войдите в кабинет."),{status:413});
  return docs;
}

export function transferGuestDocuments(db,guestHash,ownerId,caseId){
  const docs=guestOwnedDocuments(db,guestHash);
  for(const d of docs){
    delete d.guestHash;
    d.caseId=caseId;
    d.ownerId=ownerId;
  }
  return docs.length;
}

// Called when expired guest sessions are pruned. This prevents orphaned
// encrypted attachments from remaining indefinitely after the guest expires.
export function pruneOrphanedGuestDocuments(store,activeGuestHashes){
  const all=store.db.documents||[];
  const expired=all.filter(d=>d.guestHash&&!activeGuestHashes.has(d.guestHash)&&!d.caseId);
  if(!expired.length)return 0;
  for(const d of expired)store.deleteFile(d.id);
  const ids=new Set(expired.map(d=>d.id));
  store.db.documents=all.filter(d=>!ids.has(d.id));
  return expired.length;
}
