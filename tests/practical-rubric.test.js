const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePracticalRubric } = require('../public/practical-rubric');

const pastedRubric = 'StepTaskLearning Objective AlignmentMarks1Opened Chrome—**1**2Went to guest mode—**1**3Typed `kiddle.co` and pressed Enter (correct spelling, no space)Use a search engine or AI**4**4Clicked on **Search Facts**Use a search engine or AI**2**5Searched for facts about their favorite animalUse a search engine or AI**3**6**Refined their search** by adding extra terms (e.g., *"habitat"*, *"diet"*, or *"fun facts"*)Refine search by adding terms**4**7**Checked a second source or page** on Kiddle to verify the informationUse multiple sources to check results**4**8Found **10 accurate facts** and copied themGather facts from the internet**6**9Opened a Word documentMake an information report**2**10Wrote the heading `"Facts about ..."`Make an information report**3**11Pasted the 10 facts into the documentGather facts / make a report**4**12**Organized or formatted the facts** cleanly (e.g., bullet points or numbered list)Make an information report**4**13Went to the report/search, got a picture of the animal, and pasted itMake an information report**4**14Changed the page color and added a borderMake an information report**4**15**Saved the Word document** with a clear file name (e.g., *"Lions Report"*)Make an information report**4Total**';

test('imports the pasted animal report rubric with 15 criteria and computes its missing total', () => {
  const { rows, totalMarks } = parsePracticalRubric(pastedRubric);
  assert.equal(totalMarks, 50);
  assert.deepEqual(rows.map(row => row.marks), [1, 1, 4, 2, 3, 4, 4, 6, 2, 3, 4, 4, 4, 4, 4]);
  assert.deepEqual(rows[0], { task: 'Opened Chrome', objective: '', marks: 1 });
  assert.deepEqual(rows[4], { task: 'Searched for facts about their favorite animal', objective: 'Use a search engine or AI', marks: 3 });
  assert.deepEqual(rows[7], { task: 'Found 10 accurate facts and copied them', objective: 'Gather facts from the internet', marks: 6 });
  assert.deepEqual(rows[14], { task: 'Saved the Word document with a clear file name (e.g., "Lions Report")', objective: 'Make an information report', marks: 4 });
});
test('accepts tab and Markdown tables and rejects an inconsistent total', () => {
  const text = '| Step | Task | Learning Objective Alignment | Marks |\n| --- | --- | --- | --- |\n| 1 | Choose the animal | | **2** |\n| Total | | | 2 |';
  const tabbed = 'Step\tTask\tLearning Objective Alignment\tMarks\n1\tChoose the animal\t\t2';
  assert.deepEqual(parsePracticalRubric(text), parsePracticalRubric(tabbed));
  assert.throws(() => parsePracticalRubric(text.replace('| | | 2 |', '| | | 3 |')), /criteria add up to 2/);
  assert.throws(() => parsePracticalRubric(tabbed.replace('\n1', '\n2')), /Expected step 1/);
});
