// Guest-only activity. All records are fictional and edits live inside this panel.
function mountDatabasePractice(panel) {
  const area = document.createElement('div');
  area.className = 'db-work';
  const level = document.createElement('strong');
  const status = document.createElement('p');
  status.className = 'feedback';
  status.setAttribute('role', 'status');
  const next = document.createElement('button');
  next.className = 'check';
  panel.prepend(level);
  panel.append(area, status, next);

  const learners = [
    {id:'L12', name:'Trần Minh Anh', room:'B04', phone:'0000000012', borrowed:'Yes'},
    {id:'L15', name:'Lê Gia Bảo', room:'B02', phone:'', borrowed:'Yes'},
    {id:'L18', name:'Võ Khánh Linh', room:'B04', phone:'0000000018', borrowed:'Yes'},
    {id:'L21', name:'Nguyễn An Bình', room:'B04', phone:'0000000021', borrowed:'No'}
  ];
  function button(text, action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.onclick = action;
    return b;
  }
  function advance(label, action) {
    next.hidden = false;
    next.textContent = label;
    next.onclick = () => { action(); panel.scrollIntoView({block:'start'}); };
  }
  function start(label, instruction) {
    level.textContent = label;
    panel.querySelector('.instructions').textContent = instruction;
    status.textContent = '';
    next.hidden = true;
    area.replaceChildren();
  }
  function paper(person) {
    const card = document.createElement('article');
    card.className = 'db-card';
    card.innerHTML = '<small>LIBRARY REGISTER · '+person.id+'</small><h3>'+person.name+
      '</h3><div>Room '+person.room+'</div><div>Cellphone '+(person.phone || '________')+
      '</div><div>Borrowed a book? '+person.borrowed+'</div>';
    return card;
  }
  function easy() {
    start('Easy · 1 of 3', 'Sort the four collections. Drag a card to its home, or tap a card and then a home.');
    area.innerHTML = '<div class="db-tray"></div><div class="db-homes"></div>';
    const tray = area.firstElementChild;
    let selected;
    const groups = [];
    function place(item, group) {
      if (!item) { status.textContent = 'Choose a collection first.'; return; }
      group.append(item);
      item.setAttribute('aria-pressed','false');
      selected = null;
      next.hidden = true;
      status.textContent = '';
      item.focus();
    }
    for (const title of ['Physical database','Digital database']) {
      const group = document.createElement('section');
      group.className = 'db-bin';
      const target = button(title, () => place(selected, group));
      group.append(target);
      group.ondragover = e => e.preventDefault();
      group.ondrop = e => { e.preventDefault(); if (selected) place(selected, group); };
      area.lastElementChild.append(group);
      groups.push(group);
    }
    const collections = [
      ['📇','Box of library cards',0,'L12 · Minh Anh | L15 · Gia Bảo'],['📱','Contacts on a phone',1,'Minh Anh | 0000000012'],
      ['💻','Class spreadsheet',1,'Name | Room | Age'],['📖','Paper attendance register',0,'Mon ✓ | Tue ✓ | Wed ✓']
    ];
    const items = collections.map(([icon,name,home,sample]) => {
      const item = button(icon+' '+name, () => {
        selected?.setAttribute('aria-pressed','false');
        selected = item;
        item.setAttribute('aria-pressed','true');
        status.textContent = 'Choose a home for '+name+'.';
      });
      const preview = document.createElement('small');
      preview.textContent = sample;
      item.append(preview);
      item.className = 'db-item '+(home===0?'db-paper':'db-device');
      item.setAttribute('aria-pressed','false');
      item.draggable = true;
      item.ondragstart = e => { item.click(); e.dataTransfer.setData('text/plain',name); };
      tray.append(item);
      return item;
    });
    area.append(button('Check my collections', () => {
      const wrong = items.findIndex((item,i) => item.parentElement !== groups[collections[i][2]]);
      if (wrong !== -1) { status.textContent = 'Check where you filed '+collections[wrong][1]+'.'; return; }
      status.textContent = 'All four collections are in the right home.';
      advance('Continue to Moderate', moderate);
    }));
  }
  function moderate() {
    start('Moderate · 2 of 3', 'Minh Anh changed rooms. Find card L12 in the filing drawer, then update her digital record to match the paper card.');
    area.innerHTML = '<details class="db-drawer"><summary>Open the library filing drawer</summary><div class="db-tabs"></div><div class="db-paper-slot"></div></details><section class="db-screen" hidden><h3>Library database</h3><label>Search by name or card ID <input type="search"></label><div class="db-results"></div></section>';
    const screen = area.querySelector('.db-screen');
    const search = screen.querySelector('input');
    const results = screen.querySelector('.db-results');
    const rooms = learners.map((person,i) => i===0 ? 'B01' : person.room);
    function showResults() {
      results.replaceChildren();
      const query = search.value.trim().toLocaleLowerCase();
      if (!query) return;
      learners.forEach((person,i) => {
        if (!(person.id+' '+person.name).toLocaleLowerCase().includes(query)) return;
        const row = document.createElement('label');
        row.textContent = person.id+' · '+person.name+' · Room ';
        const field = document.createElement('input');
        field.value = rooms[i];
        field.oninput = () => { rooms[i] = field.value; next.hidden = true; status.textContent = ''; };
        row.append(field);
        results.append(row);
      });
      if (!results.children.length) results.textContent = 'No matching records. Try the card ID.';
    }
    search.oninput = showResults;
    for (const person of [learners[1],learners[0],learners[2]]) {
      area.querySelector('.db-tabs').append(button(person.id, () => {
        area.querySelector('.db-paper-slot').replaceChildren(paper(person));
        if (person.id === 'L12') screen.hidden = false;
      }));
    }
    screen.append(button('Save room change', () => {
      if (!rooms.every((room,i) => room.trim().toUpperCase()===learners[i].room)) {
        status.textContent = 'Compare the room for L12 with the paper card. Keep the other rooms as they were.';
        next.hidden = true;
        return;
      }
      status.textContent = 'L12 now matches the paper register.';
      advance('Continue to Complicated', complicated);
    }));
  }
  function complicated() {
    start('Complicated · 3 of 3', 'Transfer these registration cards to the digital register. Enter each ID once. Flag any missing phone for follow-up.');
    const cards = document.createElement('div');
    cards.className = 'db-cards';
    for (const i of [0,1,0,2]) cards.append(paper(learners[i]));
    const register = document.createElement('div');
    register.className = 'db-screen';
    register.innerHTML = '<h3>Digital register</h3>';
    const fields = [['id','Card ID'],['name','Name'],['room','Room'],['phone','Cellphone'],['borrowed','Borrowed a book?']];
    const rows = [];
    for (let i=0;i<3;i++) {
      const row = document.createElement('fieldset');
      row.innerHTML = '<legend>Record '+(i+1)+'</legend>';
      const values = {};
      for (const [key,title] of fields) {
        const label = document.createElement('label');
        label.textContent = title;
        const field = document.createElement(key==='borrowed'?'select':'input');
        if (key==='borrowed') field.innerHTML = '<option></option><option>Yes</option><option>No</option>';
        label.append(field);
        row.append(label);
        values[key] = field;
      }
      const flag = document.createElement('label');
      flag.innerHTML = '<input type="checkbox"> Phone missing';
      values.flag = flag.firstElementChild;
      row.append(flag);
      register.append(row);
      rows.push(values);
    }
    area.append(cards,register,button('Check the register', () => {
      const seen = new Set();
      const norm = value => value.trim().normalize('NFC').toLowerCase();
      for (const [i,row] of rows.entries()) {
        const p = learners.slice(0,3).find(person => norm(person.id)===norm(row.id.value));
        const prefix = 'Record '+(i+1)+': ';
        if (!p || seen.has(p.id)) { status.textContent = prefix+'check the card ID. Each person needs one record.'; return; }
        seen.add(p.id);
        for (const [key,title] of fields) {
          if (norm(row[key].value)!==norm(p[key])) { status.textContent = prefix+'check '+title+' against the paper card.'; return; }
        }
        if (row.flag.checked !== !p.phone) { status.textContent = prefix+'check whether the cellphone is missing.'; return; }
      }
      status.textContent = 'Three people registered. The repeated card was counted once.';
      advance('Build the borrowing list', () => shortlist(rows.map(row => Object.fromEntries(fields.map(([key]) => [key,row[key].value.trim()])))));
    }));
    register.oninput = () => { next.hidden = true; status.textContent = ''; };
  }
  function shortlist(records) {
    start('Complicated · Final challenge', 'Your three records have joined the library register. Make a list of everyone in B04 who borrowed a book.');
    const form = document.createElement('fieldset');
    form.className = 'db-screen';
    form.innerHTML = '<legend>Library register</legend>';
    const entries = [...records,learners[3]].map(person => {
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      label.append(box,' '+person.name+' · '+person.room+' · Borrowed a book? '+person.borrowed);
      form.append(label);
      return {person,box};
    });
    form.onchange = () => { status.textContent = ''; };
    area.append(form,button('Create borrowing list', () => {
      const correct = entries.every(({person,box}) => box.checked === (person.room.toUpperCase()==='B04' && person.borrowed==='Yes'));
      status.textContent = correct ? 'Borrowing list: '+entries.filter(e=>e.box.checked).map(e=>e.person.name).join(', ')+'. All three levels complete!' : 'Check both details for each person: room B04 and a borrowed book.';
    }));
  }
  easy();
}
