import { Lock, Target, Sparkles, BarChart3, Workflow, Truck, AlertTriangle, Landmark, Gauge } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface Props {
  onGo: (section: "blockings" | "sle" | "flow" | "osp" | "incidents" | "arch" | "est") => void
}

const RELEASES: { date: string; title: string; items: string[] }[] = [
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
    title: "Оценка", desc: "План-факт спринта (Курьеры U): план в SP по ролям + факт из worklog в реальном времени, фиксация итога." },
  { section: "sle" as const, icon: Target, color: "#10B981",
    title: "Анализ SLE", desc: "Кластеризация причин нарушения SLE по PUTKURERA, скрытые блокировки." },
  { section: "flow" as const, icon: Workflow, color: "#38BDF8",
    title: "Поток E2E", desc: "Возраст работы в Discovery/Delivery (WIP Age P90), WIP-лимиты и недельный тренд." },
  { section: "osp" as const, icon: Truck, color: "#F59E0B",
    title: "ОСП", desc: "Обзор сервиса поставки: сколько сделали по месяцам (Story, тех. долг, инциденты) по командам курьеров." },
]

export function HomePage({ onGo }: Props) {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
          <Sparkles className="w-3.5 h-3.5" /> Дашборд процессов доставки
        </span>
        <h1 className="text-4xl md:text-5xl font-black tracking-tight leading-[1.1] pb-1 text-gradient">Пульс доставки</h1>
        <p className="text-base text-muted-foreground max-w-2xl">
          Блокировки, нарушения SLE, поток и обзор сервиса поставки (ОСП) по командам курьеров
          POOLING · DOSTAVKAPIKO · UDOSTAVKA · PUTKURERA — с автоматическим разбором причин от ИИ.
        </p>
      </div>

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
    </div>
  )
}
