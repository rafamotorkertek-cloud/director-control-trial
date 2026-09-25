
require('dotenv').config();
const express=require('express');
const path=require('path');
const fs=require('fs');
const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const Database=require('better-sqlite3');
const helmet=require('helmet');
const rateLimit=require('express-rate-limit');
const multer=require('multer');

const app=express();
const PORT=process.env.PORT||3000;
const SECRET=process.env.JWT_SECRET||'CHANGE_THIS_SECRET_IN_PRODUCTION';
const TZ=process.env.APP_TIMEZONE||'Asia/Jakarta';
const DB_PATH=process.env.DB_PATH||path.join(__dirname,'data','director-control.db');
const UPLOAD_DIR=process.env.UPLOAD_DIR||path.join(__dirname,'uploads');
fs.mkdirSync(path.dirname(DB_PATH),{recursive:true}); fs.mkdirSync(UPLOAD_DIR,{recursive:true});

app.disable('x-powered-by');
app.use(helmet({crossOriginResourcePolicy:{policy:'cross-origin'}}));
app.use(express.json({limit:'2mb'}));
app.use(rateLimit({windowMs:15*60*1000,limit:500,standardHeaders:true,legacyHeaders:false}));
app.use('/uploads',express.static(UPLOAD_DIR,{index:false}));

const db=new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS units(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,name TEXT NOT NULL,role TEXT NOT NULL,unit_id INTEGER,active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS targets(id INTEGER PRIMARY KEY AUTOINCREMENT,unit_id INTEGER NOT NULL,period TEXT NOT NULL,metric_code TEXT NOT NULL,metric_name TEXT NOT NULL,target_value REAL NOT NULL,unit TEXT DEFAULT '',created_by INTEGER,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(unit_id,period,metric_code));
CREATE TABLE IF NOT EXISTS daily_sales(id INTEGER PRIMARY KEY AUTOINCREMENT,unit_id INTEGER NOT NULL,sale_date TEXT NOT NULL,actual_value REAL NOT NULL DEFAULT 0,notes TEXT DEFAULT '',entered_by INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(unit_id,sale_date));
CREATE TABLE IF NOT EXISTS financial_daily(id INTEGER PRIMARY KEY AUTOINCREMENT,unit_id INTEGER NOT NULL,record_date TEXT NOT NULL,omzet REAL DEFAULT 0,hpp REAL DEFAULT 0,operating_cost REAL DEFAULT 0,notes TEXT DEFAULT '',entered_by INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(unit_id,record_date));
CREATE TABLE IF NOT EXISTS cash_daily(id INTEGER PRIMARY KEY AUTOINCREMENT,unit_id INTEGER NOT NULL,record_date TEXT NOT NULL,opening_balance REAL DEFAULT 0,cash_in REAL DEFAULT 0,cash_out REAL DEFAULT 0,transfer_amount REAL DEFAULT 0,expected_ending REAL DEFAULT 0,counted_ending REAL,cash_difference REAL,notes TEXT DEFAULT '',entered_by INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(unit_id,record_date));
CREATE TABLE IF NOT EXISTS issues(id INTEGER PRIMARY KEY AUTOINCREMENT,unit_id INTEGER NOT NULL,title TEXT NOT NULL,description TEXT DEFAULT '',priority TEXT DEFAULT 'MEDIUM',status TEXT DEFAULT 'OPEN',assigned_to INTEGER,due_at TEXT,created_by INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS actions(id INTEGER PRIMARY KEY AUTOINCREMENT,unit_id INTEGER NOT NULL,source_type TEXT DEFAULT 'MANUAL',source_id INTEGER,title TEXT NOT NULL,description TEXT DEFAULT '',priority TEXT DEFAULT 'MEDIUM',status TEXT DEFAULT 'OPEN',assigned_to INTEGER NOT NULL,created_by INTEGER NOT NULL,due_at TEXT NOT NULL,completed_at TEXT,completion_notes TEXT DEFAULT '',requires_approval INTEGER DEFAULT 0,approved_by INTEGER,approved_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS notifications(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,type TEXT NOT NULL,title TEXT NOT NULL,message TEXT NOT NULL,read_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS evidences(id INTEGER PRIMARY KEY AUTOINCREMENT,unit_id INTEGER NOT NULL,issue_id INTEGER,action_id INTEGER,file_path TEXT NOT NULL,caption TEXT DEFAULT '',uploaded_by INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sops(id INTEGER PRIMARY KEY AUTOINCREMENT,unit_id INTEGER,title TEXT NOT NULL,description TEXT DEFAULT '',frequency TEXT DEFAULT 'DAILY',active INTEGER DEFAULT 1,created_by INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS sop_items(id INTEGER PRIMARY KEY AUTOINCREMENT,sop_id INTEGER NOT NULL,title TEXT NOT NULL,weight REAL DEFAULT 1,critical INTEGER DEFAULT 0,sort_order INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS sop_executions(id INTEGER PRIMARY KEY AUTOINCREMENT,unit_id INTEGER NOT NULL,sop_id INTEGER NOT NULL,executor_id INTEGER NOT NULL,execution_date TEXT NOT NULL,score REAL DEFAULT 0,status TEXT DEFAULT 'OPEN',notes TEXT DEFAULT '',created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(unit_id,sop_id,execution_date));
CREATE TABLE IF NOT EXISTS sop_execution_items(id INTEGER PRIMARY KEY AUTOINCREMENT,execution_id INTEGER NOT NULL,sop_item_id INTEGER NOT NULL,status TEXT DEFAULT 'PENDING',notes TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS kpi_snapshots(id INTEGER PRIMARY KEY AUTOINCREMENT,unit_id INTEGER NOT NULL,period TEXT NOT NULL,total_score REAL DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(unit_id,period));
CREATE TABLE IF NOT EXISTS audit_trail(id INTEGER PRIMARY KEY AUTOINCREMENT,entity_type TEXT NOT NULL,entity_id INTEGER NOT NULL,action TEXT NOT NULL,old_value TEXT,new_value TEXT,user_id INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS checklist_items(id INTEGER PRIMARY KEY AUTOINCREMENT,unit_id INTEGER,title TEXT NOT NULL,active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS checklist_status(id INTEGER PRIMARY KEY AUTOINCREMENT,item_id INTEGER NOT NULL,unit_id INTEGER NOT NULL,status TEXT DEFAULT 'PENDING',notes TEXT DEFAULT '',completed_by INTEGER,completed_date TEXT,UNIQUE(item_id,completed_date));
CREATE TABLE IF NOT EXISTS closing_reports(id INTEGER PRIMARY KEY AUTOINCREMENT,unit_id INTEGER NOT NULL,report_date TEXT NOT NULL,omzet REAL DEFAULT 0,notes TEXT DEFAULT '',submitted_by INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(unit_id,report_date));
`);

const seedUnits=['Resto The Heaven','Glamping The Heaven','Kahyangan','Central Kitchen Jogja','Central Kitchen Wonosobo','Distro Helm'];
const insUnit=db.prepare('INSERT OR IGNORE INTO units(name) VALUES(?)');
seedUnits.forEach(x=>insUnit.run(x));
const units=db.prepare('SELECT * FROM units ORDER BY id').all();

function ensureUser(username,password,name,role,unit_id=null){
 const old=db.prepare('SELECT id FROM users WHERE username=?').get(username);
 if(!old) db.prepare('INSERT INTO users(username,password_hash,name,role,unit_id) VALUES(?,?,?,?,?)').run(username,bcrypt.hashSync(password,10),name,role,unit_id);
}
ensureUser('direktur','123456','Direktur','DIRECTOR',null);
ensureUser('manager','123456','Manager Demo','MANAGER',units[0]?.id||1);
ensureUser('leader','123456','Leader Demo','LEADER',units[0]?.id||1);
ensureUser('accounting','123456','Accounting','ACCOUNTING',null);

function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function month(){return today().slice(0,7);}
function tokenFor(u){return jwt.sign({id:u.id,role:u.role,unit_id:u.unit_id},SECRET,{expiresIn:process.env.JWT_EXPIRES_IN||'8h'});}
function auth(req,res,next){try{const h=req.headers.authorization||'';if(!h.startsWith('Bearer '))return res.status(401).json({error:'UNAUTHORIZED'});req.user=jwt.verify(h.slice(7),SECRET);next()}catch(e){res.status(401).json({error:'INVALID_TOKEN'})}}
function role(...roles){return (req,res,next)=>roles.includes(req.user.role)?next():res.status(403).json({error:'FORBIDDEN'})}
function canUnit(req,unitId){return req.user.role==='DIRECTOR'||req.user.role==='ACCOUNTING'||Number(req.user.unit_id)===Number(unitId)}
function log(entity,id,action,oldv,newv,user){db.prepare('INSERT INTO audit_trail(entity_type,entity_id,action,old_value,new_value,user_id) VALUES(?,?,?,?,?,?)').run(entity,id,action,oldv?JSON.stringify(oldv):null,newv?JSON.stringify(newv):null,user)}
function notify(userId,type,title,message){db.prepare('INSERT INTO notifications(user_id,type,title,message) VALUES(?,?,?,?,?)').run(userId,type,title,message)}
function notifyDirectors(type,title,message){db.prepare("SELECT id FROM users WHERE role='DIRECTOR' AND active=1").all().forEach(u=>notify(u.id,type,title,message))}
function json(res,data){res.json(data)}

app.get('/api/health',(req,res)=>res.json({status:'ok',app:'Director Control',version:'1.0.0',timezone:TZ,time:new Date().toISOString()}));

app.post('/api/auth/login',(req,res)=>{
 const {username,password}=req.body||{}; const u=db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(username);
 if(!u||!bcrypt.compareSync(password||'',u.password_hash))return res.status(401).json({error:'USERNAME_OR_PASSWORD_INVALID'});
 const safe={id:u.id,username:u.username,name:u.name,role:u.role,unit_id:u.unit_id};
 res.json({token:tokenFor(u),user:safe});
});
app.get('/api/me',auth,(req,res)=>json(res,db.prepare('SELECT id,username,name,role,unit_id FROM users WHERE id=?').get(req.user.id)));

app.get('/api/units',auth,(req,res)=>json(res,db.prepare('SELECT * FROM units WHERE active=1 ORDER BY name').all()));
app.get('/api/users',auth,role('DIRECTOR','ACCOUNTING'),(req,res)=>json(res,db.prepare('SELECT id,name,username,role,unit_id FROM users WHERE active=1 ORDER BY name').all()));

app.get('/api/dashboard',auth,(req,res)=>{
 const us=req.user.role==='DIRECTOR'||req.user.role==='ACCOUNTING'?units:units.filter(u=>u.id===req.user.unit_id);
 const rows=us.map(u=>{
   const target=db.prepare("SELECT target_value FROM targets WHERE unit_id=? AND period=? AND metric_code='OMZET'").get(u.id,month());
   const sale=db.prepare('SELECT actual_value FROM daily_sales WHERE unit_id=? AND sale_date=?').get(u.id,today());
   const fin=db.prepare('SELECT omzet,hpp,operating_cost FROM financial_daily WHERE unit_id=? AND record_date=?').get(u.id,today());
   const cash=db.prepare('SELECT cash_difference FROM cash_daily WHERE unit_id=? AND record_date=?').get(u.id,today());
   const open=db.prepare("SELECT COUNT(*) c FROM actions WHERE unit_id=? AND status!='DONE'").get(u.id).c;
   const overdue=db.prepare("SELECT COUNT(*) c FROM actions WHERE unit_id=? AND status!='DONE' AND due_at < datetime('now')").get(u.id).c;
   const kpi=db.prepare('SELECT total_score FROM kpi_snapshots WHERE unit_id=? AND period=?').get(u.id,month());
   const sop=db.prepare('SELECT AVG(score) score FROM sop_executions WHERE unit_id=? AND execution_date>=date(?)').get(u.id,month()+'-01');
   const targetv=target?.target_value||0, actual=sale?.actual_value??fin?.omzet??0;
   const ach=targetv?Math.round(actual/targetv*100):0;
   return {unit_id:u.id,unit_name:u.name,target:targetv,actual,gap:actual-targetv,achievement:ach,kpi_score:kpi?.total_score||0,sop_score:Math.round(sop?.score||0),open_actions:open,overdue_actions:overdue,cash_difference:cash?.cash_difference??null,profit:fin?(fin.omzet-fin.hpp-fin.operating_cost):null};
 });
 res.json({date:today(),month:month(),units:rows});
});

app.get('/api/targets',auth,(req,res)=>{
 let sql='SELECT t.*,u.name unit_name FROM targets t JOIN units u ON u.id=t.unit_id'; let args=[];
 if(req.user.role!=='DIRECTOR'&&req.user.role!=='ACCOUNTING'){sql+=' WHERE t.unit_id=?';args.push(req.user.unit_id)}
 sql+=' ORDER BY t.period DESC,u.name'; json(res,db.prepare(sql).all(...args));
});
app.put('/api/targets',auth,role('DIRECTOR'),(req,res)=>{
 const {unit_id,period,metric_code='OMZET',metric_name='Omzet',target_value,unit='IDR'}=req.body||{};
 if(!unit_id||!period||target_value==null)return res.status(400).json({error:'INVALID_TARGET'});
 db.prepare(`INSERT INTO targets(unit_id,period,metric_code,metric_name,target_value,unit,created_by) VALUES(?,?,?,?,?,?,?)
 ON CONFLICT(unit_id,period,metric_code) DO UPDATE SET target_value=excluded.target_value,metric_name=excluded.metric_name,unit=excluded.unit,updated_at=CURRENT_TIMESTAMP`)
 .run(unit_id,period,metric_code,metric_name,target_value,unit,req.user.id); res.json({ok:true});
});

app.get('/api/sales/daily',auth,(req,res)=>{
 const date=req.query.date||today(); let sql='SELECT s.*,u.name unit_name FROM daily_sales s JOIN units u ON u.id=s.unit_id';let args=[];
 if(req.user.role!=='DIRECTOR'&&req.user.role!=='ACCOUNTING'){sql+=' WHERE s.unit_id=? AND s.sale_date=?';args=[req.user.unit_id,date]}else{sql+=' WHERE s.sale_date=?';args=[date]}
 json(res,db.prepare(sql+' ORDER BY u.name').all(...args));
});
app.put('/api/sales/daily',auth,(req,res)=>{
 const {unit_id,sale_date= today(),actual_value,notes=''}=req.body||{};
 if(!canUnit(req,unit_id)||actual_value==null)return res.status(403).json({error:'FORBIDDEN_OR_INVALID'});
 db.prepare(`INSERT INTO daily_sales(unit_id,sale_date,actual_value,notes,entered_by) VALUES(?,?,?,?,?)
 ON CONFLICT(unit_id,sale_date) DO UPDATE SET actual_value=excluded.actual_value,notes=excluded.notes,entered_by=excluded.entered_by,updated_at=CURRENT_TIMESTAMP`)
 .run(unit_id,sale_date,actual_value,notes,req.user.id); res.json({ok:true});
});

app.get('/api/finance/daily',auth,(req,res)=>{
 const date=req.query.date||today(); let sql='SELECT f.*,u.name unit_name FROM financial_daily f JOIN units u ON u.id=f.unit_id';let args=[];
 if(req.user.role!=='DIRECTOR'&&req.user.role!=='ACCOUNTING'){sql+=' WHERE f.unit_id=? AND f.record_date=?';args=[req.user.unit_id,date]}else{sql+=' WHERE f.record_date=?';args=[date]}
 json(res,db.prepare(sql+' ORDER BY u.name').all(...args));
});
app.put('/api/finance/daily',auth,(req,res)=>{
 const {unit_id,record_date=today(),omzet=0,hpp=0,operating_cost=0,notes=''}=req.body||{};
 if(!canUnit(req,unit_id))return res.status(403).json({error:'FORBIDDEN'});
 db.prepare(`INSERT INTO financial_daily(unit_id,record_date,omzet,hpp,operating_cost,notes,entered_by) VALUES(?,?,?,?,?,?,?)
 ON CONFLICT(unit_id,record_date) DO UPDATE SET omzet=excluded.omzet,hpp=excluded.hpp,operating_cost=excluded.operating_cost,notes=excluded.notes,entered_by=excluded.entered_by,updated_at=CURRENT_TIMESTAMP`)
 .run(unit_id,record_date,omzet,hpp,operating_cost,notes,req.user.id); res.json({ok:true});
});

app.get('/api/cash/daily',auth,(req,res)=>{
 const date=req.query.date||today(); let sql='SELECT c.*,u.name unit_name FROM cash_daily c JOIN units u ON u.id=c.unit_id';let args=[];
 if(req.user.role!=='DIRECTOR'&&req.user.role!=='ACCOUNTING'){sql+=' WHERE c.unit_id=? AND c.record_date=?';args=[req.user.unit_id,date]}else{sql+=' WHERE c.record_date=?';args=[date]}
 json(res,db.prepare(sql+' ORDER BY u.name').all(...args));
});
app.put('/api/cash/daily',auth,(req,res)=>{
 const {unit_id,record_date=today(),opening_balance=0,cash_in=0,cash_out=0,transfer_amount=0,counted_ending=null,notes=''}=req.body||{};
 if(!canUnit(req,unit_id))return res.status(403).json({error:'FORBIDDEN'});
 const expected=Number(opening_balance)+Number(cash_in)-Number(cash_out), diff=counted_ending==null?null:Number(counted_ending)-expected;
 db.prepare(`INSERT INTO cash_daily(unit_id,record_date,opening_balance,cash_in,cash_out,transfer_amount,expected_ending,counted_ending,cash_difference,notes,entered_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)
 ON CONFLICT(unit_id,record_date) DO UPDATE SET opening_balance=excluded.opening_balance,cash_in=excluded.cash_in,cash_out=excluded.cash_out,transfer_amount=excluded.transfer_amount,expected_ending=excluded.expected_ending,counted_ending=excluded.counted_ending,cash_difference=excluded.cash_difference,notes=excluded.notes,entered_by=excluded.entered_by,updated_at=CURRENT_TIMESTAMP`)
 .run(unit_id,record_date,opening_balance,cash_in,cash_out,transfer_amount,expected,counted_ending,diff,notes,req.user.id);
 if(diff!==null&&Math.abs(diff)>50000)notifyDirectors('CASH_VARIANCE','Cash variance',`Unit ${unit_id} memiliki selisih kas ${diff}`);
 res.json({ok:true,expected,difference:diff});
});

app.get('/api/actions',auth,(req,res)=>{
 let sql=`SELECT a.*,u.name unit_name,usr.name assigned_name FROM actions a JOIN units u ON u.id=a.unit_id LEFT JOIN users usr ON usr.id=a.assigned_to`;let args=[];
 if(req.user.role!=='DIRECTOR'){sql+=' WHERE a.unit_id=? OR a.assigned_to=?';args=[req.user.unit_id,req.user.id]}
 sql+=' ORDER BY CASE a.priority WHEN "CRITICAL" THEN 1 WHEN "HIGH" THEN 2 WHEN "MEDIUM" THEN 3 ELSE 4 END,a.due_at'; json(res,db.prepare(sql).all(...args));
});
app.post('/api/actions',auth,(req,res)=>{
 const {unit_id,title,description='',priority='MEDIUM',assigned_to,due_at,requires_approval=0}=req.body||{};
 if(!canUnit(req,unit_id)||!title||!assigned_to||!due_at)return res.status(400).json({error:'INVALID_ACTION'});
 const r=db.prepare('INSERT INTO actions(unit_id,title,description,priority,assigned_to,created_by,due_at,requires_approval) VALUES(?,?,?,?,?,?,?,?)').run(unit_id,title,description,priority,assigned_to,due_at,req.user.id,requires_approval?1:0);
 log('ACTION',r.lastInsertRowid,'CREATE',null,req.body,req.user.id); notify(assigned_to,'ACTION_ASSIGNED','Action baru',title); res.json({id:r.lastInsertRowid});
});
app.put('/api/actions/:id',auth,(req,res)=>{
 const old=db.prepare('SELECT * FROM actions WHERE id=?').get(req.params.id);if(!old)return res.status(404).json({error:'NOT_FOUND'});
 if(req.user.role!=='DIRECTOR'&&old.assigned_to!==req.user.id&&old.unit_id!==req.user.unit_id)return res.status(403).json({error:'FORBIDDEN'});
 const status=req.body.status||old.status, notes=req.body.completion_notes??old.completion_notes;
 const done=status==='DONE'?new Date().toISOString():old.completed_at;
 db.prepare('UPDATE actions SET status=?,completion_notes=?,completed_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status,notes,done,old.id);
 log('ACTION',old.id,'UPDATE',old,{status,notes},req.user.id);res.json({ok:true});
});

app.get('/api/notifications',auth,(req,res)=>json(res,db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100').all(req.user.id)));
app.get('/api/notifications/unread-count',auth,(req,res)=>json(res,db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read_at IS NULL').get(req.user.id)));
app.put('/api/notifications/read-all',auth,(req,res)=>{db.prepare('UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE user_id=? AND read_at IS NULL').run(req.user.id);res.json({ok:true})});

app.get('/api/issues',auth,(req,res)=>{
 let sql='SELECT i.*,u.name unit_name,usr.name assigned_name FROM issues i JOIN units u ON u.id=i.unit_id LEFT JOIN users usr ON usr.id=i.assigned_to';let args=[];
 if(req.user.role!=='DIRECTOR'){sql+=' WHERE i.unit_id=?';args=[req.user.unit_id]}sql+=' ORDER BY i.created_at DESC';json(res,db.prepare(sql).all(...args));
});
app.post('/api/issues',auth,(req,res)=>{
 const {unit_id,title,description='',priority='MEDIUM',assigned_to,due_at}=req.body||{};if(!canUnit(req,unit_id)||!title)return res.status(400).json({error:'INVALID'});
 const r=db.prepare('INSERT INTO issues(unit_id,title,description,priority,assigned_to,due_at,created_by) VALUES(?,?,?,?,?,?,?)').run(unit_id,title,description,priority,assigned_to||req.user.id,due_at||null,req.user.id);
 if(priority==='CRITICAL')notifyDirectors('CRITICAL_ISSUE','Critical issue',title);
 res.json({id:r.lastInsertRowid});
});

const upload=multer({storage:multer.diskStorage({destination:UPLOAD_DIR,filename:(req,file,cb)=>cb(null,Date.now()+'-'+Math.random().toString(36).slice(2)+path.extname(file.originalname).toLowerCase())}),limits:{fileSize:10*1024*1024},fileFilter:(req,file,cb)=>cb(null,['image/jpeg','image/png','image/webp','application/pdf'].includes(file.mimetype))});
app.post('/api/evidence',auth,upload.single('file'),(req,res)=>{
 if(!req.file)return res.status(400).json({error:'FILE_REQUIRED_OR_TYPE_NOT_ALLOWED'});
 const {unit_id,issue_id=null,action_id=null,caption=''}=req.body;
 if(!canUnit(req,unit_id)){fs.unlinkSync(req.file.path);return res.status(403).json({error:'FORBIDDEN'})}
 const r=db.prepare('INSERT INTO evidences(unit_id,issue_id,action_id,file_path,caption,uploaded_by) VALUES(?,?,?,?,?,?)').run(unit_id,issue_id,action_id,'/uploads/'+path.basename(req.file.path),caption,req.user.id);
 res.json({id:r.lastInsertRowid,path:'/uploads/'+path.basename(req.file.path)});
});

app.get('/api/sops',auth,(req,res)=>{
 let sql='SELECT s.*,u.name unit_name FROM sops s JOIN units u ON u.id=s.unit_id';let args=[];
 if(req.user.role!=='DIRECTOR'){sql+=' WHERE s.unit_id=?';args=[req.user.unit_id]}sql+=' ORDER BY u.name,s.title';json(res,db.prepare(sql).all(...args));
});
app.post('/api/sops',auth,role('DIRECTOR'),(req,res)=>{
 const {unit_id,title,description='',frequency='DAILY',items=[]}=req.body||{};if(!unit_id||!title)return res.status(400).json({error:'INVALID'});
 const tx=db.transaction(()=>{const r=db.prepare('INSERT INTO sops(unit_id,title,description,frequency,created_by) VALUES(?,?,?,?,?)').run(unit_id,title,description,frequency,req.user.id);const ins=db.prepare('INSERT INTO sop_items(sop_id,title,weight,critical,sort_order) VALUES(?,?,?,?,?)');items.forEach((x,i)=>ins.run(r.lastInsertRowid,x.title,x.weight||1,x.critical?1:0,i));return r.lastInsertRowid});res.json({id:tx()});
});
app.post('/api/sops/:id/execute',auth,(req,res)=>{
 const s=db.prepare('SELECT * FROM sops WHERE id=?').get(req.params.id);if(!s||!canUnit(req,s.unit_id))return res.status(403).json({error:'FORBIDDEN'});
 const d=req.body.execution_date||today();const old=db.prepare('SELECT * FROM sop_executions WHERE unit_id=? AND sop_id=? AND execution_date=?').get(s.unit_id,s.id,d);
 const eid=old?.id||db.prepare('INSERT INTO sop_executions(unit_id,sop_id,executor_id,execution_date) VALUES(?,?,?,?)').run(s.unit_id,s.id,req.user.id,d).lastInsertRowid;
 if(!old){const ins=db.prepare('INSERT INTO sop_execution_items(execution_id,sop_item_id) VALUES(?,?)');db.prepare('SELECT id FROM sop_items WHERE sop_id=?').all(s.id).forEach(x=>ins.run(eid,x.id))}
 res.json({execution_id:eid,items:db.prepare('SELECT sei.*,si.title,si.weight,si.critical FROM sop_execution_items sei JOIN sop_items si ON si.id=sei.sop_item_id WHERE sei.execution_id=?').all(eid)});
});
app.put('/api/sop-executions/:id/items/:itemId',auth,(req,res)=>{
 const ex=db.prepare('SELECT * FROM sop_executions WHERE id=?').get(req.params.id);if(!ex||!canUnit(req,ex.unit_id))return res.status(403).json({error:'FORBIDDEN'});
 db.prepare('UPDATE sop_execution_items SET status=?,notes=? WHERE execution_id=? AND sop_item_id=?').run(req.body.status||'PENDING',req.body.notes||'',ex.id,req.params.itemId);res.json({ok:true});
});
app.post('/api/sop-executions/:id/submit',auth,(req,res)=>{
 const ex=db.prepare('SELECT * FROM sop_executions WHERE id=?').get(req.params.id);if(!ex||!canUnit(req,ex.unit_id))return res.status(403).json({error:'FORBIDDEN'});
 const rows=db.prepare('SELECT sei.status,si.weight,si.critical,si.title FROM sop_execution_items sei JOIN sop_items si ON si.id=sei.sop_item_id WHERE sei.execution_id=?').all(ex.id);
 const valid=rows.filter(x=>x.status==='PASS'||x.status==='FAIL');const tw=valid.reduce((s,x)=>s+x.weight,0);const score=tw?valid.reduce((s,x)=>s+(x.status==='PASS'?x.weight:0),0)/tw*100:0;
 db.prepare('UPDATE sop_executions SET score=?,status=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(score,'COMPLETED',req.body.notes||'',ex.id);
 rows.filter(x=>x.critical&&x.status==='FAIL').forEach(x=>{notifyDirectors('CRITICAL_SOP_FAIL','Critical SOP gagal',x.title+' — unit '+ex.unit_id)});
 res.json({score:Math.round(score)});
});

app.get('/api/audit-trail',auth,role('DIRECTOR','ACCOUNTING'),(req,res)=>json(res,db.prepare('SELECT a.*,u.name FROM audit_trail a JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 300').all()));

app.get('/api/briefing',auth,role('DIRECTOR'),(req,res)=>{
 const red=db.prepare(`SELECT a.*,u.name unit_name FROM actions a JOIN units u ON u.id=a.unit_id WHERE a.status!='DONE' AND (a.priority='CRITICAL' OR a.due_at<datetime('now')) ORDER BY a.due_at LIMIT 10`).all();
 const low=db.prepare(`SELECT u.name, COALESCE((SELECT target_value FROM targets t WHERE t.unit_id=u.id AND t.period=? AND t.metric_code='OMZET'),0) target,COALESCE((SELECT actual_value FROM daily_sales s WHERE s.unit_id=u.id AND s.sale_date=?),0) actual FROM units u`).all(month(),today()).map(x=>({...x,achievement:x.target?x.actual/x.target*100:0})).filter(x=>x.target&&x.achievement<80);
 res.json({date:today(),critical_actions:red,low_sales:low,unread:db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read_at IS NULL').get(req.user.id).c});
});

const INDEX_HTML=Buffer.from('PCFkb2N0eXBlIGh0bWw+CjxodG1sIGxhbmc9ImlkIj48aGVhZD48bWV0YSBjaGFyc2V0PSJ1dGYtOCI+PG1ldGEgbmFtZT0idmlld3BvcnQiIGNvbnRlbnQ9IndpZHRoPWRldmljZS13aWR0aCxpbml0aWFsLXNjYWxlPTEiPgo8bWV0YSBuYW1lPSJ0aGVtZS1jb2xvciIgY29udGVudD0iIzExMSI+PHRpdGxlPkRpcmVjdG9yIENvbnRyb2w8L3RpdGxlPgo8c3R5bGU+Cip7Ym94LXNpemluZzpib3JkZXItYm94fWJvZHl7bWFyZ2luOjA7Zm9udC1mYW1pbHk6QXJpYWw7YmFja2dyb3VuZDojZjNmNGY2O2NvbG9yOiMxMTF9LnRvcHtiYWNrZ3JvdW5kOiMxMTE7Y29sb3I6I2ZmZjtwYWRkaW5nOjE0cHggMThweDtkaXNwbGF5OmZsZXg7anVzdGlmeS1jb250ZW50OnNwYWNlLWJldHdlZW47YWxpZ24taXRlbXM6Y2VudGVyfS53cmFwe2Rpc3BsYXk6ZmxleDttaW4taGVpZ2h0OmNhbGMoMTAwdmggLSA2MHB4KX1hc2lkZXt3aWR0aDoyMjBweDtiYWNrZ3JvdW5kOiNmZmY7cGFkZGluZzoxMnB4O2JvcmRlci1yaWdodDoxcHggc29saWQgI2RkZH1hc2lkZSBidXR0b257ZGlzcGxheTpibG9jazt3aWR0aDoxMDAlO2JvcmRlcjowO2JhY2tncm91bmQ6I2YzZjNmMzttYXJnaW4tYm90dG9tOjdweDtwYWRkaW5nOjExcHg7dGV4dC1hbGlnbjpsZWZ0O2JvcmRlci1yYWRpdXM6OHB4O2N1cnNvcjpwb2ludGVyfWFzaWRlIGJ1dHRvbi5vbntiYWNrZ3JvdW5kOiMxMTE7Y29sb3I6I2ZmZn1tYWlue2ZsZXg6MTtwYWRkaW5nOjE4cHh9LmdyaWR7ZGlzcGxheTpncmlkO2dyaWQtdGVtcGxhdGUtY29sdW1uczpyZXBlYXQoYXV0by1maXQsbWlubWF4KDE3MHB4LDFmcikpO2dhcDoxMnB4fS5jYXJke2JhY2tncm91bmQ6I2ZmZjtib3JkZXI6MXB4IHNvbGlkICNkZGQ7Ym9yZGVyLXJhZGl1czoxM3B4O3BhZGRpbmc6MTVweH0ubWV0cmljIHNtYWxse2NvbG9yOiM2NjY7Zm9udC13ZWlnaHQ6NzAwfS5tZXRyaWMgc3Ryb25ne2Rpc3BsYXk6YmxvY2s7Zm9udC1zaXplOjIzcHg7bWFyZ2luLXRvcDo3cHh9LnRhYmxle292ZXJmbG93OmF1dG87YmFja2dyb3VuZDojZmZmO2JvcmRlcjoxcHggc29saWQgI2RkZDtib3JkZXItcmFkaXVzOjEzcHh9LnRhYmxlIHRhYmxle3dpZHRoOjEwMCU7Ym9yZGVyLWNvbGxhcHNlOmNvbGxhcHNlO21pbi13aWR0aDo4MDBweH0udGFibGUgdGgsLnRhYmxlIHRke3BhZGRpbmc6MTBweDtib3JkZXItYm90dG9tOjFweCBzb2xpZCAjZWVlO3RleHQtYWxpZ246bGVmdH0udGFibGUgdGh7Zm9udC1zaXplOjEycHg7Y29sb3I6IzY2NjtiYWNrZ3JvdW5kOiNmYWZhZmF9LnJlZHtjb2xvcjojYjkxYzFjO2ZvbnQtd2VpZ2h0OjgwMH0ueWVsbG93e2NvbG9yOiNhMTYyMDc7Zm9udC13ZWlnaHQ6ODAwfS5ncmVlbntjb2xvcjojMTU4MDNkO2ZvbnQtd2VpZ2h0OjgwMH0uYnRue2JhY2tncm91bmQ6IzExMTtjb2xvcjojZmZmO2JvcmRlcjowO2JvcmRlci1yYWRpdXM6OHB4O3BhZGRpbmc6OXB4IDEycHg7Y3Vyc29yOnBvaW50ZXJ9LmJ0bi5hbHR7YmFja2dyb3VuZDojZWVlO2NvbG9yOiMxMTF9aW5wdXQsc2VsZWN0e3BhZGRpbmc6OXB4O2JvcmRlcjoxcHggc29saWQgI2NjYztib3JkZXItcmFkaXVzOjhweDt3aWR0aDoxMDAlfS5mb3Jte2Rpc3BsYXk6Z3JpZDtncmlkLXRlbXBsYXRlLWNvbHVtbnM6cmVwZWF0KGF1dG8tZml0LG1pbm1heCgxODBweCwxZnIpKTtnYXA6MTBweH0uYWxlcnR7cGFkZGluZzoxMXB4O2JvcmRlci1yYWRpdXM6OXB4O2JhY2tncm91bmQ6I2ZmZjFmMjtib3JkZXItbGVmdDo0cHggc29saWQgI2I5MWMxYzttYXJnaW46N3B4IDB9QG1lZGlhKG1heC13aWR0aDo3MDBweCl7YXNpZGV7d2lkdGg6NzBweH1hc2lkZSBidXR0b257Zm9udC1zaXplOjB9YXNpZGUgYnV0dG9uOmJlZm9yZXtjb250ZW50OifigKInO2ZvbnQtc2l6ZToyMHB4fS53cmFwIG1haW57cGFkZGluZzoxMHB4fX0KPC9zdHlsZT48L2hlYWQ+Cjxib2R5PjxkaXYgY2xhc3M9InRvcCI+PGI+TVVMVEFaQU0gREVWRUxPUE1FTlQg4oCUIERJUkVDVE9SIENPTlRST0w8L2I+PHNwYW4gaWQ9IndobyI+PC9zcGFuPjwvZGl2Pgo8ZGl2IGNsYXNzPSJ3cmFwIj48YXNpZGUgaWQ9Im5hdiI+PC9hc2lkZT48bWFpbiBpZD0iYXBwIj48L21haW4+PC9kaXY+CjxzY3JpcHQ+CmxldCB0b2tlbj1sb2NhbFN0b3JhZ2UuZ2V0SXRlbSgnZGNfdG9rZW4nKSwgbWU9SlNPTi5wYXJzZShsb2NhbFN0b3JhZ2UuZ2V0SXRlbSgnZGNfbWUnKXx8J251bGwnKTsKY29uc3QgYXBwPWRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdhcHAnKSwgbmF2PWRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCduYXYnKTsKY29uc3QgbW9uZXk9dj0+bmV3IEludGwuTnVtYmVyRm9ybWF0KCdpZC1JRCcse3N0eWxlOidjdXJyZW5jeScsY3VycmVuY3k6J0lEUicsbWF4aW11bUZyYWN0aW9uRGlnaXRzOjB9KS5mb3JtYXQodnx8MCk7CmFzeW5jIGZ1bmN0aW9uIGFwaSh1cmwsb3B0PXt9KXtvcHQuaGVhZGVycz1PYmplY3QuYXNzaWduKHsnQ29udGVudC1UeXBlJzonYXBwbGljYXRpb24vanNvbid9LG9wdC5oZWFkZXJzfHx7fSk7aWYodG9rZW4pb3B0LmhlYWRlcnMuQXV0aG9yaXphdGlvbj0nQmVhcmVyICcrdG9rZW47bGV0IHI9YXdhaXQgZmV0Y2godXJsLG9wdCk7aWYoci5zdGF0dXM9PT00MDEpe2xvZ291dCgpO3Rocm93IEVycm9yKCdVTkFVVEhPUklaRUQnKX1sZXQgZD1hd2FpdCByLmpzb24oKTtpZighci5vayl0aHJvdyBFcnJvcihkLmVycm9yfHwnRVJST1InKTtyZXR1cm4gZH0KZnVuY3Rpb24gbG9nb3V0KCl7bG9jYWxTdG9yYWdlLmNsZWFyKCk7bG9jYXRpb24ucmVsb2FkKCl9CmZ1bmN0aW9uIHNldHVwTmF2KCl7ZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3dobycpLnRleHRDb250ZW50PW1lP21lLm5hbWUrJyDigKIgJyttZS5yb2xlOicnO25hdi5pbm5lckhUTUw9WydDb21tYW5kIENlbnRlcicsJ09temV0JywnUHJvZml0JywnQ2FzaCcsJ1NPUCcsJ0FjdGlvbnMnLCdJc3N1ZXMnLCdOb3RpZmljYXRpb25zJ10ubWFwKCh4LGkpPT5gPGJ1dHRvbiBvbmNsaWNrPSJ2aWV3KCR7aX0pIj4ke3h9PC9idXR0b24+YCkuam9pbignJyl9CmFzeW5jIGZ1bmN0aW9uIGxvZ2luKCl7YXBwLmlubmVySFRNTD0nPGRpdiBjbGFzcz0iY2FyZCI+PGgyPkRpcmVjdG9yIENvbnRyb2wgTG9naW48L2gyPjxkaXYgY2xhc3M9ImZvcm0iPjxsYWJlbD5Vc2VybmFtZTxpbnB1dCBpZD0idSI+PC9sYWJlbD48bGFiZWw+UGFzc3dvcmQ8aW5wdXQgaWQ9InAiIHR5cGU9InBhc3N3b3JkIj48L2xhYmVsPjwvZGl2PjxidXR0b24gY2xhc3M9ImJ0biIgc3R5bGU9Im1hcmdpbi10b3A6MTBweCIgb25jbGljaz0iZG9Mb2dpbigpIj5Mb2dpbjwvYnV0dG9uPjxwPkRlbW86IGRpcmVrdHVyIC8gMTIzNDU2PC9wPjwvZGl2Pid9CmFzeW5jIGZ1bmN0aW9uIGRvTG9naW4oKXt0cnl7bGV0IGQ9YXdhaXQgYXBpKCcvYXBpL2F1dGgvbG9naW4nLHttZXRob2Q6J1BPU1QnLGJvZHk6SlNPTi5zdHJpbmdpZnkoe3VzZXJuYW1lOnUudmFsdWUscGFzc3dvcmQ6cC52YWx1ZX0pfSk7dG9rZW49ZC50b2tlbjttZT1kLnVzZXI7bG9jYWxTdG9yYWdlLnNldEl0ZW0oJ2RjX3Rva2VuJyx0b2tlbik7bG9jYWxTdG9yYWdlLnNldEl0ZW0oJ2RjX21lJyxKU09OLnN0cmluZ2lmeShtZSkpO3N0YXJ0KCl9Y2F0Y2goZSl7YWxlcnQoZS5tZXNzYWdlKX19CmFzeW5jIGZ1bmN0aW9uIHN0YXJ0KCl7c2V0dXBOYXYoKTt2aWV3KDApfQphc3luYyBmdW5jdGlvbiB2aWV3KGkpewogaWYoIXRva2VuKXJldHVybiBsb2dpbigpOwogWy4uLm5hdi5jaGlsZHJlbl0uZm9yRWFjaCgoYixqKT0+Yi5jbGFzc0xpc3QudG9nZ2xlKCdvbicsaT09PWopKTsKIHRyeXsKIGlmKGk9PT0wKXJldHVybiBjb21tYW5kKCk7CiBpZihpPT09MSlyZXR1cm4gc2FsZXMoKTsKIGlmKGk9PT0yKXJldHVybiBwcm9maXQoKTsKIGlmKGk9PT0zKXJldHVybiBjYXNoKCk7CiBpZihpPT09NClyZXR1cm4gc29wKCk7CiBpZihpPT09NSlyZXR1cm4gYWN0aW9ucygpOwogaWYoaT09PTYpcmV0dXJuIGlzc3VlcygpOwogaWYoaT09PTcpcmV0dXJuIG5vdGlmaWNhdGlvbnMoKTsKIH1jYXRjaChlKXthcHAuaW5uZXJIVE1MPSc8ZGl2IGNsYXNzPSJjYXJkIj4nK2UubWVzc2FnZSsnPC9kaXY+J30KfQphc3luYyBmdW5jdGlvbiBjb21tYW5kKCl7bGV0IGQ9YXdhaXQgYXBpKCcvYXBpL2Rhc2hib2FyZCcpO2xldCB0PWQudW5pdHMucmVkdWNlKCh4LHUpPT4oe3RhcmdldDp4LnRhcmdldCt1LnRhcmdldCxhY3R1YWw6eC5hY3R1YWwrdS5hY3R1YWwscHJvZml0OngucHJvZml0Kyh1LnByb2ZpdHx8MCkscmVkOngucmVkKyh1Lm92ZXJkdWVfYWN0aW9ucz4wPzE6MCl9KSx7dGFyZ2V0OjAsYWN0dWFsOjAscHJvZml0OjAscmVkOjB9KTthcHAuaW5uZXJIVE1MPWA8aDE+RGlyZWN0b3IgQ29tbWFuZCBDZW50ZXI8L2gxPjxkaXYgY2xhc3M9ImdyaWQiPjxkaXYgY2xhc3M9ImNhcmQgbWV0cmljIj48c21hbGw+VEFSR0VUIE9NWkVUPC9zbWFsbD48c3Ryb25nPiR7bW9uZXkodC50YXJnZXQpfTwvc3Ryb25nPjwvZGl2PjxkaXYgY2xhc3M9ImNhcmQgbWV0cmljIj48c21hbGw+T01aRVQgQUtUVUFMPC9zbWFsbD48c3Ryb25nPiR7bW9uZXkodC5hY3R1YWwpfTwvc3Ryb25nPjwvZGl2PjxkaXYgY2xhc3M9ImNhcmQgbWV0cmljIj48c21hbGw+QUNISUVWRU1FTlQ8L3NtYWxsPjxzdHJvbmc+JHt0LnRhcmdldD8odC5hY3R1YWwvdC50YXJnZXQqMTAwKS50b0ZpeGVkKDApOjB9JTwvc3Ryb25nPjwvZGl2PjxkaXYgY2xhc3M9ImNhcmQgbWV0cmljIj48c21hbGw+TkVUIFBST0ZJVDwvc21hbGw+PHN0cm9uZz4ke21vbmV5KHQucHJvZml0KX08L3N0cm9uZz48L2Rpdj48ZGl2IGNsYXNzPSJjYXJkIG1ldHJpYyI+PHNtYWxsPlVOSVQgT1ZFUkRVRTwvc21hbGw+PHN0cm9uZz4ke3QucmVkfTwvc3Ryb25nPjwvZGl2PjwvZGl2PjxoMj5IZWFsdGggVW5pdDwvaDI+PGRpdiBjbGFzcz0idGFibGUiPiR7dGFibGVEYXNoYm9hcmQoZC51bml0cyl9PC9kaXY+YH0KZnVuY3Rpb24gdGFibGVEYXNoYm9hcmQocm93cyl7cmV0dXJuIGA8dGFibGU+PHRyPjx0aD5VTklUPC90aD48dGg+VEFSR0VUPC90aD48dGg+QUtUVUFMPC90aD48dGg+QUNIJTwvdGg+PHRoPktQSTwvdGg+PHRoPlNPUDwvdGg+PHRoPklTU1VFL0FDVElPTjwvdGg+PHRoPkNBU0g8L3RoPjwvdHI+JHtyb3dzLm1hcCh1PT5gPHRyPjx0ZD48Yj4ke3UudW5pdF9uYW1lfTwvYj48L3RkPjx0ZD4ke21vbmV5KHUudGFyZ2V0KX08L3RkPjx0ZD4ke21vbmV5KHUuYWN0dWFsKX08L3RkPjx0ZD4ke3UudGFyZ2V0Pyh1LmFjdHVhbC91LnRhcmdldCoxMDApLnRvRml4ZWQoMCk6MH0lPC90ZD48dGQ+JHtNYXRoLnJvdW5kKHUua3BpX3Njb3JlKX08L3RkPjx0ZD4ke01hdGgucm91bmQodS5zb3Bfc2NvcmUpfSU8L3RkPjx0ZD4ke3Uub3Blbl9hY3Rpb25zfS8ke3Uub3ZlcmR1ZV9hY3Rpb25zfTwvdGQ+PHRkIGNsYXNzPSIke3UuY2FzaF9kaWZmZXJlbmNlIT1udWxsJiZNYXRoLmFicyh1LmNhc2hfZGlmZmVyZW5jZSk+NTAwMDA/J3JlZCc6J2dyZWVuJ30iPiR7dS5jYXNoX2RpZmZlcmVuY2U9PW51bGw/Jy0nOm1vbmV5KHUuY2FzaF9kaWZmZXJlbmNlKX08L3RkPjwvdHI+YCkuam9pbignJyl9PC90YWJsZT5gfQphc3luYyBmdW5jdGlvbiBzYWxlcygpe2xldCBkPWF3YWl0IGFwaSgnL2FwaS9zYWxlcy9kYWlseScpO2xldCB1bml0cz1hd2FpdCBhcGkoJy9hcGkvdW5pdHMnKTtsZXQgdGFyZ2V0cz1hd2FpdCBhcGkoJy9hcGkvdGFyZ2V0cycpO2FwcC5pbm5lckhUTUw9YDxoMT5PbXpldCAmIFRhcmdldDwvaDE+PGRpdiBjbGFzcz0idGFibGUiPjx0YWJsZT48dHI+PHRoPlVOSVQ8L3RoPjx0aD5UQVJHRVQ8L3RoPjx0aD5PTVpFVCBIQVJJIElOSTwvdGg+PHRoPkFDSCU8L3RoPjx0aD48L3RoPjwvdHI+JHt1bml0cy5maWx0ZXIodT0+bWUucm9sZT09PSdESVJFQ1RPUid8fG1lLnJvbGU9PT0nQUNDT1VOVElORyd8fHUuaWQ9PT1tZS51bml0X2lkKS5tYXAodT0+e2xldCBzPWQuZmluZCh4PT54LnVuaXRfaWQ9PT11LmlkKT8uYWN0dWFsX3ZhbHVlfHwwO2xldCB0Zz10YXJnZXRzLmZpbmQoeD0+eC51bml0X2lkPT09dS5pZCYmeC5wZXJpb2Q9PT1uZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCw3KSYmeC5tZXRyaWNfY29kZT09PSdPTVpFVCcpPy50YXJnZXRfdmFsdWV8fDA7cmV0dXJuIGA8dHI+PHRkPiR7dS5uYW1lfTwvdGQ+PHRkPiR7bW9uZXkodGcpfTwvdGQ+PHRkPjxpbnB1dCBpZD0icyR7dS5pZH0iIHZhbHVlPSIke3N9IiB0eXBlPSJudW1iZXIiPjwvdGQ+PHRkPiR7dGc/KHMvdGcqMTAwKS50b0ZpeGVkKDApOjB9JTwvdGQ+PHRkPjxidXR0b24gY2xhc3M9ImJ0biIgb25jbGljaz0ic2F2ZVNhbGVzKCR7dS5pZH0sJHt0Z30pIj5TaW1wYW48L2J1dHRvbj48L3RkPjwvdHI+YH0pLmpvaW4oJycpfTwvdGFibGU+PC9kaXY+YH0KYXN5bmMgZnVuY3Rpb24gc2F2ZVNhbGVzKGlkLHRnKXthd2FpdCBhcGkoJy9hcGkvc2FsZXMvZGFpbHknLHttZXRob2Q6J1BVVCcsYm9keTpKU09OLnN0cmluZ2lmeSh7dW5pdF9pZDppZCxhY3R1YWxfdmFsdWU6K2RvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzJytpZCkudmFsdWV9KX0pO3ZpZXcoMSl9CmFzeW5jIGZ1bmN0aW9uIHByb2ZpdCgpe2xldCBkPWF3YWl0IGFwaSgnL2FwaS9maW5hbmNlL2RhaWx5Jyk7YXBwLmlubmVySFRNTD1gPGgxPlByb2ZpdCBDb250cm9sPC9oMT48ZGl2IGNsYXNzPSJ0YWJsZSI+PHRhYmxlPjx0cj48dGg+VU5JVDwvdGg+PHRoPk9NWkVUPC90aD48dGg+SFBQPC90aD48dGg+QklBWUE8L3RoPjx0aD5ORVQgUFJPRklUPC90aD48dGg+TkVUIE1BUkdJTjwvdGg+PC90cj4ke2QubWFwKHg9PntsZXQgbj14Lm9temV0LXguaHBwLXgub3BlcmF0aW5nX2Nvc3Q7cmV0dXJuIGA8dHI+PHRkPiR7eC51bml0X25hbWV9PC90ZD48dGQ+JHttb25leSh4Lm9temV0KX08L3RkPjx0ZD4ke21vbmV5KHguaHBwKX08L3RkPjx0ZD4ke21vbmV5KHgub3BlcmF0aW5nX2Nvc3QpfTwvdGQ+PHRkPiR7bW9uZXkobil9PC90ZD48dGQ+JHt4Lm9temV0PyhuL3gub216ZXQqMTAwKS50b0ZpeGVkKDEpOjB9JTwvdGQ+PC90cj5gfSkuam9pbignJyl9PC90YWJsZT48L2Rpdj48cCBjbGFzcz0ibXV0ZWQiPklucHV0IGZpbmFuY2UgbWVsYWx1aSBBUEkvYmFja2VuZDsgdGFoYXAgYmVyaWt1dG55YSBkYXBhdCBkaWJ1YXQgZm9ybSBsZW5na2FwLjwvcD5gfQphc3luYyBmdW5jdGlvbiBjYXNoKCl7bGV0IGQ9YXdhaXQgYXBpKCcvYXBpL2Nhc2gvZGFpbHknKTthcHAuaW5uZXJIVE1MPWA8aDE+Q2FzaCBDb250cm9sPC9oMT48ZGl2IGNsYXNzPSJ0YWJsZSI+PHRhYmxlPjx0cj48dGg+VU5JVDwvdGg+PHRoPk9QRU5JTkc8L3RoPjx0aD5JTjwvdGg+PHRoPk9VVDwvdGg+PHRoPkVYUEVDVEVEPC90aD48dGg+Q09VTlRFRDwvdGg+PHRoPkRJRkY8L3RoPjwvdHI+JHtkLm1hcCh4PT5gPHRyPjx0ZD4ke3gudW5pdF9uYW1lfTwvdGQ+PHRkPiR7bW9uZXkoeC5vcGVuaW5nX2JhbGFuY2UpfTwvdGQ+PHRkPiR7bW9uZXkoeC5jYXNoX2luKX08L3RkPjx0ZD4ke21vbmV5KHguY2FzaF9vdXQpfTwvdGQ+PHRkPiR7bW9uZXkoeC5leHBlY3RlZF9lbmRpbmcpfTwvdGQ+PHRkPiR7eC5jb3VudGVkX2VuZGluZz09bnVsbD8nLSc6bW9uZXkoeC5jb3VudGVkX2VuZGluZyl9PC90ZD48dGQgY2xhc3M9IiR7TWF0aC5hYnMoeC5jYXNoX2RpZmZlcmVuY2V8fDApPjUwMDAwPydyZWQnOidncmVlbid9Ij4ke3guY2FzaF9kaWZmZXJlbmNlPT1udWxsPyctJzptb25leSh4LmNhc2hfZGlmZmVyZW5jZSl9PC90ZD48L3RyPmApLmpvaW4oJycpfTwvdGFibGU+PC9kaXY+YH0KYXN5bmMgZnVuY3Rpb24gc29wKCl7bGV0IGQ9YXdhaXQgYXBpKCcvYXBpL3NvcHMnKTthcHAuaW5uZXJIVE1MPWA8aDE+U09QICYgQXVkaXQ8L2gxPjxkaXYgY2xhc3M9ImdyaWQiPiR7ZC5tYXAoeD0+YDxkaXYgY2xhc3M9ImNhcmQiPjxiPiR7eC50aXRsZX08L2I+PHA+JHt4LnVuaXRfbmFtZX08L3A+PHNwYW4gY2xhc3M9ImJhZGdlIj4ke3guZnJlcXVlbmN5fTwvc3Bhbj48L2Rpdj5gKS5qb2luKCcnKXx8JzxkaXYgY2xhc3M9ImNhcmQiPkJlbHVtIGFkYSBTT1AuPC9kaXY+J308L2Rpdj5gfQphc3luYyBmdW5jdGlvbiBhY3Rpb25zKCl7bGV0IGQ9YXdhaXQgYXBpKCcvYXBpL2FjdGlvbnMnKTthcHAuaW5uZXJIVE1MPWA8aDE+RGlyZWN0b3IgQWN0aW9uIENlbnRlcjwvaDE+JHtkLm1hcCh4PT5gPGRpdiBjbGFzcz0iY2FyZCIgc3R5bGU9Im1hcmdpbjo4cHggMCI+PGI+JHt4LnRpdGxlfTwvYj48ZGl2IGNsYXNzPSJtdXRlZCI+JHt4LnVuaXRfbmFtZX0g4oCiIFBJQyAke3guYXNzaWduZWRfbmFtZXx8Jy0nfSDigKIgRGVhZGxpbmUgJHt4LmR1ZV9hdH08L2Rpdj48ZGl2IHN0eWxlPSJtYXJnaW4tdG9wOjhweCI+PHNwYW4gY2xhc3M9ImJhZGdlIj4ke3gucHJpb3JpdHl9PC9zcGFuPiA8c3BhbiBjbGFzcz0iYmFkZ2UiPiR7eC5zdGF0dXN9PC9zcGFuPiAke3guc3RhdHVzIT09J0RPTkUnP2A8YnV0dG9uIGNsYXNzPSJidG4iIG9uY2xpY2s9ImRvbmVBY3Rpb24oJHt4LmlkfSkiPkRPTkU8L2J1dHRvbj5gOicnfTwvZGl2PjwvZGl2PmApLmpvaW4oJycpfHwnPGRpdiBjbGFzcz0iY2FyZCI+VGlkYWsgYWRhIGFjdGlvbi48L2Rpdj4nfWB9CmFzeW5jIGZ1bmN0aW9uIGRvbmVBY3Rpb24oaWQpe2F3YWl0IGFwaSgnL2FwaS9hY3Rpb25zLycraWQse21ldGhvZDonUFVUJyxib2R5OkpTT04uc3RyaW5naWZ5KHtzdGF0dXM6J0RPTkUnfSl9KTt2aWV3KDUpfQphc3luYyBmdW5jdGlvbiBpc3N1ZXMoKXtsZXQgZD1hd2FpdCBhcGkoJy9hcGkvaXNzdWVzJyk7YXBwLmlubmVySFRNTD1gPGgxPklzc3VlczwvaDE+JHtkLm1hcCh4PT5gPGRpdiBjbGFzcz0iY2FyZCIgc3R5bGU9Im1hcmdpbjo4cHggMCI+PGI+JHt4LnRpdGxlfTwvYj48ZGl2PiR7eC51bml0X25hbWV9IOKAoiAke3gucHJpb3JpdHl9IOKAoiAke3guc3RhdHVzfTwvZGl2PjxwPiR7eC5kZXNjcmlwdGlvbnx8Jyd9PC9wPjwvZGl2PmApLmpvaW4oJycpfHwnPGRpdiBjbGFzcz0iY2FyZCI+VGlkYWsgYWRhIGlzc3VlLjwvZGl2Pid9CmFzeW5jIGZ1bmN0aW9uIG5vdGlmaWNhdGlvbnMoKXtsZXQgZD1hd2FpdCBhcGkoJy9hcGkvbm90aWZpY2F0aW9ucycpO2FwcC5pbm5lckhUTUw9JzxoMT5Ob3RpZmljYXRpb25zPC9oMT4nK2QubWFwKHg9PmA8ZGl2IGNsYXNzPSJjYXJkIiBzdHlsZT0ibWFyZ2luOjhweCAwIj48Yj4ke3gudGl0bGV9PC9iPjxwPiR7eC5tZXNzYWdlfTwvcD48c21hbGw+JHt4LmNyZWF0ZWRfYXR9PC9zbWFsbD48L2Rpdj5gKS5qb2luKCcnKTthd2FpdCBhcGkoJy9hcGkvbm90aWZpY2F0aW9ucy9yZWFkLWFsbCcse21ldGhvZDonUFVUJ30pfQppZih0b2tlbiYmbWUpc3RhcnQoKTtlbHNlIGxvZ2luKCk7Cjwvc2NyaXB0PjwvYm9keT48L2h0bWw+','base64').toString('utf8');
app.get('*',(req,res)=>res.type('html').send(INDEX_HTML));
app.listen(PORT,()=>console.log(`Director Control server running on port ${PORT} (${TZ})`));
