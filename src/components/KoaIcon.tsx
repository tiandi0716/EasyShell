interface Props {
  size?: number
}

/** Koa 艺术字：斜切笔触 + 花体装饰（深色主题薄荷绿） */
export default function KoaIcon({ size = 34 }: Props) {
  const h = Math.round(size * 1.05)
  const w = Math.round(size * 2.45)
  return (
    <svg
      className="koa-icon"
      width={w}
      height={h}
      viewBox="0 0 100 40"
      aria-label="Koa"
      role="img"
    >
      <defs>
        <linearGradient id="koaInk" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#7cffb2" />
          <stop offset="45%" stopColor="#3dcea0" />
          <stop offset="100%" stopColor="#1f7a5c" />
        </linearGradient>
        <linearGradient id="koaShine" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.28" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="koaAccent" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#7cffb2" stopOpacity="0" />
          <stop offset="50%" stopColor="#3dcea0" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#1f7a5c" stopOpacity="0" />
        </linearGradient>
      </defs>

      <ellipse cx="48" cy="22" rx="42" ry="14" fill="#3dcea0" opacity="0.08" />

      <g transform="skewX(-14) translate(6,1)" fill="url(#koaInk)">
        <path d="M6 3.5 L13.2 3.5 L13.2 14.2 L22.8 3.5 L31.2 3.5 L19.5 16.8 L32.2 34 L23.2 34 L13.2 19.6 L13.2 34 L6 34 Z" />
        <path d="M8.2 5.2 L11 5.2 L11 12.5 L8.2 12.5 Z" fill="url(#koaShine)" />

        <path d="M47.2 9c-7.1 0-12.4 5.1-12.4 11.7S40.1 32.4 47.2 32.4 59.6 27.3 59.6 20.7 54.3 9 47.2 9zm0 5.6c3.5 0 5.8 2.5 5.8 6.1s-2.3 6.1-5.8 6.1-5.8-2.5-5.8-6.1 2.3-6.1 5.8-6.1z" />
        <path
          d="M43.2 14.8c1.2-1.1 2.8-1.7 4.5-1.7"
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.28"
          strokeWidth="1.4"
          strokeLinecap="round"
        />

        <path d="M66.2 15.4c4.1-1.7 9-0.7 11.4 2.3l0.35-2h6.1V34h-5.8l-0.25-1.7c-2 1.8-4.9 2.6-7.8 2.6-6.1 0-10.2-3.8-10.2-9.1 0-5.4 4.1-9 6.3-9.2zm2.1 7c0 2.4 1.9 4 4.5 4 2.4 0 4.4-1.4 4.9-3.4v-3.2c-0.8-1.9-2.7-3-4.9-3-2.8 0-4.5 1.8-4.5 5.6z" />
        <path
          d="M78.5 12.2 C82 8.6, 88 8.2, 91.5 11.2"
          fill="none"
          stroke="url(#koaInk)"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M90.2 10.2 C92.4 9.4, 93.8 10.8, 93.2 12.6"
          fill="none"
          stroke="#7cffb2"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </g>

      <path
        d="M10 36.2 C28 33.8, 52 33.2, 74 35.6 C80 36.4, 86 37.2, 92 36"
        fill="none"
        stroke="url(#koaAccent)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M74 35.6 C78 34.2, 84 32.8, 90 34.8"
        fill="none"
        stroke="#7cffb2"
        strokeOpacity="0.55"
        strokeWidth="1.1"
        strokeLinecap="round"
      />

      <circle cx="94" cy="33.5" r="1.35" fill="#3dcea0" opacity="0.7" />
      <circle cx="97.2" cy="30.8" r="0.85" fill="#7cffb2" opacity="0.55" />
      <circle cx="14" cy="7" r="0.9" fill="#7cffb2" opacity="0.4" />
      <circle cx="58" cy="8.5" r="0.7" fill="#3dcea0" opacity="0.35" />
    </svg>
  )
}
