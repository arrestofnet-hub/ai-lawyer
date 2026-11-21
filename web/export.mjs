// Server-side Word/PDF exports of the selected assistant message.
// Only the authenticated case owner can invoke these from server.mjs.
import fs from "node:fs";
import {
  Document, Packer, Paragraph, TextRun, ExternalHyperlink, Table, TableRow, TableCell,
  WidthType
} from "docx";
import { PDFDocument } from "pdfkit";
import { numberedExportBlocks, inlineTokens, plainText } from "./format.mjs";
import {officialExportReferences} from "./legal/export-references.mjs";

const cm=28.3464566929;
const wordMargin={left:1701,right:567,top:1417,bottom:1134};
function runs(text) {
  return inlineTokens(text).map(token=>new TextRun({
    text:token.text,font:"Times New Roman",size:28,
    bold:token.kind==="strong",italics:token.kind==="em",
  }));
}
function p(text,{bold=false,indent=true,after=115}={}) {
  return new Paragraph({
    children:bold?[new TextRun({text:plainText(text),bold:true,font:"Times New Roman",size:28})]:runs(text),
    spacing:{line:322,after}, indent:indent?{firstLine:709}:undefined,
  });
}
export async function exportDocx(markdown,{sources=[]}={}) {
  const blocks=numberedExportBlocks(markdown);
  const content=[];
  for(const block of blocks) {
    if(block.kind==="heading") {
      content.push(p(block.text,{bold:true,indent:false,after:150}));
    } else if(block.kind==="ordered"||block.kind==="bullets") {
      block.items.forEach((item,i)=>{
        const prefix=block.kind==="ordered"?String(block.numbers?.[i]||i+1)+". ":"• ";
        content.push(p(prefix+item,{indent:false,after:65}));
      });
    } else if(block.kind==="table") {
      const rowValues=[block.headers,...block.rows];
      const rows=rowValues.map((row,rowIndex)=>new TableRow({
        children:block.headers.map((_,index)=>new TableCell({
          children:[p(row[index]||"",{indent:false,bold:rowIndex===0,after:50})]
        }))
      }));
      content.push(new Table({rows,width:{size:100,type:WidthType.PERCENTAGE}}));
      content.push(p("",{indent:false,after:60}));
    } else if(block.kind==="rule") {
      content.push(p("",{indent:false,after:50}));
    } else if(block.kind==="code"||block.kind==="quote") {
      content.push(p(block.text,{indent:false}));
    } else {
      const parts=block.text.split("\n");
      parts.forEach((part,i)=>content.push(p(part,{indent:i===0,after:i===parts.length-1?115:0})));
    }
  }
  const officialRefs=officialExportReferences(markdown,sources);
  if(officialRefs.length){
    content.push(p("Официальные источники для сверки редакции:",{indent:false,bold:true,after:55}));
    content.push(p("Приведены справочно; дата действия каждой нормы определяется отдельно.",{indent:false,after:55}));
    for(const r of officialRefs){
      content.push(new Paragraph({
        children:[
          new TextRun({text:r.label+": ",font:"Times New Roman",size:22}),
          new ExternalHyperlink({children:[
            new TextRun({text:r.url,style:"Hyperlink",font:"Times New Roman",size:22})
          ],link:r.url})
        ],
        spacing:{line:280,after:70}
      }));
    }
  }
  if(!content.length)content.push(p("Документ пуст.",{indent:false}));
  const doc=new Document({
    creator:"AI Lawyer Kazakhstan",
    title:"Юридический документ",
    description:"Пользовательский экспорт ответа AI Lawyer Kazakhstan",
    sections:[{properties:{page:{
      size:{width:11906,height:16838},margin:wordMargin,
    }},children:content}],
  });
  return Packer.toBuffer(doc);
}

const regularFontCandidates=[
  "/usr/share/fonts/truetype/msttcorefonts/Times_New_Roman.ttf",
  "/usr/share/fonts/truetype/msttcorefonts/times.ttf",
  "/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
  "/usr/share/fonts/truetype/noto/NotoSerif-Regular.ttf",
];
const boldFontCandidates=[
  "/usr/share/fonts/truetype/msttcorefonts/Times_New_Roman_Bold.ttf",
  "/usr/share/fonts/truetype/msttcorefonts/timesbd.ttf",
  "/usr/share/fonts/truetype/liberation2/LiberationSerif-Bold.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
  "/usr/share/fonts/truetype/noto/NotoSerif-Bold.ttf",
];
function fontPath(override,candidates) {
  if(override && fs.existsSync(override))return override;
  return candidates.find(p=>fs.existsSync(p));
}
export async function exportPdf(markdown,{sources=[]}={}) {
  const normal=fontPath(process.env.PDF_FONT_REGULAR,regularFontCandidates);
  if(!normal) {
    const err=new Error("Для создания PDF на сервере нужно установить шрифты с поддержкой кириллицы: fonts-dejavu-core");
    err.status=503;throw err;
  }
  const bold=fontPath(process.env.PDF_FONT_BOLD,boldFontCandidates)||normal;
  const pdf=new PDFDocument({
    size:"A4",
    margins:{left:3*cm,right:1*cm,top:2.5*cm,bottom:2*cm},
    bufferPages:false,info:{Title:"Юридический документ",Author:"AI Lawyer Kazakhstan"}
  });
  const output=new Promise((resolve,reject)=>{
    const chunks=[];
    pdf.on("data",chunk=>chunks.push(chunk));
    pdf.on("end",()=>resolve(Buffer.concat(chunks)));
    pdf.on("error",reject);
  });
  pdf.registerFont("main",normal);
  pdf.registerFont("bold",bold);
  const marginLeft=3*cm;
  const usableWidth=pdf.page.width-(4*cm);
  function ensurePage(height=35) {
    if(pdf.y+height>pdf.page.height-2*cm) pdf.addPage();
  }
  function sectionText(text,{heading=false,indent=false,prefix="",size=14}={}){
    ensurePage();
    pdf.font(heading?"bold":"main").fontSize(size).fillColor("#151515");
    const options={width:usableWidth,lineGap:2,paragraphGap:heading?10:7,align:heading?"left":"justify",indent:indent?1.25*cm:0};
    pdf.text(prefix+plainText(text),marginLeft,pdf.y,options);
    pdf.moveDown(heading?0.25:0.12);
  }
  function drawTable(block) {
    const n=block.headers.length;
    if(!n) return;
    const colWidth=usableWidth/n;
    const data=[block.headers,...block.rows];
    for(let i=0;i<data.length;i++) {
      const row=data[i];
      pdf.font(i===0?"bold":"main").fontSize(10);
      const height=Math.max(28,...row.slice(0,n).map(t=>pdf.heightOfString(String(t||""),{
        width:colWidth-12,lineGap:1
      })+12));
      ensurePage(Math.min(height,450));
      const y=pdf.y;
      if(i===0)pdf.fillColor("#edf1f7").rect(marginLeft,y,usableWidth,height).fill();
      for(let col=0;col<n;col++) {
        const x=marginLeft+col*colWidth;
        pdf.lineWidth(0.45).strokeColor("#c7ced7").rect(x,y,colWidth,height).stroke();
        pdf.font(i===0?"bold":"main").fillColor("#151515").fontSize(10);
        pdf.text(String(row[col]||""),x+6,y+6,{
          width:colWidth-12,height:height-10,lineGap:1
        });
      }
      pdf.y=y+height;
    }
    pdf.moveDown(0.45);
  }
  for(const block of numberedExportBlocks(markdown)){
    if(block.kind==="heading")sectionText(block.text,{heading:true});
    else if(block.kind==="ordered"||block.kind==="bullets"){
      block.items.forEach((t,i)=>sectionText(t,{prefix:block.kind==="ordered"?(block.numbers?.[i]||i+1)+". ":"• "}));
    }
    else if(block.kind==="table")drawTable(block);
    else if(block.kind==="rule"){
      ensurePage(16);
      pdf.moveDown(0.25);
      pdf.lineWidth(0.35).strokeColor("#aaaaaa")
        .moveTo(marginLeft,pdf.y).lineTo(marginLeft+usableWidth,pdf.y).stroke();
      pdf.moveDown(0.3);
    }
    else if(block.kind==="code"||block.kind==="quote")sectionText(block.text,{size:12});
    else block.text.split("\n").forEach((line,i)=>sectionText(line,{indent:i===0}));
  }
  const officialRefs=officialExportReferences(markdown,sources);
  if(officialRefs.length){
    // Preserve bibliography as one block whenever it can fit on a new page:
    // the previous implementation stranded a two-link header on page 7.
    pdf.font("main").fontSize(9.3);
    const entryHeights=officialRefs.map(item=>
      pdf.heightOfString(item.label+": "+item.url,{
        width:usableWidth,align:"left",lineGap:1
      })+5);
    const totalHeight=60+entryHeights.reduce((a,b)=>a+b,0);
    const pageContentHeight=pdf.page.height-4.5*cm;
    const remaining=pdf.page.height-2*cm-pdf.y;
    if(totalHeight<=pageContentHeight && totalHeight>remaining)pdf.addPage();
    else ensurePage(65);
    pdf.moveDown(0.35);
    pdf.font("bold").fontSize(11).fillColor("#151515")
      .text("Официальные источники для сверки редакции",marginLeft,pdf.y,{
        width:usableWidth,align:"left"
      });
    pdf.moveDown(0.15);
    pdf.font("main").fontSize(9).fillColor("#151515")
      .text("Ссылки указаны справочно. Дату действия редакции необходимо проверить отдельно.",{
        width:usableWidth,align:"left"
      });
    pdf.moveDown(0.18);
    for(const item of officialRefs){
      ensurePage(entryHeights[officialRefs.indexOf(item)]+4);
      pdf.font("main").fontSize(9.3).fillColor("#151515");
      pdf.text(item.label+": "+item.url,marginLeft,pdf.y,{
        width:usableWidth,align:"left",lineGap:1,link:item.url
      });
      pdf.moveDown(0.1);
    }
  }
  pdf.end();
  return output;
}
