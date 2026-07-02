import { useEffect, useState } from "react"
import { Lock, Target, Sparkles, BarChart3, Workflow, Truck, AlertTriangle, Landmark, Gauge, Lightbulb, Activity, Clock4, ChevronLeft, ChevronRight } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { StathamBro } from "@/components/StathamBro"
import { fetchDataHealth, type DataHealth } from "@/lib/api"
import { cn } from "@/lib/utils"

interface Props {
  onGo: (section: "blockings" | "sle" | "flow" | "osp" | "incidents" | "arch" | "est" | "feat" | "flowt" | "slackers") => void
}

const RELEASES: { date: string; title: string; items: string[] }[] = [
  {
    date: "Июнь 2026",
    title: "Раздел «Учёт часов»",
    items: [
      "Единый список тех, кто за 2 прошлых рабочих дня списал в Трекер меньше 8 ч (или не вносил часы вовсе).",
      "Часы берутся из worklog по всем очередям (не только курьерским); выходные не учитываются, сегодняшний день в окно не входит.",
      "По каждому — сумма за 2 дня, разбивка по дням и дата последнего списания; справка-ссылка на timesheet.",
      "Отпуск 🏖 и больничный 🤒 отмечаются кнопкой и убирают человека из списка (статус переживает синк).",
    ],
  },
  {
    date: "Июнь 2026",
    title: "Раздел «Поток команд» (Команды)",
    items: [
      "CFD (накопительная диаграмма потока) с разбивкой по статусам по каждой команде курьеров (X / U / R).",
      "Динамика WIP Age — 90-й перцентиль «дней в работе» по незавершённым задачам потока.",
      "WIP-лимиты с подсветкой превышения: обычные (U 17 / X 16 / R 20), 1С (U — 6), критичные+блокеры (2).",
      "История статусов реконструируется из changelog Трекера с 01.03.2026; синк инкрементальный.",
    ],
  },
  {
    date: "Июнь 2026",
    title: "«Оценка НВ» → PBR-флоу прямо из дашборда",
    items: [
      "По ключу задачи: видно текущие Effort (план) / Effort факт / категорию / статус, рядом — оценка ИИ.",
      "Кнопка «Записать effort в задачу» проставляет плановый effort (дни) в поле «Effort» Трекера.",
      "Редактируемый комментарий с Markdown — стартует из анализа, можно дописать обсуждение и отправить в задачу.",
      "Похожие эталоны теперь подробно: категория, Effort факт, дни в работе и разбивка effort по стекам.",
    ],
  },
  {
    date: "Июнь 2026",
    title: "Раздел «Оценка новых возможностей» (E2E)",
    items: [
      "AI по описанию задачи или её ключу предлагает категорию (S / M / L) и оценку effort, опираясь на SLE и похожие эталоны.",
      "Эталонные задачи — реальные завершённые задачи PUTKURERA с разбивкой по командам (R / X / U) и категориям, чтобы откалибровать effort-план.",
      "Категория — по Effort факт (S ≤ 14, M ≤ 40, L > 40 дней); SLE: S=55, M=88, L=108.",
    ],
  },
  {
    date: "Июнь 2026",
    title: "Раздел «Оценка» — план-факт спринта (Курьеры U)",
    items: [
      "Планируем задачи спринта в SP по ролям-стекам (SA / GO / FE / QA / 1C / AQA): добавляем задачу по ключу и проставляем оценку.",
      "Killer-фича: факт в реальном времени — сколько часов списано на задачи в окне спринта (worklog Трекера), переведено в SP (1 SP = 8 ч).",
      "Карточки план/факт/выполнение, графики «по задачам» и «по ролям» (план vs факт, перерасход — красным), прогресс-бары по задачам.",
      "Хайлайты: что перевыполнено, что не начато, что меньше всех готово. Кнопка «Зафиксировать итог» замораживает результат спринта.",
    ],
  },
  {
    date: "Июнь 2026",
    title: "Раздел «Арх. комитет» (возвраты)",
    items: [
      "Прохождение архитектурного комитета и возвраты по трём очередям курьеров (X / U / R): вход в комитет, возвраты АрхКома (на ревью аналитики) и ТА (на доработку).",
      "Метрики периода со сравнением с предыдущим равным: пришло, прошло с первого раза, возвраты АрхКом / ТА / оба, всего возвратов.",
      "«Сейчас в Арх. комитете» — задачи в статусах комитета с днями на статусе, исполнителем и счётчиком возвратов; подсветка засидевшихся (≥7 дней).",
      "Воронка, динамика по неделям/месяцам, время прохождения комитета и разбивки по очереди и типу задачи.",
      "Общая синхронизация: одна кнопка «Синк» тянет и блокировки, и историю переходов арх. комитета.",
    ],
  },
  {
    date: "Июнь 2026",
    title: "Раздел «Инциденты»",
    items: [
      "Все инциденты трёх очередей курьеров (X / U / R) по месяцам · фильтр команды и период (как в блокировках, по умолчанию с начала года).",
      "Сколько инцидентов заведено в каждом месяце (по дате создания); доля времени на инциденты от всех типов работ — «волна» по месяцам.",
      "Группировка по причине (AI-кластеры), стеку, приоритету и исполнителю («пожарные»); при раскрытии — список с исходной причиной, стеком, днями в работе и часами.",
      "Топ-10: дольше всех в работе, самые трудозатратные, частые причины (кластеры).",
      "AI-сводка по инцидентам (Claude) со сравнением периода с предыдущим равным.",
    ],
  },
  {
    date: "Июнь 2026",
    title: "Раздел «ОСП» — обзор сервиса поставки",
    items: [
      "Сколько сделали по месяцам: Story / ТехДолг / Тех. улучшение / Аналитика / Инциденты — по командам курьеров (X / U / R); клик по типу или столбцу открывает список задач.",
      "Попадание в SLE по LT (дни в работе) и трудозатратам (часы) с целью 85%; клик по проценту показывает задачи вне SLE.",
      "Распределение времени (worklog): часы по типам и сотрудникам, работа в чужих очередях, ключевые метрики, тренд к предыдущему месяцу.",
      "Инцидентов создано по месяцам и динамика блокировок с разбивкой по причинам + ссылка на дашборд блокировок.",
      "Оценка продакта: динамика средней оценки (1–5) по месяцам и форма для проставления оценок.",
      "Единый фильтр команды на весь раздел и одна кнопка «Обновить».",
    ],
  },
  {
    date: "Июнь 2026",
    title: "«Поток E2E» и точность блокировок",
    items: [
      "Раздел «Поток» переименован в «Поток E2E».",
      "«Общее время простоя по причинам» теперь считает дни блокировки с обрезкой по выбранному периоду (как помесячно) — цифры сходятся с отчётами.",
    ],
  },
  {
    date: "Июнь 2026",
    title: "Раздел «Поток» (Discovery / Delivery)",
    items: [
      "WIP Age P90 по потокам Discovery и Delivery с WIP-лимитами и подсветкой превышения.",
      "Топ задач по возрасту в потоке и разбивка SLE-риска в Delivery.",
      "Недельный снапшот метрик и тренд WIP Age P90 по неделям.",
    ],
  },
  {
    date: "Июнь 2026",
    title: "Раздел «Анализ нарушений SLE»",
    items: [
      "Новый раздел по очереди PUTKURERA: текущая ситуация и история нарушений SLE.",
      "AI-кластеризация причин нарушения SLE по 4 категориям (внешние зависимости, крупная задача / не MMF, техническая блокировка, ошибка оценки).",
      "Детектор «скрытых блокировок» — когда у задачи есть подзадачи, но активных нет (работа не спланирована).",
      "Ручная правка кластера прямо в карточке — перекрывает решение ИИ и сохраняется.",
      "Графики распределения по риску SLE и по кластерам с группировкой по клику.",
    ],
  },
  {
    date: "Июнь 2026",
    title: "AI-сводка по блокировкам",
    items: [
      "Информер с разбором от ИИ (Claude): маркер проблемы + рекомендация в духе практики «Анализ блокировок».",
      "Выводы строятся по суммарному времени простоя (приоритет по практике), а не по количеству.",
      "Тренд к предыдущему периоду с явными датами сравнения и защитой от сравнения с пустотой.",
      "Ссылка на внутреннюю практику прямо в информере.",
    ],
  },
  {
    date: "Июнь 2026",
    title: "Дашборд блокировок",
    items: [
      "Время разрешения блокировок, причины, общее время простоя (с разбивкой задач по этапам по клику).",
      "Аналитика блокировок — 5 графиков (этапы, причины, типы задач, среднее время).",
      "Догрузка типов задач, единый чип «P85+», единообразные подсказки P70/P85.",
      "Фикс отступов графика при разворачивании, общее наведение красоты на плитки.",
    ],
  },
]

const NAV_CARDS = [
  { section: "blockings" as const, icon: Lock, color: "#7C6FF7",
    title: "Блокировки", desc: "Время разрешения, причины, этапы и AI-сводка по трём очередям." },
  { section: "incidents" as const, icon: AlertTriangle, color: "#EF4444",
    title: "Инциденты", desc: "Все инциденты курьеров по месяцам: доля времени, AI-кластеры причин, стек, приоритет и топы." },
  { section: "arch" as const, icon: Landmark, color: "#6366F1",
    title: "Арх. комитет", desc: "Прохождение арх. комитета и возвраты (АрхКом · ТА) по трём очередям: воронка, время цикла и «сейчас в комитете»." },
  { section: "est" as const, icon: Gauge, color: "#EC4899",
    title: "Спринты", desc: "План-факт спринта (Курьеры U): план в SP по ролям + факт из worklog в реальном времени, фиксация итога." },
  { section: "sle" as const, icon: Target, color: "#10B981",
    title: "Анализ SLE", desc: "Кластеризация причин нарушения SLE по PUTKURERA, скрытые блокировки." },
  { section: "flow" as const, icon: Workflow, color: "#38BDF8",
    title: "Поток E2E", desc: "Возраст работы в Discovery/Delivery (WIP Age P90), WIP-лимиты и недельный тренд." },
  { section: "flowt" as const, icon: Activity, color: "#22D3EE",
    title: "Поток команд", desc: "CFD по статусам и динамика WIP Age (P90 дней в работе) по командам курьеров (X · U · R), WIP-лимиты." },
  { section: "feat" as const, icon: Lightbulb, color: "#FBBF24",
    title: "Оценка НВ", desc: "Новые возможности: AI-категория (S/M/L), effort и MMF-проверка + эталоны по командам и категориям." },
  { section: "slackers" as const, icon: Clock4, color: "#F43F5E",
    title: "Учёт часов", desc: "Кто недосписал часы: за 2 прошлых рабочих дня меньше 8 ч (или не вносил вовсе) по worklog Трекера во всех очередях." },
  { section: "osp" as const, icon: Truck, color: "#F59E0B",
    title: "ОСП", desc: "Обзор сервиса поставки: сколько сделали по месяцам (Story, тех. долг, инциденты) по командам курьеров." },
]

type Section = Parameters<Props["onGo"]>[0]
const TIPS: { lead: string; text: string; section?: Section }[] = [
  { lead: "⌘K — командная палитра", text: "жми Cmd/Ctrl + K и прыгай в любой раздел за секунду, не тыкая в меню." },
  { lead: "Поток команд", text: "кликни по плитке WIP — откроется список задач с исполнителем, статусом и днями в работе.", section: "flowt" },
  { lead: "Оценка НВ", text: "вставь ссылку на задачу — AI прикинет категорию (S/M/L) и effort по реальным эталонам, плюс проверит на MMF.", section: "feat" },
  { lead: "Спринты", text: "факт считается из worklog Трекера в реальном времени: затрекал часы — они уже в спринте.", section: "est" },
  { lead: "Учёт часов", text: "видно, кто за 2 прошлых рабочих дня списал меньше 8 ч; отпуск/больничный отмечаются кнопкой и убирают человека из списка.", section: "slackers" },
  { lead: "Поток команд", text: "красная линия на CFD — WIP-лимит команды. Стек выше неё = работы в потоке больше, чем тянет команда.", section: "flowt" },
  { lead: "Арх. комитет", text: "смотри возвраты (АрхКом · ТА) и кто засиделся в комитете ≥ 7 дней — подсвечивается.", section: "arch" },
  { lead: "Анализ SLE", text: "AI кластеризует причины нарушений: внешние зависимости, не-MMF, тех. блокировки, ошибки оценки.", section: "sle" },
  { lead: "Блокировки", text: "клик по столбцу или причине разворачивает задачи по этапам — видно, где именно встало.", section: "blockings" },
  { lead: "Инциденты", text: "AI-сводка сравнивает период с предыдущим равным — сразу видно, стало хуже или лучше.", section: "incidents" },
  { lead: "Поток E2E", text: "WIP Age P90 — возраст незавершённой работы. Чем ниже линия, тем быстрее задачи проходят поток.", section: "flow" },
  { lead: "ОСП", text: "попадание в SLE по дням и часам с целью 85%; клик по проценту покажет задачи вне SLE.", section: "osp" },
  { lead: "Не мониторь руками", text: "жми «Синк» — данные сами подтянутся из Трекера; синк потока копит историю статусов." },
  { lead: "Тёмная тема", text: "переключатель в правом верхнем углу — глаза скажут спасибо на ночных разборах." },
]

function TipOfDay({ onGo }: { onGo: Props["onGo"] }) {
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * TIPS.length))
  useEffect(() => {
    const id = setTimeout(() => setIdx(i => (i + 1) % TIPS.length), 10000)
    return () => clearTimeout(id)
  }, [idx])
  const tip = TIPS[idx]
  return (
    <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card p-5 shadow-[0_0_24px_rgba(108,99,255,0.08)]">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">💡</span>
        <h3 className="text-base font-black text-foreground">Совет дня</h3>
      </div>
      <p key={idx} className="text-sm text-muted-foreground leading-relaxed animate-fade-in-up min-h-[3.5rem]">
        <b className="text-foreground">{tip.lead}</b> — {tip.text}{" "}
        {tip.section && (
          <button onClick={() => onGo(tip.section!)} className="font-semibold text-primary hover:underline whitespace-nowrap">Перейти →</button>
        )}
      </p>
      <div className="flex items-center justify-between mt-3">
        <button onClick={() => setIdx(i => (i - 1 + TIPS.length) % TIPS.length)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors">
          <ChevronLeft className="w-4 h-4" /> пред.
        </button>
        <div className="flex gap-1">
          {TIPS.map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all ${i === idx ? "w-4 bg-primary" : "w-1.5 bg-border"}`} />
          ))}
        </div>
        <button onClick={() => setIdx(i => (i + 1) % TIPS.length)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors">
          след. <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// Здоровье данных: свежесть снапшотов, прогрев при синке, счётчики таблиц
function DataHealthCard() {
  const [h, setH] = useState<DataHealth | null>(null)
  const [open, setOpen] = useState(false)
  const [err, setErr] = useState(false)
  useEffect(() => { fetchDataHealth().then(setH).catch(() => setErr(true)) }, [])
  if (err) return null
  const problems = h?.problems ?? []
  const ok = h != null && problems.length === 0
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 text-left">
        <Activity className="w-4 h-4 text-primary shrink-0" />
        <span className="text-sm font-black text-foreground">Здоровье данных</span>
        {!h ? <span className="ml-auto text-xs text-muted-foreground">проверяем…</span>
          : ok ? <span className="ml-auto text-xs font-bold text-emerald-500">🟢 всё считается</span>
               : <span className="ml-auto text-xs font-bold text-rose-500">🔴 проблем: {problems.length}</span>}
        <ChevronRight className={cn("w-4 h-4 text-muted-foreground transition-transform", open && "rotate-90")} />
      </button>
      {h?.warm?.at && <p className="text-[11px] text-muted-foreground mt-1">Прогрев при синке: {h.warm.at}</p>}
      {problems.length > 0 && (
        <ul className="mt-2 space-y-1">
          {problems.map((p, i) => (
            <li key={i} className="text-xs text-rose-500 flex gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{p}</li>
          ))}
        </ul>
      )}
      {open && h && (
        <div className="mt-3 space-y-3 text-xs border-t border-border pt-3">
          <div>
            <p className="font-bold text-muted-foreground mb-1">Прогрев секций при синке</p>
            <div className="flex flex-wrap gap-1">
              {(h.warm?.items ?? []).map(it => (
                <span key={it.section} title={it.error || `${it.ms} мс`}
                  className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold",
                    it.status === "ok" ? "bg-emerald-500/15 text-emerald-600" : "bg-rose-500/15 text-rose-500")}>
                  {it.section}
                </span>
              ))}
              {!(h.warm?.items ?? []).length && <span className="text-muted-foreground">синк ещё не прогревал</span>}
            </div>
          </div>
          <div>
            <p className="font-bold text-muted-foreground mb-1">Таблицы</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
              {Object.entries(h.tables).map(([t, c]) => <span key={t}>{t}: <b className="text-foreground">{String(c)}</b></span>)}
            </div>
          </div>
          <div>
            <p className="font-bold text-muted-foreground mb-1">Снапшоты · {h.snapshots.length}</p>
            <div className="max-h-52 overflow-y-auto space-y-0.5 pr-1">
              {h.snapshots.map(s => (
                <div key={s.table + s.which} className="flex justify-between gap-2">
                  <span className={cn(s.empty ? "text-rose-500 font-semibold" : s.stale ? "text-amber-500" : "text-foreground")}>
                    {s.which}{s.empty ? " · пусто" : s.stale ? " · устарел" : ""}
                  </span>
                  <span className="text-muted-foreground shrink-0 tabular-nums">{(s.updatedAt || "").slice(5, 16)} · {Math.round(s.bytes / 1024)}кб</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function HomePage({ onGo }: Props) {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
          <Sparkles className="w-3.5 h-3.5" /> Дашборд процессов доставки
        </span>
        <h1 className="text-4xl md:text-5xl font-black tracking-tight leading-[1.1] pb-1 text-gradient">Пульс доставки</h1>
        <p className="text-base text-muted-foreground max-w-2xl">
          Блокировки, инциденты, арх. комитет, оценка спринтов и новых возможностей, нарушения SLE,
          поток и ОСП по командам курьеров (X · U · R · PUTKURERA) — с автоматическим разбором
          и AI-оценкой.
        </p>
      </div>

      {/* Совет дня */}
      <TipOfDay onGo={onGo} />

      {/* Здоровье данных */}
      <DataHealthCard />

      {/* Карточки разделов */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {NAV_CARDS.map(c => (
          <button key={c.section} onClick={() => onGo(c.section)}
            className="group text-left rounded-2xl border border-border bg-card p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_8px_30px_rgba(108,99,255,0.15)]">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: `${c.color}22` }}>
                <c.icon className="h-5 w-5" style={{ color: c.color }} />
              </div>
              <div>
                <h3 className="text-lg font-black text-foreground">{c.title}</h3>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mt-3 leading-relaxed">{c.desc}</p>
            <span className="mt-3 inline-block text-xs font-semibold text-primary opacity-0 transition-opacity group-hover:opacity-100">
              Открыть →
            </span>
          </button>
        ))}

      </div>

      {/* Релиз-ноты */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2"><BarChart3 className="w-4 h-4" /> Что нового</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative space-y-6 pl-5 before:absolute before:left-1.5 before:top-1.5 before:bottom-1.5 before:w-px before:bg-border">
            {RELEASES.map((r, i) => (
              <div key={i} className="relative">
                <span className="absolute -left-[14px] top-1 w-2.5 h-2.5 rounded-full bg-primary ring-4 ring-background" />
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h4 className="text-sm font-black text-foreground">{r.title}</h4>
                  <span className="text-[11px] text-muted-foreground">{r.date}</span>
                </div>
                <ul className="mt-1.5 space-y-1">
                  {r.items.map((it, j) => (
                    <li key={j} className="flex gap-2 text-xs text-muted-foreground leading-relaxed">
                      <span className="text-primary shrink-0">•</span>{it}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <StathamBro />
    </div>
  )
}
