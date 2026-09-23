'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
type Point={date:string;close:number}; type Stock={symbol:string;name:string;currency:string;points:Point[];error?:boolean};
type Profile={id:string;name:string;symbols:string[];range:string};
const MAX_SYMBOLS=24;
const ranges=[
 {value:'1d',label:'Hoje · 5 min'},
 {value:'5d',label:'5 dias · 15 min'},
 {value:'1mo',label:'1 mês'},
 {value:'6mo',label:'6 meses'},
 {value:'1y',label:'1 ano'},
];
async function readJson<T>(response:Response):Promise<T>{
 const data=await response.json();
 if(!response.ok) throw new Error(typeof data?.error==='string'?data.error:'Pedido inválido');
 return data as T;
}
export default function Home(){
 const [profiles,setProfiles]=useState<Profile[]>([]); const [activeProfileId,setActiveProfileId]=useState('');
 const [symbols,setSymbols]=useState<string[]>([]); const [range,setRange]=useState('1mo');
 const [stocks,setStocks]=useState<Stock[]>([]); const [input,setInput]=useState(''); const [newProfileName,setNewProfileName]=useState('');
 const [loading,setLoading]=useState(true); const [error,setError]=useState(''); const [profilesReady,setProfilesReady]=useState(false);
 const saveTimer=useRef<ReturnType<typeof setTimeout>|null>(null);

 async function loadProfiles(){
  try{
   const data=await readJson<{profiles:Profile[];activeProfileId:string}>(await fetch('/api/profiles'));
   setProfiles(data.profiles);
   setActiveProfileId(data.activeProfileId);
   const active=data.profiles.find((p:Profile)=>p.id===data.activeProfileId)??data.profiles[0];
   if(active){setSymbols(active.symbols);setRange(active.range)}
   setProfilesReady(true);
  }catch(err){
   setError(err instanceof Error?err.message:'Não foi possível carregar os perfis.');
  }
 }

 async function load(){setLoading(true);setError('');try{const r=await fetch(`/api/stocks?symbols=${encodeURIComponent(symbols.join(','))}&range=${range}`);if(!r.ok)throw new Error();setStocks((await r.json()).stocks)}catch{setError('Não foi possível obter as cotações.')}finally{setLoading(false)}}

 useEffect(()=>{loadProfiles()},[]);
 useEffect(()=>{if(!profilesReady)return;if(symbols.length)load();else setStocks([])},[symbols.join(','),range,profilesReady]);

 // Guarda automaticamente a configuração (símbolos/intervalo) no perfil ativo
 useEffect(()=>{
  if(!profilesReady||!activeProfileId)return;
  if(saveTimer.current)clearTimeout(saveTimer.current);
  saveTimer.current=setTimeout(()=>{
   fetch(`/api/profiles/${activeProfileId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbols,range})})
    .then(readJson<{profiles:Profile[];activeProfileId:string}>)
    .then(data=>setProfiles(data.profiles))
    .catch((err:unknown)=>setError(err instanceof Error?err.message:'Não foi possível guardar o perfil ativo.'));
  },500);
  return ()=>{if(saveTimer.current)clearTimeout(saveTimer.current)};
 },[symbols.join(','),range]);

 const visible=useMemo(()=>stocks,[stocks]);
 function add(){
  const s=input.trim().toUpperCase();
  if(!s||symbols.includes(s)){setInput('');return}
  if(symbols.length>=MAX_SYMBOLS){setError(`Cada perfil pode ter no máximo ${MAX_SYMBOLS} ações.`);return}
  setError('');setSymbols([...symbols,s]);setInput('');
 }

 async function selectProfile(id:string){
  const p=profiles.find(p=>p.id===id); if(!p)return;
  setActiveProfileId(id); setSymbols(p.symbols); setRange(p.range);
  try{
   await readJson(await fetch(`/api/profiles/${id}/activate`,{method:'POST'}));
  }catch(err){
   setError(err instanceof Error?err.message:'Não foi possível ativar o perfil.');
  }
 }
 async function createProfile(){
  try{
   const name=newProfileName.trim(); if(!name)return;
   const data=await readJson<{profiles:Profile[];activeProfileId:string}>(await fetch('/api/profiles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,symbols,range})}));
   setProfiles(data.profiles); setActiveProfileId(data.activeProfileId); setNewProfileName('');
  }catch(err){
   setError(err instanceof Error?err.message:'Não foi possível criar o perfil.');
  }
 }
 async function renameProfile(){
  try{
   const name=window.prompt('Novo nome do perfil', profiles.find(p=>p.id===activeProfileId)?.name)?.trim();
   if(!name)return;
   const data=await readJson<{profiles:Profile[];activeProfileId:string}>(await fetch(`/api/profiles/${activeProfileId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})}));
   setProfiles(data.profiles);
  }catch(err){
   setError(err instanceof Error?err.message:'Não foi possível renomear o perfil.');
  }
 }
 async function removeProfile(){
  try{
   if(profiles.length<=1)return;
   if(!window.confirm('Apagar este perfil?'))return;
   const data=await readJson<{profiles:Profile[];activeProfileId:string}>(await fetch(`/api/profiles/${activeProfileId}`,{method:'DELETE'}));
   setProfiles(data.profiles); setActiveProfileId(data.activeProfileId);
   const active=data.profiles.find((p:Profile)=>p.id===data.activeProfileId);
   if(active){setSymbols(active.symbols);setRange(active.range)}
  }catch(err){
   setError(err instanceof Error?err.message:'Não foi possível apagar o perfil.');
  }
 }

 return <main className="wrap"><header className="header"><div><div className="muted">Mercados globais</div><h1>Dashboard de ações</h1><p className="muted">Evolução das cotações em vários mercados.</p></div><button className="button secondary" onClick={load}>{loading?'A atualizar...':'Atualizar'}</button></header>
 <div className="toolbar">
  <select className="button secondary" value={activeProfileId} onChange={e=>selectProfile(e.target.value)}>
   {profiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
  </select>
  <button className="button secondary" onClick={renameProfile}>Renomear</button>
  <button className="button secondary" onClick={removeProfile}>Apagar perfil</button>
  <input value={newProfileName} onChange={e=>setNewProfileName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&createProfile()} placeholder="Nome do novo perfil"/>
  <button className="button" onClick={createProfile}>Guardar como novo perfil</button>
 </div>
 <div className="toolbar stocks-toolbar"><input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&add()} placeholder="Ticker, por exemplo ASML.AS"/><span className="muted symbol-count">{symbols.length}/{MAX_SYMBOLS}</span><button className="button" onClick={add} disabled={symbols.length>=MAX_SYMBOLS}>Adicionar</button></div>
 <div className="ranges">{ranges.map(r=><button key={r.value} className={`button secondary ${range===r.value?'active':''}`} onClick={()=>setRange(r.value)}>{r.label}</button>)}</div>{error&&<div className="error">{error}</div>}
 <section className="grid">{visible.map(s=>{const first=s.points[0]?.close,last=s.points.at(-1)?.close;const change=first&&last?(last-first)/first*100:0;const up=change>=0;return <article className="card" key={s.symbol}><div className="row"><div className="stock-title"><strong>{s.symbol}</strong><div className="muted">{s.name} · {s.currency}</div></div><button className="button secondary remove-button" aria-label={`Remover ${s.symbol}`} onClick={()=>setSymbols(symbols.filter(x=>x!==s.symbol))}>×</button></div><div className="row"><div className="price">{last?.toLocaleString('pt-PT',{maximumFractionDigits:2})??'Sem dados'}</div><b className={up?'up':'down'}>{change.toFixed(2)}%</b></div><div className="chart"><ResponsiveContainer width="100%" height="100%" debounce={100}><AreaChart data={s.points}><XAxis dataKey="date" hide/><YAxis domain={['auto','auto']} hide/><Tooltip labelFormatter={value=>new Date(String(value)).toLocaleString('pt-PT')} formatter={value=>[Number(String(value)).toLocaleString('pt-PT',{maximumFractionDigits:2}),'Cotação']}/><Area type="monotone" dataKey="close" stroke={up?'#34d399':'#fb7185'} fill={up?'#064e3b':'#4c0519'} strokeWidth={2}/></AreaChart></ResponsiveContainer></div></article>})}</section></main>
}
