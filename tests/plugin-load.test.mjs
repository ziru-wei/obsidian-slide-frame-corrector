import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);

test('bundled Obsidian entrypoint exposes default Plugin class and registers command/menu',async()=>{
  const calls=[];
  const document={};
  const app={vault:{on:(event)=>{calls.push('vault:'+event);return{};}},workspace:{getActiveViewOfType:()=>null,on:(event,fn)=>{calls.push(event);return{};}}};
  class Plugin {
    constructor(){this.app=app;}
    addCommand(cmd){calls.push(cmd.id);}
    async loadData(){return {aspect:'4:3',color:'bogus'};}
    async saveData(){}
    addSettingTab(t){calls.push('settings');}
    registerDomEvent(el,event){assert.equal(el,document);calls.push('dom:'+event);}
    registerEvent(){}
  }
  const obsidian={Plugin,MarkdownView:class{},Modal:class{},Menu:class{},Notice:class{},TFile:class{},PluginSettingTab:class{},Setting:class{}};
  const file=readFileSync(new URL('../main.js',import.meta.url),'utf8');
  const m={exports:{}};
  new Function('module','require','document',file)(m,name=>name==='obsidian'?obsidian:require(name),document);
  assert.equal(typeof m.exports.default,'function');
  assert.ok(m.exports.default.prototype instanceof Plugin);
  const plugin=new m.exports.default();
  await plugin.onload();
  assert.equal(plugin.prefs.aspect,'4:3');
  assert.equal(plugin.prefs.color,'max');
  assert.equal(plugin.prefs.format,'image/jpeg');
  assert.equal(plugin.prefs.tone,'color');
  assert.equal(plugin.prefs.crop,true);
  assert.ok(calls.includes('batch-correct-slides-in-current-note'));
  assert.ok(calls.includes('settings'));
  assert.ok(calls.includes('correct-slide-in-current-note'));
  assert.ok(calls.includes('dom:contextmenu'));
});
