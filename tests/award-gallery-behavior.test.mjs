import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile('public/data-core/app.js', 'utf8');
function harness() {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      value: '', disabled: false, innerHTML: '', textContent: '',
      appendChild(child) { child.parentElement = this; }, cloneNode() { return {querySelectorAll:()=>[]}; },
      classList: {add() {}, remove() {}, toggle() {}}, setAttribute() {},
      querySelectorAll: () => [], close() {}, showModal() {}, insertAdjacentHTML(_position,html) { this.innerHTML+=html; },
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    window: {DataCoreImageGallery:{close(){}}},
    document: {getElementById: element, querySelectorAll: () => []},
    console, URL, URLSearchParams, FormData, HTMLDialogElement: class {},
    location: {href:'http://test/data-core/counseling/competitions'}, history:{pushState(){}},
    AwardImageCache: class {clear() {} remove() {}},
    AwardSlideshow: class {clear() {} render() {}},
  });
  vm.runInContext(source.slice(0, source.lastIndexOf('init().catch')), context);
  vm.runInContext("state.context = {authenticated:true,canWrite:true,isSuperAdmin:true}; toast = () => {}; const awards = awardCollections.enrolled; const publicAwards = awardCollections.public;", context);
  const run = (code) => vm.runInContext(code, context);
  return {context, element, run};
}

test('both collection details stay in their own sections with independent folder selections', () => {
  const h = harness();
  h.run("state.awardFolders=[{id:'a'}];state.selectedAwardFolderId='a';publicAwards.state.awardFolders=[{id:'b',collectionType:'public'}];publicAwards.state.selectedAwardFolderId='b';awards.renderAwardFolders();publicAwards.renderAwardFolders()");
  assert.equal(h.element('awardFolderDetail').hidden,false);
  assert.equal(h.element('public-awardFolderDetail').hidden,false);
  assert.equal(h.run('publicAwards.state.selectedAwardFolderId'),'b');
  h.run("state.selectedAwardFolderId=null;awards.renderAwardFolders()");
  assert.equal(h.element('awardFolderDetail').hidden,true);
  assert.equal(h.element('public-awardFolderDetail').hidden,false);
});

test('loading or clearing one collection does not overwrite the other selection or files', async () => {
  const h = harness();
  h.run("state.awardFolders=[{id:'a'}];state.selectedAwardFolderId='a';publicAwards.state.awardFolders=[{id:'b',collectionType:'public'}];publicAwards.state.selectedAwardFolderId='b';publicAwards.state.awardFiles=[{id:'b1',recordId:'b'}]");
  h.context.api = async()=>({files:[{id:'a1',recordId:'a'},{id:'b2',recordId:'b'}]});
  await h.run('awards.loadAwardFiles()');
  assert.equal(h.run('JSON.stringify(state.awardFiles.map(f=>f.id))'),'["a1"]');
  assert.equal(h.run('JSON.stringify(publicAwards.state.awardFiles.map(f=>f.id))'),'["b1"]');
  h.run("awards.clearAwardImages()");
  assert.equal(h.run('publicAwards.state.selectedAwardFolderId'),'b');
  assert.equal(h.run('publicAwards.view.filesRequest'),0);
});

test('award gallery ignores stale successes, failures, and foreign record rows', async () => {
  const h = harness();
  h.run("state.awardFolders = [{id:'a'},{id:'b'}]; state.selectedAwardFolderId = 'a';");
  const requests = [];
  h.context.api = () => new Promise((resolve, reject) => requests.push({resolve,reject}));
  const first = h.run('awards.loadAwardFiles()');
  h.run("state.selectedAwardFolderId = 'b'");
  const second = h.run('awards.loadAwardFiles()');
  assert.equal(h.run('state.awardFiles.length'), 0);
  requests[1].resolve({files:[{id:'b1',recordId:'b',fileName:'B'}, {id:'a1',recordId:'a',fileName:'A'}]});
  await second;
  requests[0].resolve({files:[{id:'a1',recordId:'a',fileName:'A'}]});
  await first;
  assert.equal(h.run('JSON.stringify(state.awardFiles.map(f=>f.id))'), '["b1"]');
  h.run("state.selectedAwardFolderId = 'a'");
  const third = h.run('awards.loadAwardFiles()');
  h.run("state.selectedAwardFolderId = 'b'");
  const fourth = h.run('awards.loadAwardFiles()');
  requests[3].resolve({files:[{id:'b2',recordId:'b'}]});
  await fourth;
  requests[2].reject(new Error('old folder failure'));
  await third;
  assert.equal(h.run('state.awardFiles[0].id'), 'b2');
  assert.equal(h.run('awards.view.loading'), false);
});

test('clearing the award view invalidates a pending file response', async () => {
  const h = harness();
  h.run("state.awardFolders=[{id:'a'}];state.selectedAwardFolderId='a'");
  let resolve;
  h.context.api = () => new Promise(done => { resolve = done; });
  const pending = h.run('awards.loadAwardFiles()');
  h.run('clearAwardImages()');
  resolve({files:[{id:'a1',recordId:'a'}]});
  await pending;
  assert.equal(h.run('state.awardFiles.length'), 0);
});

test('award roots escape names and disable writes for readers', async () => {
  const h = harness();
  h.context.api = async (url) => url.includes('collectionType=enrolled') ? {folders:[
    {id:'b',createdAt:'2026-09-02',title:'<img onerror=alert(1)>'},
    {id:'a',createdAt:'2026-09-01',title:'자유 폴더명'},
  ]} : {folders:[],files:[],events:[]};
  await h.run('loadAwardFolders()');
  assert.equal(h.run('state.selectedAwardFolderId'), null);
  assert.equal(h.run('state.awardFolders.length'), 2);
  assert.match(h.element('awardFolderList').innerHTML, /&lt;img/);
  assert.doesNotMatch(h.element('awardFolderList').innerHTML, /<img/);
  h.run('state.context.canWrite = false; awards.renderAwardFolders()');
  for (const id of ['openAwardFolderBtn','openAwardUploadBtn','deleteAwardFolderBtn']) assert.equal(h.element(id).disabled,true);
});

test('award upload locks folder/category/campus and cancel removes stale folder linkage', () => {
  const h = harness();
  h.run("state.awardFolders=[{id:'org',campusId:null,title:'조직 폴더'}]; state.selectedAwardFolderId='org'");
  h.element('uploadCampus').value = 'previous-campus';
  h.run('awards.openAwardUpload()');
  assert.equal(h.element('uploadRecordId').value, 'org');
  assert.equal(h.element('uploadCampus').value, '');
  assert.equal(h.element('uploadCampus').disabled, true);
  assert.equal(h.element('uploadCategory').value, 'competition-material');
  assert.equal(h.element('uploadCategory').disabled, true);
  h.run("closeModal('uploadModal')");
  assert.equal(h.element('uploadRecordId').value, '');
  assert.equal(h.element('uploadCampus').disabled, false);
  assert.equal(h.element('uploadCategory').disabled, false);
});

test('folder deletion calls only the record endpoint, never the file or R2 delete endpoint', async () => {
  const h = harness();
  const calls=[];
  h.context.confirm=()=>true;
  h.context.api=async (url,options) => {calls.push([url,options?.method]); return {records:[]};};
  h.run("state.awardFolders=[{id:'synthetic',title:'합성 폴더'}];state.selectedAwardFolderId='synthetic'");
  await h.run('awards.deleteAwardFolder()');
  assert.deepEqual(calls.filter(([,method])=>method==='DELETE'), [['/api/data-core/awards/folders/synthetic','DELETE']]);
});

test('select all toggles only current-folder files without writes and clears stale selection', async () => {
  const h = harness(), calls = [];
  h.context.api = async (...args) => { calls.push(args); return {files:[]}; };
  h.run("state.awardFolders=[{id:'a'},{id:'b'}];state.selectedAwardFolderId='a';state.awardFiles=[{id:'a1',recordId:'a'},{id:'a2',recordId:'a'},{id:'b1',recordId:'b'}];awards.selected.add('stale');awards.updateAwardSelection()");
  assert.equal(h.run('awards.selected.size'),0);
  assert.equal(h.element('selectAllAwardsBtn').disabled,false);
  assert.equal(h.element('deleteSelectedAwardsBtn').disabled,true);
  h.run('awards.toggleAllAwards()');
  assert.equal(h.run('JSON.stringify([...awards.selected])'),'["a1","a2"]');
  assert.equal(h.element('selectAllAwardsBtn').textContent,'전체해제');
  assert.equal(h.element('awardSelectionCount').textContent,'선택 2개');
  h.run("awards.selected.delete('a1');awards.updateAwardSelection()");
  assert.equal(h.element('selectAllAwardsBtn').textContent,'전체선택');
  h.run('awards.toggleAllAwards();awards.toggleAllAwards()');
  assert.equal(h.run('awards.selected.size'),0);
  assert.equal(h.element('deleteSelectedAwardsBtn').disabled,true);
  assert.deepEqual(calls,[]);
  h.run("awards.toggleAllAwards();state.selectedAwardFolderId='b'");
  await h.run('awards.loadAwardFiles()');
  assert.equal(h.run('awards.selected.size'),0);
  assert.equal(h.element('selectAllAwardsBtn').disabled,true);
  assert.ok(calls.every(([,options])=>!options?.method || options.method==='GET'));
});

test('select all respects read-only, non-master, missing folder, loading and deletion states', () => {
  for (const condition of ['state.context.canWrite=false','state.context.isSuperAdmin=false',"state.selectedAwardFolderId=null",'awards.view.loading=true','awards.view.deleteBusy=true']) {
    const h=harness();
    h.run("state.awardFolders=[{id:'a'}];state.selectedAwardFolderId='a';state.awardFiles=[{id:'a1',recordId:'a'}]");
    h.run(condition+';awards.updateAwardSelection();awards.toggleAllAwards()');
    assert.equal(h.run('awards.selected.size'),0,condition);
    assert.equal(h.element('selectAllAwardsBtn').disabled,true,condition);
    assert.equal(h.element('deleteSelectedAwardsBtn').disabled,true,condition);
  }
});

test('selection deletion snapshots folder, checks ownership, preserves unselected files and handles partial failure', async () => {
  const h = harness(), calls = [];
  h.context.api = async (url, options) => {
    calls.push([url, options?.method]);
    if (url.includes('/b?')) throw new Error('synthetic failure');
    return {files: [{id:'b',recordId:'folder'}, {id:'c',recordId:'folder'}]};
  };
  h.run("state.awardFolders=[{id:'folder',title:'합성'}]; state.selectedAwardFolderId='folder'; state.awardFiles=['a','b','c'].map(id=>({id,recordId:'folder'})); awards.selected.add('a');awards.selected.add('b');awards.requestAwardDelete()");
  assert.equal(h.element('awardDeleteSummary').textContent, '합성 · 선택 2개');
  await h.run('awards.deleteSelectedAwards()');
  assert.deepEqual(calls.filter(([,method])=>method==='DELETE').map(([url])=>url), [
    '/api/data-core/files/a?awardFolderId=folder', '/api/data-core/files/b?awardFolderId=folder',
  ]);
  assert.equal(h.run('JSON.stringify(state.awardFiles.map(f=>f.id))'), '["b","c"]');
  h.run("awards.selected.add('b');awards.requestAwardDelete();state.selectedAwardFolderId='other'");
  await h.run('awards.deleteSelectedAwards()');
  assert.equal(calls.filter(([,method])=>method==='DELETE').length, 2);
});
