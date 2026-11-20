// Add worksheet coordinates after the activity has bound its answer controls.
function framePracticeSheet(table, choose) {
  const wrap = table.parentElement;
  wrap.classList.remove('record-entry');
  wrap.classList.add('practice-sheet');
  const columnLetter = index => String.fromCharCode(65 + index);
  function heading(label, address, scope) {
    const cell = document.createElement('th');
    cell.scope = scope;
    cell.className = 'sheet-axis';
    if (choose) addButton(cell, label, address);
    else cell.textContent = label;
    return cell;
  }
  function addButton(cell, label, address) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.setAttribute('aria-label', cell.classList.contains('sheet-axis') ? address : address+', '+label);
    button.onclick = () => {
      if (choose(address, button) === false) return;
      for (const part of table.querySelectorAll('th,td')) {
        const active = part === cell || part.dataset.row === address || part.dataset.column === address;
        part.classList.toggle('sheet-selection', active);
      }
    };
    cell.replaceChildren(button);
  }
  const rows = Array.from(table.rows);
  const count = rows[0].cells.length;
  rows.forEach((row, i) => {
    Array.from(row.cells).forEach((cell, j) => {
      const column = columnLetter(j);
      cell.dataset.address = column+(i+1);
      cell.dataset.column = 'Column '+column;
      cell.dataset.row = 'Row '+(i+1);
      if (choose) addButton(cell, cell.textContent, column+(i+1));
    });
    row.prepend(heading(String(i+1), 'Row '+(i+1), 'row'));
  });
  const axes = table.createTHead().insertRow();
  axes.append(document.createElement('td'));
  for (let j=0;j<count;j++) axes.append(heading(columnLetter(j),'Column '+columnLetter(j),'col'));
}

function mountRowColumnPractice(panel) {
  const data = [
    ['Name','Room','Books'],
    ['Khánh Linh','B03','2'],
    ['Gia Bảo','B01','3'],
    ['Minh Anh','B02','1']
  ];
  const tasks = [
    ['Easy','Select row 3. Use a number on the left edge.','Row 3'],
    ['Easy','Select column B. Use a letter along the top.','Column B'],
    ['Moderate','Select B4, where column B meets row 4.','B4'],
    ['Moderate','Find Gia Bảo’s book count. Select that cell.','C3'],
    ['Complicated','Minh Anh borrowed two more books. Select her book-count cell, then update the total.','C4','3'],
    ['Complicated','Khánh Linh moved to B05. Find her room cell and update it.','B2','B05']
  ];
  const level = document.createElement('strong');
  panel.prepend(level);
  const wrap = document.createElement('div');
  wrap.className = 'project-data-scroll';
  const table = document.createElement('table');
  table.createCaption().textContent = 'Class library';
  for (const record of data) {
    const row = table.insertRow();
    for (const value of record) row.insertCell().textContent = value;
  }
  wrap.append(table);
  const edit = document.createElement('form');
  edit.hidden = true;
  edit.innerHTML = '<label>New value <input required autocomplete="off"></label> <button class="check">Save cell</button>';
  const feedback = document.createElement('p');
  feedback.className = 'feedback';
  feedback.setAttribute('role','status');
  const next = document.createElement('button');
  next.className = 'check';
  panel.append(wrap,edit,feedback,next);
  let step = 0, selected;
  function prompt() {
    const [difficulty,instruction] = tasks[step];
    level.textContent = difficulty+' · '+(step%2+1)+' of 2';
    panel.querySelector('.instructions').textContent = instruction;
    edit.hidden = next.hidden = true;
    selected = null;
    feedback.textContent = '';
    table.querySelectorAll('.sheet-selection').forEach(cell => cell.classList.remove('sheet-selection'));
  }
  function complete(message) {
    edit.hidden = true;
    const last = step === tasks.length-1;
    feedback.textContent = message+(last?' All three levels complete!':'');
    next.hidden = false;
    next.textContent = last?'Practise again':tasks[step+1][0]!==tasks[step][0]?'Continue to '+tasks[step+1][0]:'Next challenge';
    next.focus({preventScroll:true});
  }
  framePracticeSheet(table, (address, button) => {
    if (!next.hidden) return false;
    edit.hidden = true;
    selected = null;
    if (address!==tasks[step][2]) {
      feedback.textContent = 'You selected '+address+'. Try again.';
      return;
    }
    if (!tasks[step][3]) { complete(address+' selected correctly.'); return; }
    selected = button;
    feedback.textContent = 'Editing '+address+'.';
    edit.hidden = false;
    edit.elements[0].value = button.textContent;
    edit.elements[0].select();
  });
  edit.onsubmit = event => {
    event.preventDefault();
    if (!selected) return;
    if (edit.elements[0].value.trim().toUpperCase()!==tasks[step][3]) {
      feedback.textContent = 'Check the new value and try again.';
      return;
    }
    selected.textContent = tasks[step][3];
    selected.setAttribute('aria-label', tasks[step][2]+', '+selected.textContent);
    complete(tasks[step][2]+' updated to '+selected.textContent+'.');
  };
  next.onclick = () => {
    step++;
    if (step === tasks.length) {
      step = 0;
      Array.from(table.tBodies[0].rows).forEach((row,i) => {
        Array.from(row.cells).slice(1).forEach((cell,j) => {
          const button = cell.firstElementChild;
          button.textContent = data[i][j];
          button.setAttribute('aria-label', cell.dataset.address+', '+data[i][j]);
        });
      });
    }
    prompt();
    table.querySelector('button').focus({preventScroll:true});
  };
  prompt();
}
