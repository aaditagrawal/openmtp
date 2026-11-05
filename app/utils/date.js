const months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const pad = (value, length = 2) => String(value).padStart(length, '0');

function localDate(value) {
  if (value === undefined) return new Date();
  if (value === null) return new Date(NaN);
  const compactTime =
    typeof value === 'string' &&
    value.match(
      /^(\d{8}|\d{4}[-/]\d{1,2}[-/]\d{1,2})[Tt ](\d{1,2})(?:(\d{1,2})(\d{1,2})?)?(\.\d+)?$/,
    );
  if (compactTime) {
    let [, day, hour, minute = '00', second = '00', fraction = ''] =
      compactTime;
    if (/^\d{8}$/.test(day))
      day = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6)}`;
    value = `${day} ${hour}:${minute}:${second}${fraction}`;
  }
  if (typeof value === 'string' && /^\d{4}(?:[-/]?\d{1,2})?$/.test(value)) {
    const year = Number(value.slice(0, 4));
    const monthPart = value.slice(4).replace(/^[-/]/, '');
    const month = monthPart ? Number(monthPart) : 1;
    return new Date(year, month - 1, 1);
  }
  if (typeof value === 'string' && /^\d{7,8}$/.test(value)) {
    return new Date(
      Number(value.slice(0, 4)),
      Number(value.slice(4, 6)) - 1,
      Number(value.slice(6)),
    );
  }
  // Device metadata and log dates have no offset and describe local time.
  // Date's ISO date-only parsing would otherwise interpret them as UTC.
  const parts =
    typeof value === 'string' &&
    value.match(
      /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[Tt\s](\d{1,2})(?::(\d{1,2}))?(?::(\d{1,2})(?:[.:](\d+))?)?)?$/,
    );
  if (parts) {
    const [
      ,
      year,
      month,
      day,
      hours = 0,
      minutes = 0,
      seconds = 0,
      fraction = '0',
    ] = parts;
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hours),
      Number(minutes),
      Number(seconds),
      Number(fraction.slice(0, 3)),
    );
  }
  return new Date(value);
}

function yearMonth(date, monthInletters) {
  return `${pad(date.getFullYear(), 4)}-${monthInletters ? months[date.getMonth()] : pad(date.getMonth() + 1)}`;
}

function calendarDate(date, monthInletters = false) {
  return `${yearMonth(date, monthInletters)}-${pad(date.getDate())}`;
}

function clockTime(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export const yearMonthNow = ({ monthInletters = false }) => {
  return yearMonth(new Date(), monthInletters);
};

export const dateTimeUnixTimestampNow = ({ monthInletters = false }) => {
  const date = new Date();
  return `${calendarDate(date, monthInletters)} ${clockTime(date)} (${date.getTime()})`;
};

export const dateNow = ({ monthInletters = false }) => {
  return calendarDate(new Date(), monthInletters);
};

export const unixTimestampNow = () => {
  return String(Date.now());
};

export const msToTime = (milliseconds) => {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const absoluteHours = Math.floor(totalSeconds / 3600);
  const absoluteMinutes = Math.floor((totalSeconds % 3600) / 60);
  const absoluteSeconds = totalSeconds % 60;
  const h = absoluteHours > 9 ? absoluteHours : `0${absoluteHours}`;
  const m = absoluteMinutes > 9 ? absoluteMinutes : `0${absoluteMinutes}`;
  const s = absoluteSeconds > 9 ? absoluteSeconds : `0${absoluteSeconds}`;

  return `${h}:${m}:${s}`;
};

export const daysDiff = (startDate, endDate) => {
  const start = localDate(startDate);
  const end = localDate(endDate);
  const offsetChange =
    (start.getTimezoneOffset() - end.getTimezoneOffset()) * 60000;
  const days = (start - end - offsetChange) / 86400000;
  return days < 0 ? Math.ceil(days) || 0 : Math.floor(days);
};

export const appDateFormat = (dateTime) => {
  const date = localDate(dateTime);
  return Number.isNaN(date.getTime())
    ? 'Invalid Date'
    : `${calendarDate(date)} ${clockTime(date)}`;
};
