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

// Оригинальная SVG-аватарка: брутальный лысый в смокинге (без копирайта, деплоится как код)
function BroAvatar() {
  return (
    <svg viewBox="0 0 64 64" className="h-full w-full">
      <defs>
        <radialGradient id="bg" cx="50%" cy="38%" r="75%">
          <stop offset="0" stopColor="#2b3242" /><stop offset="1" stopColor="#161a24" />
        </radialGradient>
        <linearGradient id="skin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#EBBA95" /><stop offset="0.55" stopColor="#D89E73" /><stop offset="1" stopColor="#BC835B" />
        </linearGradient>
        <linearGradient id="suit" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#23262e" /><stop offset="1" stopColor="#0e1014" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="32" fill="url(#bg)" />
      {/* смокинг */}
      <path d="M12 64 V58 Q12 49 22 46 L32 44 L42 46 Q52 49 52 58 V64 Z" fill="url(#suit)" />
      <path d="M27 45 L32 64 L37 45 L32 47 Z" fill="#f4f4f5" />
      {/* бабочка */}
      <path d="M32 50 l-5 -3 v6 z M32 50 l5 -3 v6 z" fill="#0b0c0f" />
      <rect x="30.6" y="48.4" width="2.8" height="3.2" rx="0.8" fill="#0b0c0f" />
      {/* шея */}
      <path d="M26 41 h12 v6 q-6 4 -12 0 z" fill="#C2885F" />
      {/* голова */}
      <path d="M18 30 Q18 13 32 13 Q46 13 46 30 Q46 44 32 47 Q18 44 18 30 Z" fill="url(#skin)" />
      {/* блик на лысине */}
      <ellipse cx="29" cy="20" rx="7" ry="4" fill="#F2CBA6" opacity="0.55" />
      {/* уши */}
      <ellipse cx="18.5" cy="31" rx="2.6" ry="3.6" fill="#C2885F" />
      <ellipse cx="45.5" cy="31" rx="2.6" ry="3.6" fill="#C2885F" />
      {/* брови — тяжёлые, серьёзные */}
      <path d="M22 28 q4 -2.6 8 -0.6 l-0.4 2 q-3.6 -1.6 -7.2 0.4 z" fill="#4b3a2c" />
      <path d="M42 28 q-4 -2.6 -8 -0.6 l0.4 2 q3.6 -1.6 7.2 0.4 z" fill="#4b3a2c" />
      {/* глаза — прищур */}
      <ellipse cx="26" cy="31.5" rx="2.4" ry="1.5" fill="#fff" />
      <ellipse cx="38" cy="31.5" rx="2.4" ry="1.5" fill="#fff" />
      <circle cx="26.3" cy="31.6" r="1.15" fill="#3b2f25" />
      <circle cx="38.3" cy="31.6" r="1.15" fill="#3b2f25" />
      <path d="M23.4 30.6 q2.6 -1.4 5.2 0 M35.4 30.6 q2.6 -1.4 5.2 0" stroke="#7a5a3f" strokeWidth="0.8" fill="none" strokeLinecap="round" />
      {/* нос */}
      <path d="M32 32 v4 q-2 1 -3 0.2" stroke="#A9744F" strokeWidth="1.1" fill="none" strokeLinecap="round" />
      {/* рот — твёрдая линия */}
      <path d="M27.5 40.4 q4.5 1.8 9 0" stroke="#6e4733" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      {/* щетина — борода/усы текстурой */}
      <g fill="#5c6470" opacity="0.5">
        <path d="M20 33 Q22 44 32 47 Q42 44 44 33 Q42 41 38 43.5 H26 Q22 41 20 33 Z" />
        <rect x="28.5" y="37" width="7" height="2" rx="1" />
      </g>
      {/* лёгкая щетина точками на щеках */}
      <g fill="#3f4654" opacity="0.45">
        <circle cx="24" cy="38" r="0.5" /><circle cx="27" cy="40" r="0.5" /><circle cx="40" cy="38" r="0.5" />
        <circle cx="37" cy="40" r="0.5" /><circle cx="32" cy="43" r="0.5" /><circle cx="29.5" cy="42" r="0.5" /><circle cx="34.5" cy="42" r="0.5" />
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
      {/* аватарка */}
      <div className="relative shrink-0">
        <div className="h-14 w-14 overflow-hidden rounded-full border-2 border-primary/40 shadow-[0_4px_16px_rgba(108,99,255,0.35)] bg-[#1f2433]">
          <BroAvatar />
        </div>
        <button onClick={() => setHidden(true)} title="Скрыть"
          className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground shadow">
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}
