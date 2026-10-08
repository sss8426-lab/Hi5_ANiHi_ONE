import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Selecting text in a dialog by dragging and releasing on the backdrop makes the browser fire a click on
// the dialog/backdrop. Such a click must not close the window: only a press that starts there may.
test('dialogs close on a backdrop click only when the press also started on the backdrop', () => {
  const library = fs.readFileSync('public/data-core/work/hq-library.js', 'utf8');
  assert.match(library, /dialog\.addEventListener\('pointerdown',e=>\{pressedOutside=e\.target===dialog&&outside\(e\);\}\);/);
  assert.match(library, /const close=pressedOutside&&e\.target===dialog&&outside\(e\);pressedOutside=false;if\(close&&dialog\.id!=='libraryProgressDialog'\)dialog\.close\(\);/);
  assert.doesNotMatch(library, /if\(e\.target===dialog&&dialog\.id!=='libraryProgressDialog'\)dialog\.close\(\)/);
  const usage = fs.readFileSync('public/data-core/work/library-usage.js', 'utf8');
  assert.match(usage, /const backdrop=pressedOutside&&e\.target===dialog&&outside\(e\);/);
  const app = fs.readFileSync('public/data-core/app.js', 'utf8');
  assert.match(app, /const close = pressedOnBackdrop && event\.target === backdrop;/);
  assert.doesNotMatch(app, /if \(event\.target === backdrop\) closeModal\(backdrop\.id\);/);
});
