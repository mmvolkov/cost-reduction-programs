import { jsPDF } from './vendor/report/jspdf.js';
import regular from './fonts/report/regular.js';
import bold from './fonts/report/bold.js';

export async function buildPdf(report) {
  const doc = new jsPDF({orientation:'portrait',unit:'pt',format:'a4',compress:true,putOnlyUsedFonts:true});
  doc.addFileToVFS('DejaVuSans.ttf',regular); doc.addFont('DejaVuSans.ttf','DejaVu','normal');
  doc.addFileToVFS('DejaVuSans-Bold.ttf',bold); doc.addFont('DejaVuSans-Bold.ttf','DejaVu','bold');
  doc.setProperties({title:'Программа снижения затрат',author:'Scout Argument',subject:'Расчётный сценарий и план',creator:'cost-reduction-programs'});
  const width=doc.internal.pageSize.getWidth(),height=doc.internal.pageSize.getHeight(),margin=48,bottom=height-48;let y=margin;
  const nextPage=()=>{doc.addPage();y=margin;};
  for(const block of report.blocks) {
    const style={title:{size:22,line:28,gap:16,bold:true},subtitle:{size:10,line:15,gap:14},heading:{size:14,line:20,gap:8,before:12,bold:true},subheading:{size:12,line:18,gap:7,before:8,bold:true},paragraph:{size:10.5,line:16,gap:6}}[block.type]||{size:10.5,line:16,gap:6};
    doc.setFont('DejaVu',style.bold?'bold':'normal');doc.setFontSize(style.size);
    doc.setTextColor(...(block.type==='heading'?[0,130,65]:block.type==='subtitle'?[71,85,105]:[17,24,39]));
    const lines=doc.splitTextToSize(block.text,width-2*margin);
    const isHeading=block.type==='heading'||block.type==='subheading';
    const need=(isHeading?lines.length*style.line+32:Math.min(lines.length*style.line,32))+(style.before||0);
    if(y+need>bottom)nextPage();else if(y>margin)y+=style.before||0;
    for(const line of lines) {if(y+style.line>bottom)nextPage();doc.text(line,margin,y+style.size);y+=style.line;}
    y+=style.gap;
  }
  const count=doc.getNumberOfPages();
  for(let page=1;page<=count;page++){doc.setPage(page);doc.setFont('DejaVu','normal');doc.setFontSize(9);doc.setTextColor(100,116,139);doc.text(`${page} / ${count}`,width-margin,height-24,{align:'right'});}
  return new Uint8Array(doc.output('arraybuffer'));
}
