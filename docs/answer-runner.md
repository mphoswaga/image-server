# Answer Runner: Sun Temple Trail

Answer Runner remains in the existing lesson-game picker and uses the same
question, answer and result endpoints. It is a side-view runner, not a 3D clone.
The other game modes keep their original canvas dimensions and controls.

## Gameplay

- Up arrow, Space, the up button, an upward swipe or a tap jumps.
- Down arrow, the down button or a downward swipe slides.
- A 160 ms input buffer catches actions shortly before landing.
- Collision checks use actual jump height, with a slightly forgiving body box.
- A minimum 1.45-second obstacle spawn interval leaves room to land and react.
- Speed rises gradually and is capped; particles and offscreen objects are bounded.
- Every fifth consecutive coin gives three points. Missed coins reset the streak.
- Clearing a hazard gives two points.
- After 25 seconds of uninterrupted running, a question checkpoint gives a
  five-point correct-answer bonus without taking or adding a heart.
- Stumbles retain the existing heart recovery and question progression rules.
- Continuing after a question clears nearby hazards and gives a protected runway.
- Pause and background-tab suspension freeze gameplay time. Resuming a pause
  does not clear obstacles or award progress. Reduced motion omits particles.

## Assets

Created with the built-in image-generation tool; converted to WebP for delivery.
Original generated PNGs remain outside the repository. The final art is:

- `public/assets/runner/jungle-ruins.webp`
- `public/assets/runner/explorer.webp`

Background generation prompt:

> Use case: stylized-concept. Asset type: scrolling background art for an existing children's side-on runner game called Answer Runner. Create one polished landscape 1536x1024 game environment illustration, no UI or lettering. Lush emerald jungle surrounding ancient pale stone temple ruins, distant turquoise waterfalls and blue mountains, warm sunlight on stone, red tropical flowers sparingly. Clear side-on game view, NOT a perspective road receding into distance. Layers: open blue sky upper quarter, distant temple and waterfall middle, leafy vegetation at sides, and a continuous perfectly horizontal ancient stone running platform across the full width at 79 percent image height. Bottom 21 percent is a cutaway of slate stone blocks with moss and tiny roots. The platform is clear with no obstacles or characters. Detailed, appealing painted 3D adventure-game art, crisp forms and inviting daylight, diverse green/cyan/stone-gray/gold colors. Main action space from 50 to79 percent height remains uncluttered for independently rendered runners, coins and obstacles. No humans, no animals, no coins, no words, no logos, no vignette, no borders.

Explorer generation prompt:

> Use case: stylized-concept. Asset type: transparent PNG game sprite sheet for a children's side-scrolling jungle adventure game. Exactly 1536x1024, a strict invisible 3-column by 2-row grid, each cell 512x512. Six full-body poses of the SAME small friendly original young explorer, side profile facing RIGHT, teal short-sleeved shirt, navy shorts, golden yellow neck scarf, small rust red backpack, cream hiking shoes, dark curly hair, warm medium brown skin. Bright beautifully rendered 3D cartoon game character with clean readable silhouette and consistent proportions. Top row left: run stride left foot forward; top row middle: run passing pose; top row right: run stride right foot forward. Bottom row left: run passing pose alternate; bottom row middle: leaping with knees tucked; bottom row right: low sliding pose facing right with one leg forward. Every pose fully inside its own 512x512 cell, same scale, soles at y=460 relative to cell, center horizontally x=256, standing pose height360 pixels, slide height190 pixels, no clipping. Transparent background with actual alpha, NOT a checkerboard or solid color. No floor, no cast shadow, no labels, no grid lines, no borders, no props beyond worn clothing and backpack. Six separate characters only, not a scene, no duplicate extra limbs.

Final explorer transparency edit prompt:

> Edit this exact image: REMOVE THE ENTIRE BROWN BACKGROUND AND ALL COLORED GLOWS, replace with true fully transparent alpha. Preserve exactly the six explorer figures, clothing, poses, their original positions in the 3 by 2 grid, exact same1536x1024 canvas. No background, no checkerboard, no floor, no drop shadows, no color outside the silhouettes. This must be a sprite sheet with genuine PNG transparency suitable to composite over game scenery. Keep the character art unchanged.

## Verification

`node --test tests/answer-runner.test.js` tests motion, buffering, collision,
recovery, pause, scoring, checkpoint timing and bounded long-run state.

`npx playwright test tests/e2e/answer-runner.spec.js` covers the lesson picker,
rendering, controls, pause, answers, results, immersive mode and asset failure.
Browser tests mock lesson APIs; they do not write learner results to production.
