import {copyrightNotice} from './credits';
import {pieLabel} from './pie-signature';
import pieIcon from './pie-treat.png';

type Confirmation = {
  reference: string;
  date: string;
  time: string;
  room: string;
  name: string;
  email: string;
};

async function drawConfirmation({reference, date, time, room, name, email}: Confirmation) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1320;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable.');

  const image = new Image();
  image.src = pieIcon;
  await Promise.all([
    image.decode(),
    document.fonts.load('600 28px "Noto Sans"', pieLabel).catch(() => []),
  ]);

  const margin = 64;
  const textWidth = canvas.width - margin * 2;

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#244394';
  context.fillRect(0, 0, canvas.width, 220);
  context.fillStyle = '#f72f2f';
  context.fillRect(0, 220, canvas.width, 12);

  context.fillStyle = '#ffffff';
  context.font = 'bold 42px Arial';
  context.fillText('Egybell', margin, 95);
  context.font = '28px Arial';
  context.fillText('HR appointment confirmation', margin, 155);

  context.fillStyle = '#ffffff';
  context.beginPath();
  context.roundRect(760, 74, 256, 72, 12);
  context.fill();
  context.drawImage(image, 776, 87, 58, 46);
  context.fillStyle = '#532c19';
  context.font = '600 28px "Noto Sans", Arial, sans-serif';
  context.fillText(pieLabel, 850, 119);

  context.fillStyle = '#244394';
  context.font = 'bold 54px Arial';
  context.fillText('Your appointment is booked.', margin, 335, textWidth);

  const details = [
    ['Date', date],
    ['Time', time + ' · Cairo time · 15 minutes'],
    ['Location', room],
    ...(name ? [['Name', name]] : []),
    ['Work email', email],
    ['Booking reference', reference],
  ];
  details.forEach(([label, value], index) => {
    const y = 425 + index * 112;
    context.fillStyle = '#636363';
    context.font = '24px Arial';
    context.fillText(label, margin, y);
    context.fillStyle = '#172540';
    context.font = 'bold 29px Arial';
    context.fillText(value, margin, y + 43, textWidth);
  });

  context.fillStyle = '#fff4cc';
  context.fillRect(margin, 1080, textWidth, 116);
  context.fillStyle = '#d49a00';
  context.fillRect(margin, 1080, 6, 116);
  context.fillStyle = '#624900';
  context.font = 'bold 26px Arial';
  context.fillText('Please bring your national ID', 90, 1124);
  context.font = '24px Arial';
  context.fillText('to this appointment for contract signing.', 90, 1164);

  context.fillStyle = '#dce2ef';
  context.fillRect(margin, 1236, textWidth, 2);
  context.fillStyle = '#636363';
  context.font = '22px Arial';
  context.fillText(copyrightNotice(), margin, 1280);

  return canvas;
}

export async function downloadConfirmation(confirmation: Confirmation) {
  const canvas = await drawConfirmation(confirmation);
  const image = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!image) throw new Error('Could not create the confirmation image.');
  const url = URL.createObjectURL(image);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'HR-appointment-' + confirmation.reference + '.png';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
