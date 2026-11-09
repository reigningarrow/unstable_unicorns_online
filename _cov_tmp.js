const {createDeck,EFFECTS}=require('./cards');
const {getExpansionCards,EXPANSIONS}=require('./expansions');
const fs=require('fs');
const src=fs.readFileSync('./game.js','utf8');
const allCards=[...createDeck(),...getExpansionCards(Object.keys(EXPANSIONS))];
const cases=new Set();
[...src.matchAll(/case ['"]([\w_]+)['"]:/g)].forEach(m=>cases.add(m[1]));
Object.values(EFFECTS).forEach(v=>cases.add(v));
[...src.matchAll(/eff\.type===?'([\w_]+)'/g)].forEach(m=>cases.add(m[1]));
[...src.matchAll(/\.type==='([\w_]+)'/g)].forEach(m=>cases.add(m[1]));
[...src.matchAll(/type:'([\w_]+)',playerId/g)].forEach(m=>cases.add(m[1]));
const missing=new Map();
for(const c of allCards){
  if(c.effect?.type&&!cases.has(c.effect.type))
    if(!missing.has(c.effect.type)) missing.set(c.effect.type,c.name+'['+c.expansion+']');
}
console.log('Unhandled ('+missing.size+'):');
for(const [t,n] of missing) console.log(' ',t,'<-',n);