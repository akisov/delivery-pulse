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

// Оригинальная SVG-иллюстрация: брутальный лысый бородач в смокинге (без копирайта)
function BroAvatar() {
  return (
    <svg viewBox="0 0 80 104" className="h-full w-full" style={{ filter: "drop-shadow(0 6px 12px rgba(0,0,0,0.4))" }}>
      <defs>
        <linearGradient id="skin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ECBC97" /><stop offset="0.5" stopColor="#D89D72" /><stop offset="1" stopColor="#B97F58" />
        </linearGradient>
        <linearGradient id="suit" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2e38" /><stop offset="1" stopColor="#0d0f14" />
        </linearGradient>
        <linearGradient id="beard" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6b7280" /><stop offset="1" stopColor="#4a5360" />
        </linearGradient>
      </defs>
      {/* плечи / смокинг */}
      <path d="M6 104 V84 Q6 72 24 67 L40 63 L56 67 Q74 72 74 84 V104 Z" fill="url(#suit)" />
      <path d="M40 64 L29 104 H34 L40 74 L46 104 H51 Z" fill="#0a0b0e" />
      <path d="M36 64 L40 84 L44 64 L40 66 Z" fill="#f5f5f6" />
      {/* бабочка */}
      <path d="M40 70 l-6.5 -4 v8 z M40 70 l6.5 -4 v8 z" fill="#08090c" />
      <rect x="37.8" y="68" width="4.4" height="4.4" rx="1.1" fill="#08090c" />
      {/* шея */}
      <path d="M32 56 h16 v9 q-8 5 -16 0 z" fill="#B27C54" />
      <path d="M32 60 q8 4 16 0 v3 q-8 4 -16 0 z" fill="#945f3e" opacity="0.45" />
      {/* голова с сильной челюстью */}
      <path d="M40 12 C26 12 20 22 19 35 C18.6 43 20 50 24 56 C28 63 33 66 40 66 C47 66 52 63 56 56 C60 50 61.4 43 61 35 C60 22 54 12 40 12 Z" fill="url(#skin)" />
      {/* блик на лысине */}
      <ellipse cx="34" cy="22" rx="11" ry="6" fill="#F3CDA8" opacity="0.5" />
      {/* тени скул */}
      <path d="M22 40 q3 9 8 14 q-7 -2 -9 -10 z" fill="#AE7850" opacity="0.4" />
      <path d="M58 40 q-3 9 -8 14 q7 -2 9 -10 z" fill="#AE7850" opacity="0.4" />
      {/* уши */}
      <ellipse cx="19.5" cy="40" rx="3.2" ry="5" fill="#B27C54" />
      <ellipse cx="60.5" cy="40" rx="3.2" ry="5" fill="#B27C54" />
      {/* тяжёлые брови, нахмурен */}
      <path d="M26 33 q6 -4 11.5 -1.2 l-0.7 3 q-5 -2.4 -10.4 0.3 z" fill="#43332765" />
      <path d="M26 33 q6 -4 11.5 -1.2 l-0.7 3 q-5 -2.4 -10.4 0.3 z" fill="#433327" />
      <path d="M54 33 q-6 -4 -11.5 -1.2 l0.7 3 q5 -2.4 10.4 0.3 z" fill="#433327" />
      <path d="M39 32 v4 M41 32 v4" stroke="#9a6a45" strokeWidth="0.7" opacity="0.5" strokeLinecap="round" />
      {/* глаза — прищур, цепкий взгляд */}
      <path d="M28.5 39 q4 -3 8 -0.6 q-3.6 3 -8 0.6 z" fill="#f4f1ec" />
      <path d="M43.5 39 q4 -3 8 -0.6 q-3.6 3 -8 0.6 z" fill="#f4f1ec" />
      <circle cx="32.4" cy="38.8" r="1.5" fill="#4a3526" /><circle cx="32.4" cy="38.8" r="0.6" fill="#1c140d" />
      <circle cx="47.6" cy="38.8" r="1.5" fill="#4a3526" /><circle cx="47.6" cy="38.8" r="0.6" fill="#1c140d" />
      <path d="M28 38 q4 -2.6 8.4 -0.4 M43.6 38 q4 -2.6 8.4 -0.4" stroke="#6e4f37" strokeWidth="1" fill="none" strokeLinecap="round" />
      {/* нос */}
      <path d="M40 37 v9 q-2.8 1.6 -4.6 0.2" stroke="#A06A45" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      {/* короткая густая борода */}
      <path d="M21 41 Q23 55 30 61 Q35 66 40 66 Q45 66 50 61 Q57 55 59 41 Q57 51 50 55 Q49 50 46 49 H34 Q31 50 30 55 Q23 51 21 41 Z" fill="url(#beard)" />
      {/* усы */}
      <path d="M32 49 q8 3.5 16 0 q-3.2 3.4 -8 3.4 q-4.8 0 -8 -3.4 z" fill="#5b6470" />
      {/* рот */}
      <path d="M34 53 q6 2.4 12 0" stroke="#4f3526" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      {/* текстура бороды */}
      <g fill="#3c4350" opacity="0.55">
        <circle cx="26" cy="46" r="0.6" /><circle cx="29" cy="50" r="0.6" /><circle cx="54" cy="46" r="0.6" />
        <circle cx="51" cy="50" r="0.6" /><circle cx="40" cy="60" r="0.6" /><circle cx="35" cy="58" r="0.6" /><circle cx="45" cy="58" r="0.6" />
      </g>
    </svg>
  )
}

export function StathamBro() {
  const [i, setI] = useState(() => Math.floor(Math.random() * QUOTES.length))
  const [hidden, setHidden] = useState(false)
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
      {/* аватарка — крупная, без круга */}
      <div className="relative shrink-0 w-[92px] h-[116px] -mb-1">
        <BroAvatar />
        <button onClick={() => setHidden(true)} title="Скрыть"
          className="absolute top-0 right-0 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground shadow">
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}
