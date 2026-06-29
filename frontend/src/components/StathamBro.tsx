import { useEffect, useState } from "react"
import { X } from "lucide-react"

// Пацанские цитаты по теме дашборда — в стиле «мудрости Стетхема», без мата
const QUOTES = [
  "Пока ты смотришь на WIP-лимит — я смотрю сквозь него.",
  "Блокировки не разрешают. Их отпускают, когда я разрешу.",
  "У слабых задачи висят. У меня они стоят по стойке смирно.",
  "SLE — это не срок. Это вызов, который я уже принял.",
  "Инцидент живёт ровно столько, сколько я моргаю.",
  "Бэклог боится не дедлайна. Бэклог боится меня.",
  "P90 — это для тех, кто не дотянул до меня.",
  "Поток не управляется. Поток слушается.",
  "Эталон не ищут. Эталоном становятся. Я стал.",
  "Спринт заканчивается не в пятницу. Спринт заканчивается, когда я сказал.",
  "Арх. комитет не возвращает мои задачи. Он провожает их с уважением.",
  "Тех. долг берут в долг. Я беру его за горло.",
  "Готово к тестированию? У меня всё рождается протестированным.",
  "Доработка на приёмке — это когда приёмка дорабатывает себя.",
  "Мой WIP Age младше твоего. Потому что я не держу — я двигаю.",
  "Каждое утро я открываю дашборд. Дашборд открывает рот.",
]

// Оригинальная SVG-иллюстрация: суровый лысый бородач в смокинге (action-типаж, без копирайта)
function BroAvatar() {
  return (
    <svg viewBox="0 0 80 104" className="h-full w-full" style={{ filter: "drop-shadow(0 6px 12px rgba(0,0,0,0.45))" }}>
      <defs>
        <linearGradient id="skin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#EEC09B" /><stop offset="0.5" stopColor="#D99E73" /><stop offset="1" stopColor="#B57C55" />
        </linearGradient>
        <linearGradient id="suit" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2c303a" /><stop offset="1" stopColor="#0c0e13" />
        </linearGradient>
        <linearGradient id="beard" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5a626e" /><stop offset="1" stopColor="#363d48" />
        </linearGradient>
      </defs>
      {/* плечи / смокинг с острыми лацканами */}
      <path d="M5 104 V83 Q5 71 24 66 L40 62 L56 66 Q75 71 75 83 V104 Z" fill="url(#suit)" />
      <path d="M40 63 L27 104 H33 L40 73 L47 104 H53 Z" fill="#070809" />
      <path d="M36.5 63 L40 84 L43.5 63 L40 65 Z" fill="#f5f5f6" />
      <path d="M30 70 l10 -6 l10 6" stroke="#3a3f4a" strokeWidth="0.8" fill="none" opacity="0.7" />
      {/* бабочка */}
      <path d="M40 70 l-7 -4.2 v8.4 z M40 70 l7 -4.2 v8.4 z" fill="#060708" />
      <rect x="37.7" y="67.8" width="4.6" height="4.6" rx="1.2" fill="#060708" />
      {/* шея + кадык-тень */}
      <path d="M31 55 h18 v10 q-9 5 -18 0 z" fill="#B07A52" />
      <path d="M31 59 q9 4 18 0 v3 q-9 4 -18 0 z" fill="#8f5a3a" opacity="0.5" />
      {/* короткая стрижка по бокам/затылку (тень) — за головой */}
      <path d="M17 30 Q15 46 22 58 Q17 50 16 38 Z" fill="#3c4250" opacity="0.85" />
      <path d="M63 30 Q65 46 58 58 Q63 50 64 38 Z" fill="#3c4250" opacity="0.85" />
      {/* голова: сильная угловатая челюсть */}
      <path d="M40 11 C25 11 19 22 18.5 34 C18.2 42 20 49 24 55 C27.5 62 33 65 40 65 C47 65 52.5 62 56 55 C60 49 61.8 42 61.5 34 C61 22 55 11 40 11 Z" fill="url(#skin)" />
      {/* блик на лысине + лобные доли */}
      <ellipse cx="34" cy="21" rx="12" ry="6.5" fill="#F4CFAA" opacity="0.55" />
      <path d="M28 17 Q40 12 52 17 Q40 15 28 17 Z" fill="#F7D6B4" opacity="0.5" />
      {/* короткая щетина на скальпе по краям */}
      <path d="M19 33 Q22 22 31 17 Q24 24 21 34 Z" fill="#7a4f39" opacity="0.25" />
      <path d="M61 33 Q58 22 49 17 Q56 24 59 34 Z" fill="#7a4f39" opacity="0.25" />
      {/* надбровный выступ — тень */}
      <path d="M25 31 Q40 27 55 31 Q40 33 25 31 Z" fill="#A8744E" opacity="0.4" />
      {/* скулы: блик + впадина */}
      <path d="M23 42 q3 7 7 11 q-7 -1 -9 -8 z" fill="#A8744E" opacity="0.45" />
      <path d="M57 42 q-3 7 -7 11 q7 -1 9 -8 z" fill="#A8744E" opacity="0.45" />
      <ellipse cx="29" cy="40" rx="3.5" ry="2" fill="#F4CFAA" opacity="0.35" transform="rotate(-15 29 40)" />
      <ellipse cx="51" cy="40" rx="3.5" ry="2" fill="#F4CFAA" opacity="0.35" transform="rotate(15 51 40)" />
      {/* уши */}
      <ellipse cx="19" cy="40" rx="3.3" ry="5.2" fill="#B07A52" /><ellipse cx="19" cy="40" rx="1.4" ry="2.6" fill="#915d3c" />
      <ellipse cx="61" cy="40" rx="3.3" ry="5.2" fill="#B07A52" /><ellipse cx="61" cy="40" rx="1.4" ry="2.6" fill="#915d3c" />
      {/* брови — густые, сведённые */}
      <path d="M25 32.6 Q31 29 37.5 31.4 L37 34.6 Q31 32 25.6 35 Z" fill="#3b2c20" />
      <path d="M55 32.6 Q49 29 42.5 31.4 L43 34.6 Q49 32 54.4 35 Z" fill="#3b2c20" />
      <path d="M38.6 31 v4.5 M41.4 31 v4.5" stroke="#9a6a45" strokeWidth="0.7" opacity="0.55" strokeLinecap="round" />
      {/* глаза — прищур, тяжёлое верхнее веко */}
      <path d="M28 39.4 Q32.3 36.6 36.6 39 Q32.3 41.8 28 39.4 Z" fill="#efe7dc" />
      <path d="M43.4 39 Q47.7 36.6 52 39.4 Q47.7 41.8 43.4 39 Z" fill="#efe7dc" />
      <circle cx="32.3" cy="39" r="1.7" fill="#43352a" /><circle cx="32.3" cy="39" r="0.7" fill="#15100b" /><circle cx="31.8" cy="38.4" r="0.4" fill="#fff" opacity="0.8" />
      <circle cx="47.7" cy="39" r="1.7" fill="#43352a" /><circle cx="47.7" cy="39" r="0.7" fill="#15100b" /><circle cx="47.2" cy="38.4" r="0.4" fill="#fff" opacity="0.8" />
      <path d="M27.6 37.6 Q32.3 35 37 37.6 M43 37.6 Q47.7 35 52.4 37.6" stroke="#5e4330" strokeWidth="1.1" fill="none" strokeLinecap="round" />
      <path d="M28.5 41 Q32.3 42.4 36 41 M44 41 Q47.7 42.4 51.5 41" stroke="#a8744e" strokeWidth="0.6" fill="none" opacity="0.6" strokeLinecap="round" />
      {/* нос — спинка с бликом, ноздри */}
      <path d="M40 35 v10" stroke="#F4CFAA" strokeWidth="1.4" opacity="0.5" strokeLinecap="round" />
      <path d="M40 45 q-3 1.8 -4.8 0.2 M40 45 q3 1.8 4.8 0.2" stroke="#9a6038" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      <ellipse cx="37.6" cy="45.6" rx="0.9" ry="0.7" fill="#7a4a2c" /><ellipse cx="42.4" cy="45.6" rx="0.9" ry="0.7" fill="#7a4a2c" />
      {/* короткая густая борода с краем */}
      <path d="M20 40 Q22 55 29 61 Q34 65 40 65 Q46 65 51 61 Q58 55 60 40 Q58 51 50.5 55 Q49.5 49 46 48 H34 Q30.5 49 29.5 55 Q22 51 20 40 Z" fill="url(#beard)" />
      {/* усы */}
      <path d="M31.5 48 q8.5 4 17 0 q-3.4 3.8 -8.5 3.8 q-5.1 0 -8.5 -3.8 z" fill="#4a525e" />
      {/* рот — твёрдый, лёгкий ухмыл */}
      <path d="M33.5 52.6 q6.5 2.6 13 -0.4" stroke="#42291d" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      {/* нижняя губа-тень */}
      <path d="M37 55 q3 1.2 6 0" stroke="#caa074" strokeWidth="1.2" fill="none" opacity="0.6" strokeLinecap="round" />
      {/* штрихи бороды */}
      <g stroke="#2f3641" strokeWidth="0.5" opacity="0.5" strokeLinecap="round">
        <path d="M25 45 l1.5 4" /><path d="M29 49 l1 4" /><path d="M55 45 l-1.5 4" /><path d="M51 49 l-1 4" />
        <path d="M38 58 l0.5 4" /><path d="M42 58 l-0.5 4" /><path d="M34 56 l0.8 3.5" /><path d="M46 56 l-0.8 3.5" />
      </g>
    </svg>
  )
}

// Файл аватара пробуем в любом из форматов; если ни один не загрузился — рисуем SVG
const AVATAR_SRCS = ["/statham.png", "/statham.jpeg", "/statham.jpg"]

export function StathamBro() {
  const [i, setI] = useState(() => Math.floor(Math.random() * QUOTES.length))
  const [hidden, setHidden] = useState(false)
  const [srcIdx, setSrcIdx] = useState(0)
  useEffect(() => {
    const id = setTimeout(() => setI(v => (v + 1) % QUOTES.length), 10000)
    return () => clearTimeout(id)
  }, [i])
  if (hidden) return null
  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-end gap-2 max-w-[330px] print:hidden">
      {/* пузырь с цитатой */}
      <div key={i} className="relative animate-fade-in-up rounded-2xl rounded-br-sm border border-border bg-card px-3.5 py-2.5 shadow-[0_8px_30px_rgba(0,0,0,0.18)]">
        <p className="text-xs font-semibold text-foreground leading-snug">«{QUOTES[i]}»</p>
        <span className="absolute -right-1.5 bottom-3 h-3 w-3 rotate-45 border-b border-r border-border bg-card" />
      </div>
      {/* аватарка — крупная, без круга; своё фото из public/ или SVG-фолбэк */}
      <div className="relative shrink-0 w-[92px] h-[116px] -mb-1">
        {srcIdx < AVATAR_SRCS.length
          ? <img src={AVATAR_SRCS[srcIdx]} alt="" onError={() => setSrcIdx(n => n + 1)}
              className="h-full w-full rounded-2xl object-cover object-top shadow-[0_6px_16px_rgba(0,0,0,0.4)]" />
          : <BroAvatar />}
        <button onClick={() => setHidden(true)} title="Скрыть"
          className="absolute top-0 right-0 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground shadow">
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}
