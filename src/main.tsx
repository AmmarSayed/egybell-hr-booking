import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ClerkFailed, ClerkLoading, ClerkProvider, SignInButton, SignOutButton, useAuth} from '@clerk/react';
import {ArrowRight,ArrowLeft,CalendarDays,Clock3,MapPin,Check,Download,ShieldCheck,RefreshCw,Phone,Mail,CheckCircle2,LoaderCircle} from 'lucide-react';
import {Button} from './button';
import {Admin} from './admin';
import './style.css';
type Slot={id:string;date:string;time:string;room:string;available:boolean};
type Receipt={id:string;slot:string;details:Slot};
type Availability={email:string;slots:Slot[];hasBooking:boolean;booking?:Receipt};
const heroDateText=(date:string)=>new Date(date+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
const dateText=(d:string,short=false)=>new Date(d+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:short?'short':'long',...(short?{}:{weekday:'long',year:'numeric'})});
const appsScriptUrl = import.meta.env.VITE_APPS_SCRIPT_URL;

type BookingIdentity = {
  signedIn: boolean;
  getToken: () => Promise<string | null>;
};

async function api<T>(payload: object, token?: string | null): Promise<T> {
  const response = await fetch(appsScriptUrl || '/api/booking', {
    method: 'POST',
    // Apps Script accepts JSON in a text body, which keeps the cross-origin POST preflight-free.
    headers: {
      'Content-Type': appsScriptUrl ? 'text/plain;charset=UTF-8' : 'application/json',
      ...(token && {Authorization: 'Bearer ' + token}),
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(data.error || 'The request could not be completed.');
  }
  return data;
}
function App({identity}: {identity?: BookingIdentity}) {
 const [step,setStep]=useState(0),[email,setEmail]=useState(''),[phone,setPhone]=useState(''),[data,setData]=useState<Availability|null>(null),[day,setDay]=useState(''),[room,setRoom]=useState(''),[selected,setSelected]=useState<Slot|null>(null),[receipt,setReceipt]=useState<Receipt|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [scheduledDates,setScheduledDates]=useState<string[]|null>(null);
 const [existing,setExisting]=useState(false);
 useEffect(()=>{
  if(!identity?.signedIn)return;
  let active=true;
  setBusy(true);
  identity.getToken()
   .then(token=>api<Availability>({action:'availability'},token))
   .then(d=>{if(active&&d.booking)showExisting(d)})
   .catch(()=>{/* The phone step still works; booking errors surface there. */})
   .finally(()=>{if(active)setBusy(false)});
  return ()=>{active=false};
 },[identity?.signedIn]);
 function showExisting(d:Availability){
  if(!d.booking)return;
  setData(d);
  setEmail(d.email);
  setReceipt(d.booking);
  setExisting(true);
  setStep(3);
 }
 useEffect(()=>{
  let active=true;
  api<{dates:string[]}>({action:'schedule'})
   .then(({dates})=>{if(active)setScheduledDates(dates)})
   .catch(()=>{if(active)setScheduledDates([])});
  return ()=>{active=false};
 },[]);
 const dates=[...new Set(data?.slots.map(s=>s.date))],rooms=[...new Set(data?.slots.filter(s=>s.date===day).map(s=>s.room))];
 const heroDates=data?[...dates].sort():scheduledDates;
 const heroDateLabel=heroDates?.length?heroDates.map(heroDateText).join(' & '):heroDates?'Appointment dates unavailable':'Loading appointment dates…';
 async function load() {
  setBusy(true);
  setError('');
  try {
   const token = await identity?.getToken();
   const d = await api<Availability>({action: 'availability', ...(!identity && {email})}, token);
   if (d.booking) return showExisting(d);
   const activeDay = d.slots.some(slot => slot.date === day) ? day : d.slots[0]?.date || '';
   const daySlots = d.slots.filter(slot => slot.date === activeDay);
   setData(d);
   setEmail(d.email);
   setSelected(null);
   setDay(activeDay);
   setRoom(daySlots.some(slot => slot.room === room) ? room : daySlots[0]?.room || '');
   setStep(1);
  } catch (e) {
   setError((e as Error).message);
  } finally {
   setBusy(false);
  }
 }

 function enter(event: React.FormEvent) {
  event.preventDefault();
  if (!identity && !/^[a-z0-9][a-z0-9._%+~-]*@afreximbank\.com$/i.test(email.trim())) {
   setError('Please enter your @afreximbank.com work email.');
   return;
  }
  if (!/^[+0-9 ()-]+$/.test(phone) || !/^\+?\d{7,15}$/.test(phone.replace(/[ ()-]/g, ''))) {
   setError('Please enter a valid phone number, including country code.');
   return;
  }
  void load();
 }

 async function confirm() {
  if (!selected || busy) return;
  setBusy(true);
  setError('');
  try {
   const token = await identity?.getToken();
   const result = await api<Receipt>({action: 'book', ...(!identity && {email}), phone, slotId: selected.id}, token);
   setReceipt(result);
   setStep(3);
  } catch (e) {
   setError((e as Error).message);
  } finally {
   setBusy(false);
  }
 }
 async function download(){if(!receipt)return;try{const c=document.createElement('canvas');c.width=1080;c.height=1320;const ctx=c.getContext('2d');if(!ctx)throw Error('Download unavailable. Please take a screenshot instead.');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,1080,1320);ctx.fillStyle='#244394';ctx.fillRect(0,0,1080,220);ctx.fillStyle='#f72f2f';ctx.fillRect(0,220,1080,12);ctx.fillStyle='#ffffff';ctx.font='bold 42px Arial';ctx.fillText('Egybell',64,95);ctx.font='28px Arial';ctx.fillText('HR appointment confirmation',64,155);ctx.fillStyle='#244394';ctx.font='bold 54px Arial';ctx.fillText('Your appointment is booked.',64,335);ctx.fillStyle='#636363';ctx.font='26px Arial';const lines=[['Date',dateText(receipt.details.date)],['Time',receipt.details.time+' · Cairo time · 15 minutes'],['Location',receipt.details.room],['Work email',email.trim().toLowerCase()],['Booking reference',receipt.id]];let y=435;for(const [label,value]of lines){ctx.fillStyle='#636363';ctx.font='24px Arial';ctx.fillText(label,64,y);ctx.fillStyle='#163c3d';ctx.font='bold 29px Arial';ctx.fillText(value,64,y+48,950);y+=145;}ctx.fillStyle='#fff4cc';ctx.fillRect(64,1170,952,116);ctx.fillStyle='#d49a00';ctx.fillRect(64,1170,6,116);ctx.fillStyle='#624900';ctx.font='bold 26px Arial';ctx.fillText('Please bring your national ID',90,1214);ctx.font='24px Arial';ctx.fillText('to this appointment for contract signing.',90,1254);const blob=await new Promise<Blob|null>(resolve=>c.toBlob(resolve,'image/png'));if(!blob)throw Error('Download unavailable. Please take a screenshot instead.');const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='HR-appointment-'+receipt.id+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000)}catch(e){setError((e as Error).message)}}
 return <div className="app" data-step={step}><header className="topbar"><a className="wordmark" href={import.meta.env.BASE_URL}>Egybell<span>HR appointments</span></a><div className="header-note"><span className="live-dot"/>Employee booking portal</div></header><main className="layout"><aside className="intro"><div className="eyebrow"><span/>Your time. Your conversation.</div><h1>A little time. <br/>A meaningful <br/><em>conversation.</em></h1><p className="intro-copy">Book a one-to-one appointment with HR. Choose the day, room, and time that works for you.</p><div className="event-facts"><div><Clock3 size={20}/><span>15-minute appointments</span></div><div><MapPin size={20}/><span>In person · Cairo local time</span></div><div><CalendarDays size={20}/><span role="status">{heroDateLabel}</span></div></div><div className="aside-bottom"><ShieldCheck size={20}/><p>One appointment per work email.<br/>Your contact details are recorded for HR.</p></div><div className="abstract" aria-hidden="true"><div/><div/><div/></div></aside><div className="workspace"><nav className="steps" aria-label="Booking progress">{['Your details','Choose a time','Review'].map((label,i)=><div className={(Math.min(step,2)===i?'current ':step>i?'done ':'')+'step'} key={label}><span>{step>i?<Check size={14}/>:i+1}</span><small>{label}</small></div>)}</nav><section className="card" aria-busy={busy}>
 {error&&<div className="error" role="alert">{error}</div>}
 {step === 0 && <>
  <div className="section-icon"><Mail size={24}/></div>
  {identity && !identity.signedIn ? <>
   <h2>Confirm it’s you</h2>
   <p className="muted">Enter your @afreximbank.com work email and we’ll send you a one-time code. No password or registration needed.</p>
   <SignInButton mode="modal" withSignUp forceRedirectUrl={import.meta.env.BASE_URL}
     signUpForceRedirectUrl={import.meta.env.BASE_URL}>
    <Button className="full">Continue with work email<ArrowRight size={18}/></Button>
   </SignInButton>
  </> : <>
   <h2>{identity ? 'Add your phone number' : 'Let’s start with you.'}</h2>
   <p className="muted">{identity ? 'HR will use it to coordinate your appointment.' : 'Enter your details to see available appointments.'}</p>
   <form onSubmit={enter}>
    {!identity && <>
     <label htmlFor="email">Work email</label>
     <input id="email" type="email" autoComplete="email" placeholder="name@afreximbank.com" value={email}
       onChange={event => setEmail(event.target.value)} required disabled={busy}/>
     <small className="help">Use your own @afreximbank.com email address.</small>
    </>}
    <label htmlFor="phone">Phone number</label>
    <input id="phone" type="tel" autoComplete="tel" placeholder="e.g. +20 100 123 4567" value={phone}
      onChange={event => setPhone(event.target.value)} required disabled={busy}/>
    <small className="help">Include your country code.</small>
    <Button className="full" disabled={busy}>{busy ? 'Finding appointments…' : <>Find an appointment<ArrowRight size={18}/></>}</Button>
    <p className="privacy">Your email and phone number will be stored with your booking for HR coordination.</p>
   </form>
   {identity && <SignOutButton redirectUrl={import.meta.env.BASE_URL}><Button variant="ghost">Use a different account</Button></SignOutButton>}
  </>}
 </>}
 {step===1&&<><div className="card-heading"><div><h2>Find your moment.</h2><p className="muted">All times are in Cairo local time.</p></div><Button variant="ghost" onClick={load} disabled={busy} aria-label="Refresh availability"><RefreshCw size={18} className={busy?'spin':''}/></Button></div>{data?.hasBooking?<div className="empty"><CheckCircle2 size={36}/><h3>You already have an appointment.</h3><p>There is an existing booking under this email. Please contact HR if you need to change it.</p></div>:!data?.slots.length?<div className="empty">No appointments are currently available. Please check with HR.</div>:<><label>Choose a day</label><div className="days">{dates.map(d=><button disabled={busy} aria-pressed={day===d} className={'day '+(day===d?'active':'')} key={d} onClick={()=>{setDay(d);setSelected(null);const first=data?.slots.find(s=>s.date===d);if(first)setRoom(first.room)}}><span>{new Date(d+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short'})}</span><strong>{new Date(d+'T12:00:00').getDate()}</strong><span>{new Date(d+'T12:00:00').toLocaleDateString('en-GB',{month:'long'})}</span>{day===d&&<CheckCircle2 size={17}/>}</button>)}</div><label htmlFor="room">Meeting room</label><select id="room" value={room} disabled={busy} onChange={e=>{setRoom(e.target.value);setSelected(null)}}>{rooms.map(r=><option key={r}>{r}</option>)}</select><div className="time-heading"><label>Available times</label><span><i/>Available</span></div>{!data?.slots.some(s=>s.date===day&&s.room===room&&s.available)&&<p className="note">No times are available in this room on this day. Choose another room or day.</p>}<div className="times">{data?.slots.filter(s=>s.date===day&&s.room===room&&s.available).map(s=><button key={s.id} disabled={!s.available||busy} aria-pressed={selected?.id===s.id} aria-label={s.time+(s.available?' available':' booked')} className={selected?.id===s.id?'chosen':''} onClick={()=>setSelected(s)}>{s.time}{selected?.id===s.id&&<Check size={14}/>}</button>)}</div><div className="selection">{selected?<><Clock3 size={16}/>{selected.time} · {selected.room} · 15 minutes</>:'Select an available time to continue.'}</div><Button className="full" disabled={!selected||busy} onClick={()=>{setError('');setStep(2)}}>Review appointment<ArrowRight size={18}/></Button></>}<Button variant="ghost" onClick={()=>{setStep(0);setError('')}} disabled={busy}><ArrowLeft size={16}/>Edit your details</Button></>}
 {step===2&&selected&&<><div className="section-icon"><CalendarDays size={24}/></div><h2>Everything look right?</h2><p className="muted">Review your appointment before confirming.</p><div className="appointment"><div><CalendarDays/><span><small>Date</small><strong>{dateText(selected.date)}</strong></span></div><div><Clock3/><span><small>Time · Cairo</small><strong>{selected.time} · 15 minutes</strong></span></div><div><MapPin/><span><small>Meeting room</small><strong>{selected.room}</strong></span></div></div><div className="contacts"><p><Mail size={16}/>{email.trim().toLowerCase()}</p><p><Phone size={16}/>{phone}</p></div><p className="arrival-note"><strong>Please bring your national ID</strong> to this appointment for contract signing.</p><p className="note">Your time is reserved only after confirmation. If someone books it first, you’ll be asked to choose another.</p><Button className="full" disabled={busy} onClick={confirm}>{busy?<><LoaderCircle size={18} className="spin" aria-hidden="true"/><span role="status" aria-live="polite">Confirming your appointment…</span></>:<>Confirm appointment<Check size={18}/></>}</Button><Button variant="ghost" disabled={busy} onClick={()=>{setStep(1);setError('')}}><ArrowLeft size={16}/>Choose a different time</Button></>}
 {step===3&&receipt&&<><div className="success-icon"><Check size={32}/></div><span className="confirmed">Booking confirmed</span><h2>{existing?'You already have an appointment.':'You’re all booked.'}</h2><p className="muted">{existing?'Here are your booking details. Please contact HR if you need to change it.':'We look forward to seeing you.'}</p><div className="appointment"><div><CalendarDays/><span><small>Date</small><strong>{dateText(receipt.details.date)}</strong></span></div><div><Clock3/><span><small>Time · Cairo</small><strong>{receipt.details.time} · 15 minutes</strong></span></div><div><MapPin/><span><small>Meeting room</small><strong>{receipt.details.room}</strong></span></div></div><div className="reference"><small>Your booking reference</small><strong>{receipt.id}</strong></div><p className="arrival-note"><strong>Please bring your national ID</strong> to this appointment for contract signing.</p><Button className="full" onClick={download}><Download size={18}/>Download confirmation</Button><p className="privacy">Save the image to your phone, or take a screenshot of this page. No confirmation email will be sent.</p></>}
 </section><footer><span>Egybell · Human Resources</span><span>Designed & developed by Ammar Sayed · © {new Date().getFullYear()} Ammar Sayed. All rights reserved.</span></footer></div></main></div>
}
function ClerkBooking() {
 const {isLoaded, isSignedIn, userId, getToken} = useAuth();
 if (!isLoaded) return null;
 return <App key={userId ?? 'signed-out'} identity={{signedIn: Boolean(isSignedIn), getToken}}/>;
}

function BookingPage() {
 const [config, setConfig] = useState<{publishableKey: string | null} | null>(null);
 const [error, setError] = useState(false);

 useEffect(() => {
  if (appsScriptUrl) return;
  const controller = new AbortController();
  fetch('/api/booking-auth', {signal: controller.signal})
   .then(response => {
    if (!response.ok) throw new Error('Booking configuration unavailable.');
    return response.json();
   })
   .then(setConfig)
   .catch(() => {if (!controller.signal.aborted) setError(true);});
  return () => controller.abort();
 }, []);

 if (appsScriptUrl) return <App/>;
 if (error) return <p className="workspace" role="alert">Booking is temporarily unavailable. Refresh the page to try again.</p>;
 if (!config) return <p className="workspace" role="status">Loading appointments…</p>;
 if (!config.publishableKey) return <App/>;
 return <ClerkProvider publishableKey={config.publishableKey}
   signInForceRedirectUrl={import.meta.env.BASE_URL} signUpForceRedirectUrl={import.meta.env.BASE_URL}>
  <ClerkLoading><p className="workspace" role="status">Loading sign-in…</p></ClerkLoading>
  <ClerkFailed><p className="workspace" role="alert">Sign-in is temporarily unavailable. Refresh the page to try again.</p></ClerkFailed>
  <ClerkBooking/>
 </ClerkProvider>;
}

const isAdmin = !appsScriptUrl && /^\/admin\/?$/.test(window.location.pathname);
createRoot(document.getElementById('root')!).render(isAdmin ? <Admin/> : <BookingPage/>);
