(function exposePracticalRubric(root) {
  function plain(value) {
    return value.replace(/\*\*|(?<!\*)\*(?!\*)|`/g, '').trim();
  }

  function parsePracticalRubric(value) {
    const text = String(value || '').trim();
    if (!text) throw new Error('Paste a rubric with tasks and marks.');
    const rows = [];
    let declaredTotal;
    function add(step, task, objective, marks) {
      const index = rows.length + 1;
      if (Number(step) !== index) throw new Error(`Expected step ${index}. Check the rubric row numbers.`);
      task = plain(task);
      objective = plain(objective);
      marks = Number(plain(marks));
      if (!task || !Number.isInteger(marks) || marks < 1 || marks > 1000) {
        throw new Error(`Step ${index} needs a task and a positive whole-number mark.`);
      }
      rows.push({ task, objective: /^[-–—]+$/.test(objective) ? '' : objective, marks });
    }

    const header = /^Step\s*Task\s*Learning Objective Alignment\s*Marks/i;
    if (header.test(text) && /\*\*\s*\d+\s*\*\*/.test(text) && !/[|\t]/.test(text)) {
      let remainder = text.replace(header, '').trim();
      while (remainder && !/^Total\b/i.test(remainder)) {
        const row = remainder.match(/^(\d{1,3})\s*([\s\S]+?)\*\*\s*(\d+)\s*(?:\*\*|(?=Total\*\*$))/i);
        if (!row) throw new Error(`Could not read step ${rows.length + 1}. Paste the table with columns separated by tabs or pipes.`);
        const content = plain(row[2]);
        const boundary = content.match(/[–—]\s*$|(?<=[a-z)"”])(?=(?:Use|Refine|Gather|Make)\s)/);
        if (!boundary) throw new Error(`Could not separate the task and objective in step ${rows.length + 1}. Paste the table with columns separated by tabs or pipes.`);
        add(row[1], content.slice(0, boundary.index), content.slice(boundary.index), row[3]);
        remainder = remainder.slice(row[0].length).trim();
      }
      if (remainder) {
        const total = plain(remainder).replace(/^Total:?\s*/i, '');
        if (total && !/^\d+$/.test(total)) throw new Error('Check the total marks row.');
        if (total) declaredTotal = Number(total);
      }
    } else {
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const cells = (line.includes('\t') ? line.trim().split('\t') : line.trim().replace(/^\||\|$/g, '').split('|')).map(cell => cell.trim());
        if (cells.every(cell => /^:?-+:?$/.test(cell)) || /^step$/i.test(plain(cells[0]))) continue;
        if (/^total:?$/i.test(plain(cells[0]))) {
          const total = plain(cells.at(-1));
          if (total && !/^total:?$/i.test(total)) {
            if (!/^\d+$/.test(total)) throw new Error('Check the total marks row.');
            declaredTotal = Number(total);
          }
          continue;
        }
        if (cells.length !== 4) throw new Error('Use four columns: Step, Task, Learning Objective Alignment, and Marks.');
        add(plain(cells[0]), cells[1], cells[2], cells[3]);
      }
    }

    const totalMarks = rows.reduce((sum, row) => sum + row.marks, 0);
    if (!rows.length || totalMarks > 1000) throw new Error('Paste at least one criterion with a combined total of at most 1000 marks.');
    if (declaredTotal !== undefined && declaredTotal !== totalMarks) {
      throw new Error(`The criteria add up to ${totalMarks} marks, but the total row says ${declaredTotal}.`);
    }
    return { rows, totalMarks };
  }

  if (typeof module === 'object' && module.exports) module.exports = { parsePracticalRubric };
  else root.parsePracticalRubric = parsePracticalRubric;
})(globalThis);
