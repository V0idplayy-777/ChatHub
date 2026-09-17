import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OpenAI from 'openai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const DB = path.join(__dirname, 'data', 'db.json');
fs.mkdirSync(path.dirname(DB), { recursive: true });

function loadDb(){
  if(!fs.existsSync(DB)) return {users:[],chats:[],adminMessages:[]};
  try { return JSON.parse(fs.readFileSync(DB,'utf8')); } catch { return {users:[],chats:[],adminMessages:[]}; }
}
function saveDb(){ fs.writeFileSync(DB, JSON.stringify(db,null,2)); }
let db=loadDb();
const sessions=new Map();
const rootEmail='root@chathub.local';
function hash(password,salt=crypto.randomBytes(16).toString('hex')){
  const digest=crypto.scryptSync(password,salt,64).toString('hex');
  return {salt,digest};
}
function verify(password,stored){
  const digest=crypto.scryptSync(password,stored.salt,64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(digest,'hex'),Buffer.from(stored.digest,'hex'));
}
function seed(){
  if(!db.users.some(u=>u.email===rootEmail)){
    const h=hash('admin123');
    db.users.push({id:crypto.randomUUID(),name:'Root Admin',email:rootEmail,password:h,admin:true,banned:false,createdAt:new Date().toISOString()});
    saveDb();
  }
}
seed();
const client = process.env.OPENAI_API_KEY ? new OpenAI({apiKey:process.env.OPENAI_API_KEY}) : null;
app.use(express.json({limit:'2mb'}));
app.use(express.static(path.join(__dirname,'public')));
function auth(req,res,next){
  const token=req.headers.authorization?.replace('Bearer ','');
  const user=token?sessions.get(token):null;
  if(!user) return res.status(401).json({error:'Please sign in.'});
  const fresh=db.users.find(u=>u.id===user.id);
  if(!fresh || fresh.banned) return res.status(403).json({error:'Your account is not active.'});
  req.user=fresh; req.token=token; next();
}
function admin(req,res,next){ if(!req.user.admin) return res.status(403).json({error:'Admin access required.'}); next(); }
function publicUser(u){ return {id:u.id,name:u.name,email:u.email,admin:u.admin,banned:u.banned,createdAt:u.createdAt}; }

app.post('/api/signup',(req,res)=>{
  const name=String(req.body.name||'').trim(); const email=String(req.body.email||'').trim().toLowerCase(); const password=String(req.body.password||'');
  if(name.length<2||name.length>40) return res.status(400).json({error:'Name must be 2–40 characters.'});
  if(!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({error:'Enter a valid email.'});
  if(password.length<6) return res.status(400).json({error:'Password must be at least 6 characters.'});
  if(db.users.some(u=>u.email===email)) return res.status(409).json({error:'An account with that email already exists.'});
  const passwordHash=hash(password);
  const user={id:crypto.randomUUID(),name,email,password:passwordHash,admin:false,banned:false,createdAt:new Date().toISOString()};
  db.users.push(user); saveDb();
  const token=crypto.randomBytes(32).toString('hex'); sessions.set(token,{id:user.id});
  res.json({token,user:publicUser(user)});
});

app.post('/api/login',(req,res)=>{
  const email=String(req.body.email||'').trim().toLowerCase(); const password=String(req.body.password||'');
  const user=db.users.find(u=>u.email===email);
  if(!user||!verify(password,user.password)||user.banned) return res.status(401).json({error:'Incorrect email/password or account is banned.'});
  const token=crypto.randomBytes(32).toString('hex'); sessions.set(token,{id:user.id});
  res.json({token,user:publicUser(user)});
});
app.post('/api/logout',auth,(req,res)=>{sessions.delete(req.token);res.json({ok:true});});
app.get('/api/me',auth,(req,res)=>res.json({user:publicUser(req.user)}));

app.get('/api/chats',auth,(req,res)=>res.json({chats:db.chats.filter(c=>c.userId===req.user.id)}));
app.post('/api/chats',auth,(req,res)=>{
  const chat={id:crypto.randomUUID(),userId:req.user.id,title:'New chat',messages:[],createdAt:new Date().toISOString()};
  db.chats.unshift(chat);saveDb();res.json({chat});
});
app.post('/api/chats/:id/message',auth,async(req,res)=>{
  const chat=db.chats.find(c=>c.id===req.params.id&&c.userId===req.user.id);
  if(!chat)return res.status(404).json({error:'Chat not found.'});
  const text=String(req.body.text||'').trim();
  if(!text)return res.status(400).json({error:'Message is empty.'});
  chat.messages.push({role:'user',text,at:new Date().toISOString()});
  if(chat.title==='New chat') chat.title=text.slice(0,40);
  if(!client){ chat.messages.push({role:'assistant',text:'AI is not connected yet. Add OPENAI_API_KEY to your .env file, restart the server, and try again.',at:new Date().toISOString()}); saveDb(); return res.json({chat}); }
  try{
    const history=chat.messages.slice(-20).map(m=>({role:m.role==='assistant'?'assistant':'user',content:m.text}));
    const response=await client.responses.create({model:'gpt-5.6-luna',input:history});
    const answer=response.output_text||'I could not generate a response.';
    chat.messages.push({role:'assistant',text:answer,at:new Date().toISOString()}); saveDb(); res.json({chat});
  }catch(err){ console.error(err); res.status(500).json({error:'The AI request failed. Check your API key and server console.'}); }
});

app.post('/api/images',auth,async(req,res)=>{
  const prompt=String(req.body.prompt||'').trim();
  if(!prompt)return res.status(400).json({error:'Describe the picture you want.'});
  if(!client)return res.status(503).json({error:'Image generation needs OPENAI_API_KEY in .env.'});
  try{
    const result=await client.images.generate({model:'gpt-image-2',prompt,size:'1024x1024'});
    const b64=result.data?.[0]?.b64_json;
    if(!b64) throw new Error('No image returned');
    res.json({image:`data:image/png;base64,${b64}`});
  }catch(err){console.error(err);res.status(500).json({error:'Image generation failed. Check your API key and server console.'});}
});

app.get('/api/admin/users',auth,admin,(req,res)=>res.json({users:db.users.map(publicUser)}));
app.post('/api/admin/users/:id/toggle-admin',auth,admin,(req,res)=>{
  const u=db.users.find(x=>x.id===req.params.id); if(!u)return res.status(404).json({error:'User not found.'});
  if(u.email===rootEmail)return res.status(400).json({error:'Root admin cannot be changed.'});
  u.admin=!u.admin;saveDb();res.json({user:publicUser(u)});
});
app.post('/api/admin/users/:id/toggle-ban',auth,admin,(req,res)=>{
  const u=db.users.find(x=>x.id===req.params.id); if(!u)return res.status(404).json({error:'User not found.'});
  if(u.email===rootEmail)return res.status(400).json({error:'Root admin cannot be banned.'});
  u.banned=!u.banned;saveDb();res.json({user:publicUser(u)});
});
app.get('/api/admin/messages',auth,admin,(req,res)=>res.json({messages:db.adminMessages}));
app.post('/api/admin/messages',auth,admin,(req,res)=>{const text=String(req.body.text||'').trim();if(!text)return res.status(400).json({error:'Message is empty.'});db.adminMessages.push({id:crypto.randomUUID(),userId:req.user.id,name:req.user.name,text,at:new Date().toISOString()});saveDb();res.json({ok:true});});

app.use((req,res,next)=>{ if(req.method==='GET' && !req.path.startsWith('/api/')) return res.sendFile(path.join(__dirname,'public','index.html')); next(); });
app.listen(PORT,()=>console.log(`ChatHub running at http://localhost:${PORT}`));
