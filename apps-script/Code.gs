/** Deploy this single project as owner. Keep the spreadsheet administrator-only. */
function doGet(){return HtmlService.createHtmlOutputFromFile('Index').setTitle('Employee appointments');}
function db_(){return SpreadsheetApp.openById('1qHKeZ3SGE4BYEtuYVTAc23K-lfpmBitk4OETfPPNwgg');}
function rows_(name){const s=db_().getSheetByName(name);if(!s)throw new Error('Missing backend tab: '+name);return s.getDataRange().getValues();}
function locked_(fn){const l=LockService.getScriptLock();if(!l.tryLock(15000))throw new Error('Service is busy. Please try again.');try{return fn();}finally{l.releaseLock();}}
function enabled_(v){return v===true||v===1||String(v).toLowerCase()==='true';}
function email_(v){const e=String(v||'').trim().toLowerCase();if(!/^[a-z0-9][a-z0-9._%+~-]*@afreximbank\.com$/.test(e)||e.length>254)throw new Error('Use your @afreximbank.com work email.');return e;}
function slots_(){
 const rooms=rows_('Rooms').slice(1).filter(r=>enabled_(r[2]));
 const ids=new Set();
 return rows_('Available_Slots').slice(1).filter(r=>r[0]&&enabled_(r[5])&&rooms.some(room=>room[0]===r[4])).map(r=>{
  if(ids.has(String(r[0])))throw new Error('Duplicate slot IDs in backend. Contact the organizer.');ids.add(String(r[0]));
  const date=r[1] instanceof Date?Utilities.formatDate(r[1],'Africa/Cairo','yyyy-MM-dd'):String(r[1]);
  const time=r[2] instanceof Date?Utilities.formatDate(r[2],'Africa/Cairo','HH:mm'):String(r[2]).slice(0,5);
  return {id:String(r[0]),date,time,room:String(rooms.find(room=>room[0]===r[4])[1])};
 });
}
function bookings_(){const rows=rows_('Bookings');const expected=['Booking_ID','Employee_Email','User_Name','Department','Slot_ID','Booking_Status','HR_Notes','Created_At','Created_By'];if(JSON.stringify(rows[0].slice(0,9))!==JSON.stringify(expected))throw new Error('Unexpected Bookings columns. Contact the organizer.');return rows.slice(1).filter(r=>r[0]&&String(r[5]).toLowerCase()!=='cancelled');}
function booking_(r){const s=rows_('Available_Slots').slice(1).find(s=>s[0]===r[4]);const slot=slots_().find(s=>s.id===r[4]);return {id:String(r[0]),slot:String(r[4]),details:slot||{date:s?String(s[1]):'Date unavailable',time:s?String(s[2]).slice(0,5):'',room:s?String(s[4]):'Room unavailable'}};}
function getAvailability(rawEmail){return locked_(()=>{const email=email_(rawEmail),rows=bookings_(),taken=new Set(rows.map(r=>r[4])),own=rows.find(r=>String(r[1]).toLowerCase()===email);return {email,slots:slots_().map(s=>Object.assign(s,{available:!taken.has(s.id)})),hasBooking:!!own};});}
function phone_(v){const raw=String(v||'').trim();if(!/^[+0-9 ()-]+$/.test(raw))throw new Error('Enter a valid phone number, including country code.');const phone=raw.replace(/[ ()-]/g,'');if(!/^\+?[0-9]{7,15}$/.test(phone))throw new Error('Enter a valid phone number, including country code.');return phone;}
function reference_(){const used=new Set(rows_('Bookings').slice(1).map(r=>String(r[0]).toUpperCase()));for(let i=0;i<10;i++){const id=Utilities.getUuid().replace(/-/g,'').slice(0,8).toUpperCase();if(!used.has(id))return id;}throw new Error('Could not create a booking reference. Please try again.');}
function book(slotId,rawEmail,rawPhone){return locked_(()=>{
 const email=email_(rawEmail),phone=phone_(rawPhone),rows=bookings_(),own=rows.find(r=>String(r[1]).toLowerCase()===email);
 if(own){if(own[4]===slotId)return booking_(own);throw new Error('You already have an appointment. Each employee can book once.');}
 const slot=slots_().find(s=>s.id===slotId);if(!slot)throw new Error('Please choose a valid slot.');
 if(rows.some(r=>r[4]===slotId))throw new Error('This slot was just booked. Please choose another.');
 const id=reference_(),row=[id,email,'','',slotId,'Confirmed','',new Date().toISOString(),email,"'"+phone];
 db_().getSheetByName('Bookings').appendRow(row);SpreadsheetApp.flush();return {id,slot:slotId,details:slot};
 });}
/** HTTP bridge used by the Cloudflare website. All inputs still pass server validation. */
function doPost(e){
 let result;
 try{
  const text=e&&e.postData&&e.postData.contents||'';
  if(text.length>2048)throw new Error('Invalid request.');
  const data=JSON.parse(text);
  if(data.action==='availability')result=getAvailability(data.email);
  else if(data.action==='book')result=book(data.slotId,data.email,data.phone);
  else throw new Error('Invalid request.');
 }catch(error){result={error:error.message||'Unable to process the request.'};}
 return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
