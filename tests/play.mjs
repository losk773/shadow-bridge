import fs from 'fs';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const core = html.split('<!--CORE-START-->')[1].split('<!--CORE-END-->')[0].replace(/<\/?script>/g,'');
(0,eval)(core);
const C = globalThis.SHADOW_CORE;

/* ---- 1. Юнит-тесты геометрии ---- */
let ok=true;
const eq=(a,b,m,tol=1e-3)=>{ if(a===null||Math.abs(a-b)>tol){console.log('  FAIL',m,a,'!=',b);ok=false;} };
const L={x:100,y:100};
eq(C.projectX(L,100,400),100,'точка под лампой');
eq(C.projectX(L,200,430),300,'коэф. x2 вправо');
eq(C.projectX(L,50,430),0,'коэф. x2 влево');
if(C.projectX(L,100,90)!==null){console.log('  FAIL выше лампы должно быть null');ok=false;}
const sp=C.shadowSpan({type:'box',x:150,y:430,w:100,h:1},L,0);
eq(sp.a,200,'span.a',0.5); eq(sp.b,400,'span.b',0.5);
// чем ниже лампа, тем длиннее тень
const s1=C.shadowSpan({type:'box',x:200,y:400,w:100,h:20},{x:250,y:100},0);
const s2=C.shadowSpan({type:'box',x:200,y:400,w:100,h:20},{x:250,y:300},0);
if(!((s2.b-s2.a)>(s1.b-s1.a))){console.log('  FAIL лампа ниже -> тень должна быть длиннее');ok=false;}
// сегменты земли
const gs=C.groundSegments({levelW:1000,gaps:[{x:300,w:100},{x:600,w:50}]});
if(JSON.stringify(gs)!==JSON.stringify([{a:0,b:300},{a:400,b:600},{a:650,b:1000}])){console.log('  FAIL groundSegments',gs);ok=false;}
// затенение луча
const stFake={t:0,lamps:[{x:250,y:100}],level:{objects:[{type:'box',x:200,y:300,w:100,h:40}]}};
if(C.isLit({x:250,y:700},stFake)){console.log('  FAIL точка за ящиком должна быть в тени');ok=false;}
if(!C.isLit({x:60,y:700},stFake)){console.log('  FAIL точка сбоку должна быть освещена');ok=false;}
console.log(ok?'✓ геометрия: проекция, тени, земля, затенение — ОК':'✗ геометрия сломана');


/* ---- 3. Ворота: должны реально открываться и закрываться ---- */
for(let li=0;li<C.LEVELS.length;li++){
  const lv=C.LEVELS[li]; if(!lv.gates.length) continue;
  for(const g of lv.gates){
    const st=C.createState(li); st.charX=g.x-30; C.update(st,1/60);
    const lim=st.lim; let open=0,closed=0;
    for(let lx=st.camX+lim.pad;lx<=st.camX+C.VW-lim.pad;lx+=6)
      for(let ly=lim.minY;ly<=lim.maxY;ly+=6)
        C.isLit({x:g.x+g.w/2,y:C.G-6},{t:st.t,lamps:[{x:lx,y:ly}],level:lv})?open++:closed++;
    console.log(`Ворота ур.${li+1} @${g.x}: открывающих позиций лампы ${open}, закрывающих ${closed} `
      + (open&&closed?'✓':'✗ ворота статичны — механика не работает'));
  }
}

/* ---- 2. Автопилот-планировщик ---- */
const DT=1/60, TICK=0.12, LAMP_SPEED=430, HOR=2.2, HDT=1/30;
const clone=st=>{const c=structuredClone({...st,level:null});c.level=st.level;return c;};

function moveToward(L,tx,ty,dt){   // цель в мировых координатах
  const dx=tx-L.x, dy=ty-L.y, d=Math.hypot(dx,dy), m=LAMP_SPEED*dt;
  if(d<=m){L.x=tx;L.y=ty;} else {L.x+=dx/d*m;L.y+=dy/d*m;}
}
function rollout(st,tx,ty,act){
  const c=clone(st); if(act!==undefined)c.active=act;
  let steps=Math.round(HOR/HDT), died=false;
  for(let i=0;i<steps;i++){
    moveToward(c.lamps[c.active],tx,ty,HDT);
    C.update(c,HDT);
    if(c.mode==='fall'){died=true;break;}
    if(c.mode==='win')break;
  }
  return {x:c.charX,died,coins:c.coins.filter(k=>k.got).length,win:c.mode==='win'};
}
function plan(st){
  const lim=st.lim; let best=null;
  const NX=22,NY=9;
  const tryAct=st.lamps.length>1?[...st.lamps.keys()]:[undefined];
  for(const act of tryAct)
  for(let i=0;i<NX;i++) for(let j=0;j<NY;j++){
    const tx=st.camX+lim.pad+(C.VW-2*lim.pad)*i/(NX-1);
    const ty=lim.minY+(lim.maxY-lim.minY)*j/(NY-1);
    const r=rollout(st,tx,ty,act);
    const score=r.x + (r.died?-500:0) + r.coins*35 + (r.win?300:0);
    if(!best||score>best.score) best={score,tx,ty,act};
  }
  return best;
}
function solve(li){
  const st=C.createState(li); let time=0,plans=0;
  while(time<70){
    const p=plan(st); plans++;
    if(p.act!==undefined) st.active=p.act;
    for(let i=0;i<Math.round(TICK/DT);i++){
      moveToward(st.lamps[st.active],p.tx,p.ty,DT);
      const r=C.update(st,DT); time+=DT;
      if(r==='restart') return {win:false,x:st.charX,time};
      if(st.mode==='win') return {win:true,stars:C.starsOf(st),time};
    }
  }
  return {win:false,timeout:true,x:st.charX};
}
// пассивный прогон: лампу не трогаем — уровень не должен проходиться сам
function passive(li){
  const st=C.createState(li);
  for(let i=0;i<Math.round(70/DT);i++){
    const r=C.update(st,DT);
    if(r==='restart') return {win:false};
    if(st.mode==='win') return {win:true,stars:C.starsOf(st)};
  }
  return {win:false,timeout:true};
}
const only=process.argv[2]?process.argv[2].split(',').map(Number):null;
for(let i=0;i<C.LEVELS.length;i++){
  if(only&&!only.includes(i+1))continue;
  const t0=Date.now(), r=solve(i);
  console.log(`Уровень ${i+1} (${C.LEVELS[i].name}): `+
    (r.win?`✓ пройден за ${r.time.toFixed(1)}с, звёзд ${r.stars}/3`
          :`✗ ПРОВАЛ x=${r.x.toFixed(0)}/${C.LEVELS[i].finish}${r.timeout?' таймаут':' падение'}`)
    +`  [${((Date.now()-t0)/1000).toFixed(1)}s]`);
  const pv=passive(i);
  if(pv.win) console.log(`   ⚠ уровень ${i+1} проходится БЕЗ движения лампы (звёзд ${pv.stars}) — слишком просто`);
}
