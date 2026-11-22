// Shared legal article boundaries for the HTML layout of official Әділет.
// A new chapter/section heading ends the preceding article even if the next
// <p><b>Статья ...</b></p> starts later. Otherwise chapter footnotes and
// changes may be incorrectly attributed to the final article in a chapter.
const ARTICLE_HEADING=/<p\b[^>]*>\s*<b\b[^>]*>\s*(?:<a\b[^>]*\bname=["'](z\d+)["'][^>]*>\s*<\/a>\s*)?Статья\s+(\d+(?:-\d+)?)\.\s*[^<]{3,180}<\/b>\s*<\/p>/gi;
// Newer official Әділет documents (including the 1994 Civil Code) render
// statutory articles as <h3 id="z716"> Статья 339. ... </h3>. The earlier
// regex only understood legacy <p><b><a name="z..."> markup and silently
// returned no articles although the full official page was loaded.
const H3_ARTICLE_HEADING=/<h([1-6])\b[^>]*\bid=["'](z\d+)["'][^>]*>\s*Статья\s+(\d+(?:-\d+)?)\.\s*[^<]{3,180}\s*<\/h\1>/gi;
const SECTION_BOUNDARY=/<h[1-6]\b[^>]*>/i;

export function extractOfficialArticleBlocks(html,{maxBytes=8500000}={}){
  if(typeof html!=="string"||html.length<500||html.length>maxBytes)
    throw Error("Invalid official article HTML length");
  const body=html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  if(!body||body.length<300)throw Error("Official article container missing");
  const headings=[
    ...[...body.matchAll(ARTICLE_HEADING)].map(m=>({
      index:m.index,headLength:m[0].length,article:m[2],anchor:m[1]||null
    })),
    ...[...body.matchAll(H3_ARTICLE_HEADING)].map(m=>({
      index:m.index,headLength:m[0].length,article:m[3],anchor:m[2]
    }))
  ].sort((a,b)=>a.index-b.index);
  if(headings.length<2)throw Error("Full official act text required");
  return headings.map((h,i)=>{
    const next=headings[i+1]?.index??body.length;
    const region=body.slice(h.index,next);
    // An <h3> article heading is itself a section heading: skip only
    // this opening tag when searching for the NEXT chapter/section.
    const afterHeading=region.slice(h.headLength);
    const separator=afterHeading.search(SECTION_BOUNDARY);
    const htmlBlock=separator<0?region:region.slice(0,h.headLength+separator);
    return {article:h.article,anchor:h.anchor,html:htmlBlock};
  });
}
