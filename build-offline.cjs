// Small offline bundle step for environments where npm registry access is unavailable.
// Uses the same TypeScript transpiler as the normal toolchain and embeds project modules.
const fs=require('fs');
const path=require('path');
const cp=require('child_process');
let ts;
try { ts=require('typescript'); }
catch {
  const root=cp.execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim();
  ts=require(path.join(root,'typescript'));
}
const names=['geometry','links','warp','detect','color','i18n','main'];
const compile=name=>{
  const input=fs.readFileSync(path.join(__dirname,'src',name+'.ts'),'utf8');
  const transpiled=ts.transpileModule(input,{fileName:name+'.ts',compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020},reportDiagnostics:true});
  const errors=transpiled.diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error)||[];
  if(errors.length)throw new Error(ts.formatDiagnosticsWithColorAndContext(errors,{
    getCanonicalFileName:f=>f,getCurrentDirectory:()=>__dirname,getNewLine:()=>"\n"
  }));
  return transpiled.outputText;
};
const defs=names.map(n=>`"./${n}": function(module,exports,require){\n${compile(n)}\n}`).join(',\n');
const output=`/* Slide Frame Corrector 0.2.2 — compiled plugin, no runtime network requests */\n(function(){\nconst __modules={\n${defs}\n};\nconst __cache={};\nfunction __load(id){\nif(!Object.prototype.hasOwnProperty.call(__modules,id))return require(id);\nif(__cache[id])return __cache[id].exports;\nconst m={exports:{}};__cache[id]=m;__modules[id](m,m.exports,__load);return m.exports;\n}\nmodule.exports=__load('./main');\n})();\n`;
fs.writeFileSync(path.join(__dirname,'main.js'),output);
const tests=`const M={${defs}};const cache={};function load(id){if(!M[id])throw new Error(id); if(cache[id])return cache[id].exports; const m={exports:{}};cache[id]=m;M[id](m,m.exports,load);return m.exports;}module.exports={geometry:load('./geometry'),links:load('./links'),warp:load('./warp'),detect:load('./detect'),color:load('./color')};\n`;
fs.writeFileSync(path.join(__dirname,'tests','compiled.cjs'),tests);
console.log('Offline bundle created:',(Buffer.byteLength(output)/1024).toFixed(0),'KB');
