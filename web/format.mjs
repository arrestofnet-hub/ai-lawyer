// Shared, safe subset of Markdown used for client display and document exports.
// The UI creates DOM nodes with textContent; this parser never treats AI output as HTML.
export function inlineTokens(value) {
  const text=String(value||"");
  const re=/\[([^\]]{1,200})\]\((https?:\/\/[^\s)]+)\)|\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`|\*([^*\n]+)\*/g;
  const out=[]; let start=0, match;
  while((match=re.exec(text))!==null) {
    if(match.index>start) out.push({kind:"text",text:text.slice(start,match.index)});
    if(match[1]) out.push({kind:"link",text:match[1],url:match[2]});
    else if(match[3]||match[4]) out.push({kind:"strong",text:match[3]||match[4]});
    else if(match[5]) out.push({kind:"code",text:match[5]});
    else out.push({kind:"em",text:match[6]});
    start=re.lastIndex;
  }
  if(start<text.length) out.push({kind:"text",text:text.slice(start)});
  return out.length?out:[{kind:"text",text}];
}
export function plainText(value) {
  return inlineTokens(value).map(t=>t.text).join("").replace(/\\([\\*_`])/g,"$1");
}
function cells(line) {
  return line.trim().replace(/^\|/,"").replace(/\|$/,"").split("|").map(s=>plainText(s.trim()));
}
const divider = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/;
const heading = /^\s*(#{1,4})\s+(.*)$/;
const list = /^\s*(?:([-*•])\s+|(\d+)[.)]\s+)(.+)$/;
export function parseLegalMarkdown(input) {
  const lines=String(input||"").replace(/\r\n?/g,"\n").split("\n");
  const blocks=[];
  let i=0;
  while(i<lines.length){
    const current=lines[i];
    if(!current.trim()){i++;continue;}
    if(/^\s*`{3}/.test(current)){
      i++;const out=[];
      while(i<lines.length&&!/^\s*`{3}/.test(lines[i])) out.push(lines[i++]);
      if(i<lines.length) i++;
      blocks.push({kind:"code",text:out.join("\n")});continue;
    }
    if(i+1<lines.length && current.includes("|") && divider.test(lines[i+1])){
      const rows=[];const headers=cells(current);i+=2;
      while(i<lines.length&&lines[i].includes("|")&&lines[i].trim()){
        rows.push(cells(lines[i++]));if(rows.length>=200)break;
      }
      blocks.push({kind:"table",headers,rows});continue;
    }
    const h=current.match(heading);
    if(h){blocks.push({kind:"heading",level:h[1].length,text:plainText(h[2])});i++;continue;}
    const l=current.match(list);
    if(l){
      const ordered=!!l[2],items=[];
      while(i<lines.length){
        const m=lines[i].match(list);
        if(!m||!!m[2]!==ordered)break;
        items.push(plainText(m[3]));i++;
      }
      blocks.push({kind:ordered?"ordered":"bullets",items});continue;
    }
    if(/^\s*>\s?/.test(current)){
      const out=[];
      while(i<lines.length&&/^\s*>\s?/.test(lines[i]))out.push(lines[i++].replace(/^\s*>\s?/,""));
      blocks.push({kind:"quote",text:out.join("\n")});continue;
    }
    const paragraph=[];
    while(i<lines.length&&lines[i].trim()){
      if(paragraph.length&&(heading.test(lines[i])||list.test(lines[i])||/^\s*`{3}/.test(lines[i])))break;
      if(paragraph.length&&i+1<lines.length&&divider.test(lines[i+1]))break;
      paragraph.push(lines[i++].trim());
    }
    blocks.push({kind:"paragraph",text:paragraph.join("\n")});
  }
  return blocks;
}

export function plainLegalText(markdown) {
  const result=[];
  for(const block of parseLegalMarkdown(markdown)){
    if(block.kind==="table"){
      result.push(block.headers.join("\t"));
      for(const row of block.rows)result.push(row.join("\t"));
      result.push("");
    } else if(block.kind==="ordered"||block.kind==="bullets"){
      block.items.forEach((item,i)=>result.push((block.kind==="ordered"?(i+1)+". ":"• ")+item));
      result.push("");
    } else {
      result.push(plainText(block.text),"");
    }
  }
  return result.join("\n").trim();
}
