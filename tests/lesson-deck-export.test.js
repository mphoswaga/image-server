const test=require('node:test'),assert=require('node:assert/strict'),PizZip=require('pizzip');
const { rebuildDeck, paginateSlides }=require('../generate');
const { gradeProfile }=require('../grade');
const { validateAlignedExport }=require('../lesson-deck-export');
const { animateBuffer }=require('../animate-pptx');
const table={headers:['File example','Size'],rows:[['Text note','10 KB'],['Photo','2 MB'],['Song','3 MB'],['Video','10 MB'],['Game','200 MB']],caption:'Example sizes. Actual files can have different sizes.'};
function fixture(){return {grade:'Grade 3',presetId:'sage-split',images:[null],slides:[{type:'content',title:'Compare these example files',bullets:[],speakerNotes:'Minutes 13–20. Ask which is larger. Answer: the 200 MB game.',table,alignment:{version:1,id:'table'}}]};}
async function exportDeck(deck){return animateBuffer(await rebuildDeck(deck).write({outputType:'nodebuffer'}),'early');}
test('native table survives theme, pagination, animation and final ZIP validation',async()=>{
 const deck=fixture();assert.equal(paginateSlides(deck.slides,gradeProfile(deck.grade).theme,null).length,1);
 for(const presetId of ['sage-split','ocean-classic','navy-banner']){
  deck.presetId=presetId;const buffer=await exportDeck(deck);assert.doesNotThrow(()=>validateAlignedExport(buffer,deck));
  const zip=new PizZip(buffer);assert.match(zip.file('ppt/slides/slide1.xml').asText(),/<a:tbl>/);assert.match(zip.file('ppt/slides/slide1.xml').asText(),/10 MB/);
 }
});
test('final export gate rejects missing table content and teacher notes',async()=>{
 const deck=fixture(),buffer=await exportDeck(deck);
 for(const [part,from,to] of [['ppt/slides/slide1.xml','200 MB','20 MB'],['ppt/notesSlides/notesSlide1.xml','Ask which is larger','Lost notes']]){
  const zip=new PizZip(buffer);zip.file(part,zip.file(part).asText().replace(from,to));assert.throws(()=>validateAlignedExport(zip.generate({type:'nodebuffer'}),deck),/lost/);
 }
});
test('existing decks without alignment metadata retain their export path',()=>{
 assert.doesNotThrow(()=>validateAlignedExport(Buffer.from('not a fixture'),{slides:[{type:'content',title:'Existing lesson'}]}));
});
test('aligned slides use an existing wider layout before duplicating a planned step',()=>{
 const {getPreset}=require('../slide-presets');const {gradeProfile}=require('../grade');const s={type:'content',title:'One planned task',alignment:{id:'task'},bullets:Array(5).fill('Compare the examples carefully and explain your reason to your partner.')};
 const pages=paginateSlides([s],gradeProfile('Grade 3').theme,getPreset('sage-split'));assert.equal(pages.length,1);assert.equal(pages[0]._layout,'twocol');
});
test('objectives keep their intended uppercase title without a false missing-content error',async()=>{
 const d=fixture();d.slides.unshift({type:'objectives',title:'Learning objectives',bullets:['Compare text and image files.']});d.images.unshift(null);validateAlignedExport(await exportDeck(d),d);
});
test('dense tables are rejected rather than shrinking below readable text size',()=>{
 const {tableLayout}=require('../lesson-slide-table');assert.throws(()=>tableLayout({headers:['One','Two','Three','Four'],rows:Array(8).fill(Array(4).fill('A long explanation that would wrap onto several lines in every cell.'))}),/too dense/);
 assert.ok(tableLayout(table).fontSize>=14);
});
