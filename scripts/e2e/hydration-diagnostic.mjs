// Temporary diagnostic of the CI build; removed before this PR is ready.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
const root = ".next/static/chunks";
const pattern = /var (\w+)=null,(\w+)=null,(\w+)=!1,(\w+)=null,(\w+)=!1,(\w+)=Error\((\w+)\(519\)\);function (\w+)\((\w+)\)\{/;
let matched = 0;
for (const name of readdirSync(root)) {
  if (!name.endsWith(".js")) continue;
  const path = `${root}/${name}`;
  const source = readFileSync(path, "utf8");
  const match = source.match(pattern);
  if (!match) continue;
  const [, , next, , , , , , , fiber] = match;
  const diagnostic = `try{let chain=[];for(let f=${fiber};f&&chain.length<14;f=f.return)chain.push(typeof f.type==='string'?f.type+':'+(f.pendingProps?.id??f.pendingProps?.className??''):typeof f.type);console.log('[hydration-diagnostic]',JSON.stringify({chain,actual:${next}?.outerHTML?.slice(0,1400),parent:${next}?.parentElement?.outerHTML?.slice(0,1800)}))}catch{}`;
  writeFileSync(path, source.replace(pattern, (prefix) => prefix + diagnostic));
  matched++;
}
if (matched !== 1) throw new Error(`Expected one React hydration handler, found ${matched}`);
