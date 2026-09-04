(function(root) {
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const instructions = {
    desktop:'Click New folder, or right-click the empty space and choose New, then Folder.',
    new:'Choose New.', folder:'Choose Folder.', name:'Type your name for the folder. Press Enter or Create folder.',
    document:'Your document is ready. Click File.', file:'Choose Save As from the File menu.',
    saveAs:'Choose Save As to select where to save.', browse:'Choose Browse to find your folder.',
    folders:'Click your folder to select it. Double-click it, or choose Open.', save:'Your folder is open. Press Enter or click Save.',
    done:'Your document is saved inside your folder!'
  };
  function createState() { return {screen:'desktop',folderName:'',fileName:'My work',error:'',location:'Documents',folderLocation:'Documents',selected:false}; }
  function instruction(state) { return instructions[state.screen]; }
  function mount(area,state,{blocked,complete,wrong}) {
    const img = name => `<img src="/assets/practice/sprites-g3/${name}.webp" alt="" />`;
    const button = (action,label) => `<button type="button" data-file-action="${action}">${label}</button>`;
    const explorer = (content, saving=false) => `<div class="fb-explorer"><div class="fb-title">${saving?'Save As':'File Explorer'}</div><div class="fb-ribbon">${button('back','\u2190')}${!saving?button('name','New folder'):''}<span class="fb-path" aria-label="Current location">This PC / ${escape(state.location)}${state.screen==='save'?' / '+escape(state.folderName):''}</span></div><div class="fb-explorer-layout"><nav aria-label="Folders">${['Desktop','Documents'].map(place=>`<button type="button" data-place="${place}" aria-current="${state.location===place?'location':'false'}">${place}</button>`).join('')}</nav><div class="fb-files" id="fileDesktop" tabindex="0" aria-label="Folder contents">${content}</div></div><div class="fb-status">${escape(state.location)}${state.selected?' - 1 folder selected':''}</div></div>`;
    const draw = () => {
      let body='';
      const s=state.screen;
      if(['desktop','new','folder','name'].includes(s)) {
        body=explorer(s==='desktop'?'<p class="fb-empty">This folder is empty.</p>':s==='new'?`<div class="fb-context">${button('folder','New')}</div>`:s==='folder'?`<div class="fb-context">${button('name','Folder')}</div>`:`<form id="folderForm"><div class="fb-art">${img('file-folder-closed')}</div><label for="fileRename">Your name</label><input id="fileRename" maxlength="60" value="${escape(state.folderName)}" autocomplete="off" /><button type="submit">Create folder</button></form>`);
      } else if(s==='document') {
        body=`<div class="fb-word-scroll"><div class="fb-word fb-word-illustrated"><img class="fb-word-background" src="/assets/practice/word-document.png" alt="Word-style document window" /><button type="button" class="fb-word-file" data-file-action="file">File</button><article><h3>My computer skills</h3><p>I can create a folder with my name.</p><p>I can save my work in my folder.</p><p>I can find my work again.</p></article><div class="fb-word-status">Page 1 of 1</div></div></div>`;
      } else if(['file','saveAs','browse'].includes(s)) {
        const next={file:['saveAs','Save As'],saveAs:['browse','Save As'],browse:['folders','Browse']}[s];
        body=`<div class="fb-backstage"><h3>My work</h3>${button(next[0],next[1])}${button('document','Back to document')}</div>`;
      } else if(s==='folders') {
        body=explorer(state.location===state.folderLocation?`<button type="button" class="fb-folder ${state.selected?'is-selected':''}" id="personalFolder" aria-pressed="${state.selected}">${img('file-folder-closed')}<span>${escape(state.folderName)}</span></button>${state.selected?button('save','Open'):''}`:`<p class="fb-empty">Your folder is in ${escape(state.folderLocation)}.</p>`,true);
      } else if(s==='save') {
        body=explorer(`<form id="saveForm" class="fb-browser"><div class="fb-art">${img('file-folder-open')}</div><label for="fileName">File name</label><input id="fileName" maxlength="80" value="${escape(state.fileName)}" /><span>Word document (.docx)</span><button type="submit">Save</button></form>`,true);
      } else body=`<div class="fb-saved">${img('school-document')}<strong>${escape(state.folderName)} / ${escape(state.fileName)}.docx</strong></div>`;
      area.innerHTML=`<section class="fb-stage"><header id="fileCoach" aria-live="polite">${instruction(state)}</header><div class="fb-body">${body}</div><p class="fb-error" role="alert">${escape(state.error)}</p></section>`;
      area.querySelectorAll('[data-file-action]').forEach(node=>node.addEventListener('click',()=>go(node.dataset.fileAction)));
      area.querySelectorAll('[data-place]').forEach(node=>node.addEventListener('click',()=>{if(blocked())return;state.location=node.dataset.place;state.selected=false;if(state.screen==='save')state.screen='folders';draw();}));
      const folder=area.querySelector('#personalFolder');
      if(folder) {
        folder.addEventListener('click',()=>{if(blocked()||state.selected)return;state.selected=true;folder.classList.add('is-selected');folder.setAttribute('aria-pressed','true');const open=document.createElement('button');open.type='button';open.textContent='Open';open.addEventListener('click',()=>go('save'));folder.after(open);});
        folder.addEventListener('dblclick',()=>go('save'));
        folder.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();go('save');}});
      }
      const desktop=area.querySelector('#fileDesktop');
      if(desktop) desktop.addEventListener('contextmenu',event=>{event.preventDefault();if(['desktop','new','folder'].includes(state.screen))go('new');});
      const rename=area.querySelector('#fileRename');
      if(rename) { rename.addEventListener('input',()=>{state.folderName=rename.value;}); area.querySelector('#folderForm').addEventListener('submit',event=>{event.preventDefault();if(blocked())return;const name=state.folderName.trim();if(!name)return fail('Type your name first.');state.folderName=name;state.folderLocation=state.location;state.screen='document';state.error='';draw();complete();}); }
      const filename=area.querySelector('#fileName');
      if(filename) { filename.addEventListener('input',()=>{state.fileName=filename.value;});area.querySelector('#saveForm').addEventListener('submit',event=>{event.preventDefault();if(blocked())return;if(!state.fileName.trim())return fail('Give your document a name, such as My work.');state.fileName=state.fileName.trim();state.screen='done';state.error='';draw();complete();}); }
      if(rename||filename) (rename||filename).focus({preventScroll:true});
    };
    function fail(message) { state.error=message;wrong(message);draw(); }
    function go(screen) {
      if(blocked())return;
      if(screen==='back')screen=state.screen==='save'?'folders':state.screen==='folders'?'browse':'desktop';
      if(screen==='save'&&state.location!==state.folderLocation)return;
      state.screen=screen;state.error='';
      // Opening Browse is the second scored outcome; saving is the third.
      if(screen==='folders'&&!state.browsed) { state.browsed=true;state.location=state.folderLocation;draw();complete();return; }
      draw();
    }
    draw();
  }
  root.PracticeFileBase={createState,instruction,mount};
}(typeof globalThis!=='undefined'?globalThis:this));
