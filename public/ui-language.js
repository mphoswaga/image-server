/* Opt-in UI translation. No learner records, answer choices or lesson content are scanned. */
(() => {
  'use strict';
  const translations = window.LessonScopeVietnamese || {};
  let language = 'en';
  try { if (localStorage.getItem('lessonscope.language') === 'vi') language = 'vi'; } catch {}
  const originals = new WeakMap();
  const bound = new WeakMap();
  const placeholderSources = new WeakMap();
  const t = (key, values = {}) => {
    const pattern = language === 'vi' ? translations[key] || key : key;
    return pattern.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(values, name) ? String(values[name]) : match);
  };
  let observer, queued = false;
  const dynamic = {
    'start.html': '#authBtn,#authErr,#authIntro,#forgotMsg,#joinErr,#activityStatus,.activity-join,.activity-empty,#workList .empty,.wc-pending',
    'join.html': '#codeBtn,#codeErr,#idBtn,#idErr,#forgotMsg,#sidLbl,#sidSub,#step2 h1',
    'play.html': '#authBtn,#authErr,#forgotMsg,#authSub,#sidLabel,.student-google-button span,.student-social-note',
    'assignment.html': '#authBtn,#authErr,#forgotMsg,#authSub,#sidLabel,#submitBtn,#submitErr',
    'index.html': '#rostersBtn .app-menu-label,.gc-actions button,.games-more summary,.games-share summary,.games-share label,.games-share .gcopy,.gc-status-live,.gc-status-closed,.gc-class-save,.gc-class-cancel,#gamesWelcome h2,#gamesWelcome>p,#gamesWelcome .games-kicker,.games-option>p,.games-picker-head h2,#pptxCreateBtn,#gamesBack,#gamesBackTop,#rostersBack,#rostersBackTop,label[for=pptxCutoff],#pptxRosterPickLabel,label[for=rosterGenderCol],a[href="/api/roster/template"],[data-share-action],#rosterShareStatus',
  };
  // Routes serve these named templates without an .html suffix.
  const page = location.pathname === '/' ? 'index.html' : location.pathname === '/start' ? 'start.html' : location.pathname === '/join' ? 'join.html' : location.pathname.startsWith('/play/') ? 'play.html' : location.pathname.startsWith('/assignment/') ? 'assignment.html' : location.pathname.split('/').pop();
  function translateText(element) {
    const binding = bound.get(element);
    if (binding) { const value=t(binding.key,binding.values);if(element.textContent!==value)element.textContent=value;return; }
    for (const text of element.childNodes) {
      if(text.nodeType!==Node.TEXT_NODE) continue;
      const previous=originals.get(text);
      const source=previous && text.nodeValue===previous.last ? previous.source : text.nodeValue;
      const key=source.trim();
      const value=Object.hasOwn(translations,key) ? source.replace(key,t(key)) : source;
      originals.set(text,{source,last:value});
      if(text.nodeValue!==value)text.nodeValue=value;
    }
  }
  function render() {
    queued=false;observer?.disconnect();
    document.documentElement.lang=language;
    document.querySelectorAll('[data-ui-i18n]'+(dynamic[page] ? ','+dynamic[page] : '')).forEach(translateText);
    document.querySelectorAll('[data-ui-placeholder]').forEach(el=>{
      if(!placeholderSources.has(el))placeholderSources.set(el,el.getAttribute('placeholder'));
      el.setAttribute('placeholder',t(placeholderSources.get(el)));
    });
    const picker=document.getElementById('uiLanguage');if(picker)picker.value=language;
    observer?.observe(document.body,{childList:true,subtree:true,characterData:true});
  }
  function schedule(){if(!queued){queued=true;queueMicrotask(render);}}
  function setLanguage(value){
    language=value==='vi'?'vi':'en';
    try{localStorage.setItem('lessonscope.language',language);}catch{}
    render();document.dispatchEvent(new CustomEvent('lessonscope:language',{detail:{language}}));
  }
  window.LessonScopeI18n={t,setLanguage,get language(){return language;},bind(el,key,values={}){bound.set(el,{key,values});el.setAttribute('data-ui-i18n','');translateText(el);}};
  const bar=document.createElement('div');bar.className='ui-language-bar';
  const label=document.createElement('label');label.htmlFor='uiLanguage';label.textContent='Language / Ngôn ngữ';
  const picker=document.createElement('select');picker.id='uiLanguage';picker.setAttribute('aria-label','Language / Ngôn ngữ');
  for(const [value,title] of [['en','English'],['vi','Tiếng Việt']]){const option=document.createElement('option');option.value=value;option.textContent=title;picker.append(option);}
  picker.onchange=()=>setLanguage(picker.value);bar.append(label,picker);document.body.prepend(bar);
  observer=new MutationObserver(schedule);render();
  window.addEventListener('storage',e=>{if(e.key==='lessonscope.language'){language=e.newValue==='vi'?'vi':'en';render();}});
})();
