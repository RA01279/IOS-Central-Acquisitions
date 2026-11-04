export interface PdfPositionedText { text:string;x:number;y:number;width:number }
/** Recognized broker grid only. Unknown layouts fall back to the helper, never guessed columns. */
export function saleGrid(items:PdfPositionedText[],page:number) {
 const seller=items.find(i=>/^Seller\s*\/\s*Buyer$/i.test(i.text));
 if(!seller)return [];
 if(!items.some(i=>i.y<seller.y&&/\b(comps|comparables|comparable sales)\b/i.test(i.text)))return [];
 const header=items.filter(i=>Math.abs(i.y-seller.y)<12);
 const find=(re:RegExp)=>header.find(i=>re.test(i.text));
 const prices=header.filter(i=>i.text==='Sale Price').sort((a,b)=>a.x-b.x);
 const captions=[seller,find(/^Property Name$/),find(/^Acres$/),find(/^FAR$/),find(/^Building Size$/),...prices,find(/^Going In Cap$/),find(/^Occupancy$/),find(/^Clear Height$/),find(/^Class$/),find(/^Sale$/),find(/^Comments$/)];
 if(captions.length!==14 || captions.some(c=>!c))return [];
 const centers=captions.map(c=>c!.x+c!.width/2);
 if(centers.some((c,i)=>i>0&&c<=centers[i-1]))return [];
 const boundaries=centers.slice(1).map((x,i)=>(centers[i]+x)/2);
 const body=items.filter(i=>i.y>seller.y+12&&i.text.trim());
 const commentsStart=Math.min(...body.filter(i=>i.x>centers[12]+10&&i.text.length>45).map(i=>i.x));
 if(!Number.isFinite(commentsStart))return [];
 boundaries[12]=commentsStart-2;
 const starts=body.filter(i=>i.x<boundaries[0]&&i.text.includes('/')).map(i=>i.y).sort((a,b)=>a-b);
 const lastEnd=starts.at(-1)!+Math.max(40,...starts.slice(1).map((y,i)=>y-starts[i]))+12;
 return starts.map((top,index)=>{
   const cells=Array.from({length:14},()=>[] as PdfPositionedText[]);
   for(const item of body.filter(i=>i.y>=top-1&&i.y<(starts[index+1]??lastEnd)-1)){
     const col=boundaries.findIndex(b=>item.x<b); cells[col<0?13:col].push(item);
   }
   const values=cells.map(c=>c.sort((a,b)=>a.y-b.y||a.x-b.x).map(x=>x.text).join('\n').trim());
   const [sellerName,buyer]=values[0].split(/\s*\/\s*/);
   const address=values[1].replace(/\s*\n?Houston,\s*TX\s*$/i,'').trim();
   const firstNumber=address.search(/\b\d{2,6}/);
   const project=firstNumber>0?address.slice(0,firstNumber).replace(/\n/g,' ').trim():'';
   const headers=['Seller / Buyer','Property Name / Address','Acres','FAR','Building Size SF','Sale Price','Sale Price PSF','Sale Price PLSF','Going In Cap Rate','Occupancy','Clear Height','Class','Sale Date','Comments'];
   return {page,sourceRow:index+1,originalAddress:address,sourceMetrics:Object.fromEntries(headers.map((h,i)=>[h,values[i]])),tableRow:[address.replace(/\n/g,' '),project,buyer,sellerName,'Houston','TX',values[2],values[3],values[4],values[5],values[6],values[8],values[12],values[13]].map(v=>v?.replace(/[\n\t|]+/g,' ')??'')};
 }).filter(r=>/^\$[\d,]+$/.test(r.sourceMetrics['Sale Price']));
}
export const PDF_SALE_COLUMNS=['Address','Project Name','Buyer','Seller','City','State','Acres','Coverage','Building SF','Sale Price','Price PSF','Cap Rate','Sale Date','Notes'];
