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

// SVG-аватарка «брутальный лысый» — фолбэк, если нет /statham.jpg
function BroAvatar() {
  return (
    <svg viewBox="0 0 64 64" className="w-full h-full">
      <defs>
        <linearGradient id="sk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#E8B591" /><stop offset="1" stopColor="#C8916B" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="32" fill="#1f2433" />
      <ellipse cx="32" cy="30" rx="17" ry="19" fill="url(#sk)" />
      <path d="M16 26 Q32 6 48 26 Q40 18 32 18 Q24 18 16 26Z" fill="#d8a37c" opacity="0.5" />
      {/* щетина */}
      <path d="M18 34 Q32 52 46 34 Q44 46 32 48 Q20 46 18 34Z" fill="#6b7280" opacity="0.45" />
      {/* брови */}
      <rect x="20" y="27" width="9" height="2.4" rx="1.2" fill="#5b4636" transform="rotate(6 24 28)" />
      <rect x="35" y="27" width="9" height="2.4" rx="1.2" fill="#5b4636" transform="rotate(-6 40 28)" />
      {/* очки */}
      <rect x="19" y="29" width="11" height="7" rx="2" fill="#111827" />
      <rect x="34" y="29" width="11" height="7" rx="2" fill="#111827" />
      <rect x="29.5" y="31.5" width="5" height="2" fill="#111827" />
      {/* серьёзный рот */}
      <rect x="27" y="42" width="10" height="2" rx="1" fill="#7a4b3a" />
    </svg>
  )
}

export function StathamBro() {
  const [i, setI] = useState(() => Math.floor(Math.random() * QUOTES.length))
  const [hidden, setHidden] = useState(false)
  const [imgOk, setImgOk] = useState(true)
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
          {imgOk
            ? <img src="/statham.jpg" alt="bro" className="h-full w-full object-cover object-[50%_22%]" onError={() => setImgOk(false)} />
            : <BroAvatar />}
        </div>
        <button onClick={() => setHidden(true)} title="Скрыть"
          className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground shadow">
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}
