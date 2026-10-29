import {createServer} from 'vite';
import {readFileSync} from 'node:fs';
import {strings,toothName} from '../dental/strings.js';
const server=await createServer({server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
try{
 const {Registry}=await server.ssrLoadModule('/dental/vendor/src/anatomy/registry.ts');
 const {descriptionGaps}=await server.ssrLoadModule('/dental/vendor/src/content/descriptionCoverage.ts');
 const registry=new Registry(JSON.parse(readFileSync(new URL('../dental/models/manifest.json',import.meta.url))));
 const gaps=descriptionGaps(registry);
 for(const [key,value] of Object.entries(strings))if(value.length!==2||value.some(v=>!v.trim()))gaps.push('translation: '+key);
 for(const lang of ['zh-CN','en','ja'])for(let q=1;q<=4;q++)for(let n=1;n<=8;n++)if(!toothName(q*10+n,lang))gaps.push(`tooth ${q*10+n}: ${lang}`);
 if(gaps.length)throw Error(gaps.join('\n'));
 console.log(`Dental coverage: ${registry.byId.size} source structures and ${Object.keys(strings).length} UI translations verified.`);
}finally{await server.close();}
