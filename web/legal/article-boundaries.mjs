// Shared legal article boundaries for the HTML layout of official Әділет.
// A new chapter/section heading ends the preceding article even if the next
// <p><b>Статья ...</b></p> starts later. Otherwise chapter footnotes and
// changes may be incorrectly attributed to the final article in a chapter.
const ARTICLE_HEADING=/<p\b[^>]*>\s*<b\b[^>]*>\s*(?:<a\b[^>]*\bname=["'](z\d+)["'][^>]*>\s*<\/a>\s*)?Статья\s+(\d+(?:-\d+)?)\.\s*[^<]{3,180}<\/b>\s*<\/p>/gi;
const SECTION_BOUNDARY=/<h[1-6]\b[^>]*>/i;

export function extractOfficialArticleBlocks(html,{maxBytes=8500000}={}){
  if(typeof html!=="string"||html.length<500||html.length>maxBytes)
    throw Error("Invalid official article HTML length");
  const body=html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  if(!body||body.length<300)throw Error("Official article container missing");
  const headings=[...body.matchAll(ARTICLE_HEADING)];
  if(headings.length<2)throw Error("Full official act text required");
  return headings.map((h,i)=>{
    const next=headings[i+1]?.index??body.length;
    const region=body.slice(h.index,next);
    const separator=region.search(SECTION_BOUNDARY);
    const htmlBlock=separator<0?region:region.slice(0,separator);
    return {article:h[2],anchor:h[1]||null,html:htmlBlock};
  });
}
