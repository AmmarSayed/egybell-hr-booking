import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {createBookingApp} from './app.mjs';

const secure = process.env.NODE_ENV === 'production';
const databasePath = process.env.DATABASE_PATH || (secure ? '' : 'data/bookings.sqlite');
if (!databasePath) throw new Error('Set DATABASE_PATH to a file on persistent storage.');
mkdirSync(dirname(databasePath), {recursive: true, mode: 0o700});

const port = Number(process.env.PORT || 8788);
const host = process.env.HOST || (secure ? '0.0.0.0' : '127.0.0.1');
const {app, close} = createBookingApp({databasePath, adminPassword: process.env.ADMIN_PASSWORD, secure});
const server = app.listen(port, host, () => console.log('Egybell booking listening on ' + host + ':' + port));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => close()));
}
