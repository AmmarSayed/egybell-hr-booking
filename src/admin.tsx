import {useEffect, useState, type FormEvent} from 'react';
import {CalendarDays, Download, LogOut, Plus, Trash2} from 'lucide-react';
import {Button} from './button';
import {SiteFooter} from './credits';
import './admin.css';

type BookingWindow = {date: string; room: string; start: string; end: string};
type Schedule = {windows: BookingWindow[]; revision: string};
type Booking = {reference: string; name: string; email: string; phone: string; date: string; time: string; room: string};
type BookingReport = {
  bookings: Booking[];
  stats: {scheduledSlots: number; bookedScheduledSlots: number};
};
const emptyWindow: BookingWindow = {date: '', room: '', start: '09:00', end: '17:00'};
const columns = [
  ['date', 'Date'], ['time', 'Cairo time'], ['room', 'Meeting room'],
  ['name', 'Name'], ['email', 'Work email'], ['phone', 'Phone number'], ['reference', 'Reference'],
] as const;

class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(path: string, body?: object): Promise<T> {
  const response = await fetch('/api/admin/' + path, body === undefined ? undefined : {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error || 'Please try again.', response.status);
  return data;
}

function BookingStats({report}: {report: BookingReport}) {
  const {scheduledSlots, bookedScheduledSlots} = report.stats;
  const formatNumber = new Intl.NumberFormat('en');
  const fillRate = new Intl.NumberFormat('en', {style: 'percent', maximumFractionDigits: 1});

  return <dl className="admin-stats" aria-label="Reservation statistics for the selected date range">
    <div>
      <dt>Confirmed bookings</dt>
      <dd>{formatNumber.format(report.bookings.length)}</dd>
    </div>
    <div>
      <dt>Scheduled slots</dt>
      <dd>{formatNumber.format(scheduledSlots)}</dd>
    </div>
    <div>
      <dt>Fill rate</dt>
      <dd>{scheduledSlots ? fillRate.format(bookedScheduledSlots / scheduledSlots) : '—'}</dd>
      <dd className="admin-stat-detail">
        {scheduledSlots
          ? formatNumber.format(bookedScheduledSlots) + ' of ' + formatNumber.format(scheduledSlots) + ' scheduled slots booked'
          : 'No slots scheduled'}
      </dd>
    </div>
  </dl>;
}

export function Admin({page}: {page: 'bookings' | 'setup'}) {
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [report, setReport] = useState<BookingReport | null>(null);
  const [filters, setFilters] = useState({from: '', to: ''});
  const [reportQuery, setReportQuery] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(true);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const signedIn = schedule !== null || report !== null;

  async function loadDashboard() {
    if (page === 'setup') {
      setSchedule(await request<Schedule>('schedule'));
    } else {
      setReport(await request<BookingReport>('bookings'));
      setFilters({from: '', to: ''});
      setReportQuery('');
    }
  }

  useEffect(() => {
    loadDashboard()
      .catch((failure: ApiError) => {
        if (failure.status !== 401) setError('Could not load the dashboard. Refresh the page to try again.');
      })
      .finally(() => setBusy(false));
  }, [page]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await action();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) {
        setSchedule(null);
        setReport(null);
      }
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function login(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await request('login', {password});
      setPassword('');
      await loadDashboard();
    });
  }

  function updateWindow(index: number, patch: Partial<BookingWindow>) {
    setSchedule(current => current && {
      ...current, windows: current.windows.map((window, i) => i === index ? {...window, ...patch} : window),
    });
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!schedule) return;
    void run(async () => {
      setSchedule(await request<Schedule>('schedule', schedule));
      setStatus('Schedule saved. The booking page now uses these hours.');
    });
  }

  function refreshReport(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const params = new URLSearchParams();
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      const query = params.size ? '?' + params.toString() : '';
      setReport(await request<BookingReport>('bookings' + query));
      setReportQuery(query);
    });
  }

  function deleteBooking(booking: Booking) {
    const summary = (booking.name ? booking.name + ', ' : '') + booking.email + ' on ' + booking.date + ' at ' + booking.time + ' (' + booking.reference + ')';
    if (!window.confirm('Delete the booking for ' + summary + '?\n\nThe employee can book another available slot. This cannot be undone.')) return;
    void run(async () => {
      await request('bookings/delete', {reference: booking.reference});
      setStatus('Booking ' + booking.reference + ' deleted.');
      setReport(await request<BookingReport>('bookings' + reportQuery));
    });
  }

  function logout() {
    void run(async () => {
      await request('logout', {});
      setSchedule(null);
      setReport(null);
    });
  }

  return <div className="admin">
    <header className="topbar">
      <a className="wordmark" href="/">Egybell<span>HR appointments</span></a>
      {signedIn && <Button variant="ghost" onClick={logout} disabled={busy}><LogOut size={16}/> Sign out</Button>}
    </header>
    <main className={signedIn ? 'admin-workspace' : 'admin-signin'} aria-busy={busy}>
      {signedIn && <nav className="admin-nav" aria-label="Booking administration">
        <a href="/admin" aria-current={page === 'bookings' ? 'page' : undefined}>Bookings overview</a>
        <a href="/admin/setup" aria-current={page === 'setup' ? 'page' : undefined}>Setup</a>
      </nav>}
      {error && <p className="error" role="alert">{error}</p>}
      {status && <p className="admin-status" role="status">{status}</p>}
      {!signedIn && <section className="admin-panel">
        <h1>Booking administration</h1>
        <form onSubmit={login}>
          <label htmlFor="admin-password">Administrator password</label>
          <input id="admin-password" type="password" autoComplete="current-password" required
            value={password} onChange={event => setPassword(event.target.value)} disabled={busy}/>
          <Button className="full" disabled={busy}>Sign in</Button>
        </form>
      </section>}
      {schedule && <>
        <h1>Setup</h1>
        <section className="admin-panel">
          <h2><CalendarDays size={20}/> Appointment schedule</h2>
          <p className="muted">Set the hours for each room and date in Cairo time. Appointments are 15 minutes.</p>
          <form onSubmit={save}>
            <fieldset disabled={busy}>
              {schedule.windows.map((window, index) => <div className="admin-window" key={index}>
                <label>Date<input aria-label={'Date, row ' + (index + 1)} type="date" required value={window.date}
                  onChange={event => updateWindow(index, {date: event.target.value})}/></label>
                <label>Meeting room<input aria-label={'Meeting room, row ' + (index + 1)} required maxLength={80}
                  value={window.room} onChange={event => updateWindow(index, {room: event.target.value})}/></label>
                <label>Start<input aria-label={'Start time, row ' + (index + 1)} type="time" required step={900} value={window.start}
                  onChange={event => updateWindow(index, {start: event.target.value})}/></label>
                <label>End<input aria-label={'End time, row ' + (index + 1)} type="time" required step={900} value={window.end}
                  onChange={event => updateWindow(index, {end: event.target.value})}/></label>
                <Button type="button" variant="outline" aria-label={'Remove row ' + (index + 1)}
                  onClick={() => setSchedule({...schedule, windows: schedule.windows.filter((_, i) => i !== index)})}><Trash2 size={16}/></Button>
              </div>)}
              <div className="admin-actions">
                <Button type="button" variant="outline" disabled={schedule.windows.length >= 100}
                  onClick={() => setSchedule({...schedule, windows: [...schedule.windows, emptyWindow]})}><Plus size={16}/> Add room and date</Button>
                <Button>Save schedule</Button>
              </div>
            </fieldset>
          </form>
        </section>
      </>}
      {report && <>
        <h1>Bookings overview</h1>
        <BookingStats report={report}/>
        <section className="admin-panel">
          <h2>Bookings</h2>
          <form className="admin-filters" onSubmit={refreshReport}>
            <label>From<input type="date" value={filters.from} onChange={event => setFilters({...filters, from: event.target.value})}/></label>
            <label>To<input type="date" min={filters.from || undefined} value={filters.to}
              onChange={event => setFilters({...filters, to: event.target.value})}/></label>
            <Button variant="outline" disabled={busy}>Apply filter</Button>
            <a className="button button-primary" href={'/api/admin/report.csv' + reportQuery}><Download size={16}/> Download CSV</a>
          </form>
          {report.bookings.length ? <div className="admin-table" tabIndex={0} aria-label="Booking results">
            <table>
              <thead><tr>{columns.map(([key, label]) => <th scope="col" key={key}>{label}</th>)}<th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{report.bookings.map(booking => <tr key={booking.reference}>
                {columns.map(([key]) => <td key={key}>{booking[key]}</td>)}
                <td><Button type="button" variant="outline" className="admin-delete" disabled={busy}
                  aria-label={'Delete booking ' + booking.reference} title="Delete booking"
                  onClick={() => deleteBooking(booking)}><Trash2 size={16}/></Button></td>
              </tr>)}</tbody>
            </table>
          </div> : <p className="admin-empty">No bookings in this date range.</p>}
        </section>
      </>}
      <SiteFooter className="admin-footer"/>
    </main>
  </div>;
}
