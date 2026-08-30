#!/usr/bin/env node
import { checkPicoclawAdvisories } from "../lib/advisories.mjs"; import { stableStringify } from "../lib/profile.mjs";
function parse(argv){const a={allowUnsigned:false}; for(let i=0;i<argv.length;i++){const t=argv[i]; if(t==="--feed") a.feedPath=argv[++i]; else if(t==="--state") a.statePath=argv[++i]; else if(t==="--allow-unsigned") a.allowUnsigned=true; else throw new Error(`Unknown argument: ${t}`);} if(!a.feedPath) throw new Error("--feed is required"); return a;}
const result=checkPicoclawAdvisories(parse(process.argv.slice(2))); console.log(stableStringify(result));
