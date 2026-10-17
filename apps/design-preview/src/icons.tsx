import type { SVGProps } from 'react';

// Set de íconos propio: trazo redondeado de 1,9 px, 24×24. Sin dependencias.
const paths = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10M10 19.5v-5h4v5',
  cart: 'M3 4h2.2l2 11h10.3l2-8H6.2M9.5 20h.01M17 20h.01',
  users:
    'M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM20 19v-1.2a3.2 3.2 0 0 0-2.4-3.1M15.6 4.8a3.2 3.2 0 0 1 0 6.2',
  camera:
    'M4 8.5h3l1.5-2.5h7L17 8.5h3V19H4V8.5ZM12 16.8a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2Z',
  frame: 'M3.5 3.5h17v17h-17zM7.5 7.5h9v9h-9z',
  calendar: 'M4 6.5h16V20H4V6.5ZM4 10.5h16M8 3.5v4M16 3.5v4',
  star: 'm12 3.8 2.5 5.1 5.6.8-4 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4-4 5.6-.8L12 3.8Z',
  box: 'M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4v-9ZM3.5 7.5 12 11.5l8.5-4M12 11.5v9',
  wallet: 'M3.5 6.5h17v12h-17zM3.5 10.5h17M16 14.5h1.5',
  sliders: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5',
  search: 'M10.8 17.6a6.8 6.8 0 1 0 0-13.6 6.8 6.8 0 0 0 0 13.6ZM16 16l4.5 4.5',
  bell: 'M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15L6 16.5ZM10 20.5a2.2 2.2 0 0 0 4 0',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'm4.5 12.5 5 5L19.5 7',
  x: 'M6 6l12 12M18 6 6 18',
  chevR: 'm9 5 7 7-7 7',
  chevL: 'm15 5-7 7 7 7',
  chevD: 'm5 9 7 7 7-7',
  clock: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17ZM12 7.5V12l3 2',
  alert: 'M12 4 21 19.5H3L12 4ZM12 10v4.5M12 17.2v.01',
  upload: 'M12 16V5M7.5 9.5 12 5l4.5 4.5M4.5 15.5V19h15v-3.5',
  image: 'M3.5 5.5h17v13h-17zM3.5 16l5-5 4 4 3-3 5 5M8.5 9.5h.01',
  chat: 'M4 5.5h16v11H12l-4.5 3.5v-3.5H4v-11Z',
  cloud: 'M7 18.5a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 9a4.5 4.5 0 0 1 .5 9.5H7Z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  copy: 'M8.5 8.5h11v11h-11zM15.5 8.5v-4h-11v11h4',
  bolt: 'M13 3.5 5.5 13.5H11l-1 7 7.5-10H12l1-7Z',
  printer: 'M7 9V4h10v5M7 17H4.5v-8h15v8H17M7 14h10v6H7v-6Z',
  scan: 'M4 8V4.5h3.5M16.5 4.5H20V8M20 16v3.5h-3.5M7.5 19.5H4V16M7 8.5v7M10.5 8.5v7M14 8.5v7M17 8.5v7',
  trash: 'M5 7h14M10 4h4M7 7l.8 13h8.4L17 7M10.5 11v5.5M13.5 11v5.5',
  edit: 'M4 20l1-4.5L16.5 4l3.5 3.5L8.5 19 4 20Z',
  phone:
    'M7 4h3l1.5 4-2 1.5a11 11 0 0 0 5 5L16 12.5l4 1.5v3a2 2 0 0 1-2 2A14 14 0 0 1 5 6a2 2 0 0 1 2-2Z',
  mail: 'M3.5 6h17v12h-17zM3.5 7l8.5 6.5L20.5 7',
  pin: 'M12 21s6.5-5.7 6.5-11a6.5 6.5 0 1 0-13 0c0 5.3 6.5 11 6.5 11ZM12 12.2a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8Z',
  grid: 'M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4zM13.5 13.5H20V20h-6.5z',
  filter: 'M4 6h16M7 12h10M10 18h4',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12ZM12 14.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6Z',
  receipt: 'M6 3.5h12V21l-3-2-3 2-3-2-3 2V3.5ZM9 8h6M9 12h6',
  logout: 'M10 4.5H5v15h5M14 8l4 4-4 4M18 12H9',
  info: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17ZM12 11v5M12 8v.01',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  sparkle:
    'M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18.2l-1.8-5.6L4.5 10.8 10.2 9 12 3.5ZM19 16.5v4M17 18.5h4',
  hourglass:
    'M7 3.5h10M7 20.5h10M8 3.5c0 4 4 5 4 8.5s-4 4.5-4 8.5M16 3.5c0 4-4 5-4 8.5s4 4.5 4 8.5',
  folder: 'M3.5 6.5h6l2 2.5h9v10h-17V6.5Z',
  refresh:
    'M19.5 8A8 8 0 0 0 5 9M4.5 4.5V9H9M4.5 16A8 8 0 0 0 19 15M19.5 19.5V15H15',
  dots: 'M6 12h.01M12 12h.01M18 12h.01',
  globe:
    'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17ZM3.5 12h17M12 3.5c2.5 2.5 3.5 5.3 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.3-3.5-8.5s1-6 3.5-8.5Z',
  store:
    'M4 9.5 5.5 4h13L20 9.5M4 9.5h16M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0M5.5 12.5V20h13v-7.5M10 20v-4.5h4V20',
  user: 'M12 11.5a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2ZM5 20v-1.2a4.5 4.5 0 0 1 4.5-4.5h5A4.5 4.5 0 0 1 19 18.8V20',
  swap: 'M5 8h13l-3-3M19 16H6l3 3',
  ruler:
    'M3.5 16 16 3.5 20.5 8 8 20.5 3.5 16ZM7 12.5l2 2M10 9.5l1.5 1.5M13 6.5l2 2',
  cash: 'M3.5 7h17v10h-17zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM6.5 10v.01M17.5 14v.01',
  card: 'M3.5 6h17v12h-17zM3.5 10h17M7 15h3',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2.5v2.5H14zM18 14h2v2M14 19h2v1M18 18.5h2V20',
} as const;

export type IconName = keyof typeof paths;

export function Icon({
  name,
  size,
  strokeWidth = 1.9,
  ...rest
}: { name: IconName; size?: number; strokeWidth?: number } & Omit<
  SVGProps<SVGSVGElement>,
  'name'
>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size ?? 24}
      height={size ?? 24}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={paths[name]} />
    </svg>
  );
}
