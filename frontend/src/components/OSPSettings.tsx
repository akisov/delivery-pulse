import { useEffect, useMemo, useState } from "react"
import { Plus, Trash2, Save, Check, Users, Target } from "lucide-react"
import { Modal } from "@/components/ui/modal"
import { cn } from "@/lib/utils"

const QUEUE_ORDER = ["POOLING", "UDOSTAVKA", "DOSTAVKAPIKO"]
const SLE_GROUPS = [
  { key: "story", label: "Story" },
  { key: "tech", label: "ТехДолг / Тех. улучшение" },
  { key: "incident", label: "Инциденты" },
]
const RU_MON = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]
function monLabel(ym: string) {
  const [y, m] = (ym || "").split("-")
  const i = parseInt(m) - 1
  return i >= 0 && i < 12 ? `${RU_MON[i]} ${(y || "").slice(2)}` : ym
}

type Thr = { lt: number; hours: number }
type SleMap = Record<string, Record<string, Thr>>
interface ThrVersion { from: string; sle: SleMap }
interface Override { name: string; team: string; from: string }
interface SettingsResp {
  ok: boolean; queues: Record<string, string>; baseline: SleMap
  sleVersions: ThrVersion[]; teamOverrides: Override[]
}

function resolveSle(versions: ThrVersion[], baseline: SleMap, month: string): SleMap {
  const appl = versions.filter(v => (v.from || "") <= (month || "9999-99"))
  const pick = appl.length ? appl.reduce((a, b) => (a.from || "") > (b.from || "") ? a : b) : null
  const src = pick?.sle || baseline
  // глубокая копия с числами
  const out: SleMap = {}
  for (const q of QUEUE_ORDER) {
    out[q] = {}
    for (const g of SLE_GROUPS) {
      const v = src?.[q]?.[g.key] || baseline?.[q]?.[g.key] || { lt: 0, hours: 0 }
      out[q][g.key] = { lt: Number(v.lt) || 0, hours: Number(v.hours) || 0 }
    }
  }
  return out
}

// строка порога: выровненные колонки [подпись | поле | единица]
function FieldRow({ label, value, suffix, onChange }: { label: string; value: number; suffix: string; onChange: (v: string) => void }) {
  return (
    <div className="grid grid-cols-[1fr_4rem_1.5rem] items-center gap-2 text-[11px] text-muted-foreground">
      <span>{label}</span>
      <input type="number" min={0} value={value} onChange={e => onChange(e.target.value)}
        className="w-16 rounded-md border border-border bg-card px-2 py-1 text-xs text-right tabular-nums text-foreground focus:border-primary/60 focus:outline-none" />
      <span className="text-[10px]">{suffix}</span>
    </div>
  )
}

export function OSPSettings({ open, onClose, onSaved, months, month, queues }: {
  open: boolean; onClose: () => void; onSaved: () => void
  months: string[]; month: string; queues: Record<string, string>
}) {
  const [tab, setTab] = useState<"sle" | "teams">("sle")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [baseline, setBaseline] = useState<SleMap>({})
  const [versions, setVersions] = useState<ThrVersion[]>([])
  const [overrides, setOverrides] = useState<Override[]>([])
  const [effFrom, setEffFrom] = useState<string>(month || "")
  const [draft, setDraft] = useState<SleMap>({})

  const qName = (q: string) => queues?.[q] || q
  const monthOpts = useMemo(() => (months?.length ? months : (month ? [month] : [])), [months, month])

  useEffect(() => {
    if (!open) return
    setLoading(true); setError(null); setSaved(false)
    fetch("/osp-settings").then(r => r.json()).then((d: SettingsResp) => {
      if (!d.ok) { setError("Не удалось загрузить настройки"); return }
      setBaseline(d.baseline || {})
      setVersions(d.sleVersions || [])
      setOverrides(d.teamOverrides || [])
      const ef = month || monthOpts[monthOpts.length - 1] || ""
      setEffFrom(ef)
      setDraft(resolveSle(d.sleVersions || [], d.baseline || {}, ef))
    }).catch(e => setError(String(e))).finally(() => setLoading(false))
  }, [open])

  // при смене «действует с месяца» — подставляем пороги, что действовали тогда
  useEffect(() => {
    if (!loading && open) setDraft(resolveSle(versions, baseline, effFrom))
  }, [effFrom])

  const setCell = (q: string, gkey: string, field: keyof Thr, val: string) => {
    setDraft(prev => ({ ...prev, [q]: { ...prev[q], [gkey]: { ...prev[q][gkey], [field]: Number(val) || 0 } } }))
  }

  const save = async () => {
    setSaving(true); setError(null); setSaved(false)
    // версии SLE: заменяем версию с тем же from или добавляем новую
    const newVersions = [...versions.filter(v => v.from !== effFrom), { from: effFrom, sle: draft }]
      .sort((a, b) => (a.from || "").localeCompare(b.from || ""))
    const cleanOv = overrides.filter(o => o.name.trim() && o.team).map(o => ({
      name: o.name.trim(), team: o.team, from: o.from || monthOpts[0] || "2026-01",
    }))
    try {
      const r = await fetch("/osp-settings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sleVersions: newVersions, teamOverrides: cleanOv }),
      }).then(r => r.json())
      if (!r.ok) { setError(r.error || "Ошибка сохранения"); return }
      setVersions(newVersions)
      setSaved(true)
      onSaved()
      setTimeout(() => setSaved(false), 2500)
    } catch (e) { setError(String(e)) } finally { setSaving(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Настройки ОСП"
      subtitle="SLE-пороги и состав команд · действуют с выбранного месяца (прошлые месяцы пересчитываются)" wide>
      {/* Вкладки */}
      <div className="flex gap-1 bg-secondary/60 rounded-lg p-1 mb-4 w-fit">
        {([["sle", "SLE-пороги", Target], ["teams", "Состав команд", Users]] as const).map(([v, label, Icon]) => (
          <button key={v} onClick={() => setTab(v)}
            className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all",
              tab === v ? "bg-primary text-primary-foreground shadow-[0_2px_8px_rgba(108,99,255,0.4)]" : "text-muted-foreground hover:text-foreground")}>
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {error && <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">⚠️ {error}</div>}
      {loading ? (
        <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">Загрузка…</div>
      ) : (
        <>
          {/* Выбор «действует с месяца» — только для SLE-порогов */}
          {tab === "sle" && (
            <div className="flex items-center gap-2 mb-4 flex-wrap rounded-lg border border-primary/20 bg-primary/[0.04] px-3 py-2">
              <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Действует с месяца</span>
              <select value={effFrom} onChange={e => setEffFrom(e.target.value)}
                className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground focus:border-primary/60 focus:outline-none capitalize">
                {monthOpts.map(m => <option key={m} value={m}>{monLabel(m)}</option>)}
              </select>
              <span className="text-[11px] text-muted-foreground">— эти пороги будут считаться для выбранного месяца и всех последующих; прошлые месяцы — по своим версиям</span>
            </div>
          )}

          {tab === "sle" ? (
            <div className="space-y-4">
              {QUEUE_ORDER.filter(q => draft[q]).map(q => (
                <div key={q} className="rounded-xl border border-border bg-card p-3">
                  <h4 className="text-xs font-black uppercase tracking-wide text-foreground mb-2">{qName(q)}</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {SLE_GROUPS.map(g => (
                      <div key={g.key} className="rounded-lg bg-secondary/40 p-2.5">
                        <p className="text-[11px] font-semibold text-foreground mb-1.5">{g.label}</p>
                        <div className="flex flex-col gap-1.5">
                          <FieldRow label="LT (дни)" value={draft[q][g.key].lt} suffix="дн" onChange={v => setCell(q, g.key, "lt", v)} />
                          <FieldRow label="Трудозатраты" value={draft[q][g.key].hours} suffix="ч" onChange={v => setCell(q, g.key, "hours", v)} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {versions.length > 0 && (
                <div className="text-[11px] text-muted-foreground">
                  <span className="font-semibold">Сохранённые наборы порогов</span> (с какого месяца действуют):{" "}
                  {versions.map((v, i) => (
                    <span key={v.from} className="capitalize">
                      {v.from === "2000-01" ? "с начала (базовые)" : `с ${monLabel(v.from)}`}{i < versions.length - 1 ? " · " : ""}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground mb-1">
                Переброс сотрудника в команду (как Гусев → Курьеры U). Совпадение по фамилии. Влияет на блок «Распределение времени».
                Месяц справа — <b>с какого месяца</b> сотрудник числится в команде (и для всех последующих).
              </p>
              {overrides.map((o, i) => (
                <div key={i} className="flex items-center gap-2 flex-wrap rounded-lg border border-border bg-card px-2.5 py-2">
                  <input value={o.name} placeholder="Фамилия" onChange={e => setOverrides(ov => ov.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                    className="flex-1 min-w-[140px] rounded-md border border-border bg-secondary/40 px-2 py-1 text-xs text-foreground focus:border-primary/60 focus:outline-none" />
                  <span className="text-[11px] text-muted-foreground">→</span>
                  <select value={o.team} onChange={e => setOverrides(ov => ov.map((x, j) => j === i ? { ...x, team: e.target.value } : x))}
                    className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground focus:border-primary/60 focus:outline-none">
                    {QUEUE_ORDER.map(q => <option key={q} value={q}>{qName(q)}</option>)}
                  </select>
                  <select value={o.from} onChange={e => setOverrides(ov => ov.map((x, j) => j === i ? { ...x, from: e.target.value } : x))}
                    className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground focus:border-primary/60 focus:outline-none capitalize" title="действует с месяца">
                    {monthOpts.map(m => <option key={m} value={m}>{monLabel(m)}</option>)}
                  </select>
                  <button onClick={() => setOverrides(ov => ov.filter((_, j) => j !== i))}
                    className="text-muted-foreground/60 hover:text-destructive transition-colors" title="Удалить">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <button onClick={() => setOverrides(ov => [...ov, { name: "", team: QUEUE_ORDER[0], from: effFrom || monthOpts[0] || "" }])}
                className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-primary hover:border-primary/50 transition-all">
                <Plus className="w-3.5 h-3.5" /> Добавить переброс
              </button>
            </div>
          )}

          {/* Сохранить */}
          <div className="mt-5 flex items-center justify-end gap-2 border-t border-border pt-3">
            {saved && <span className="text-xs text-emerald-500 inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Сохранено, блоки пересчитаны</span>}
            <button onClick={save} disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 h-9 text-xs font-bold text-primary-foreground shadow-[0_2px_8px_rgba(108,99,255,0.4)] hover:opacity-90 transition-all disabled:opacity-50">
              <Save className="w-4 h-4" /> {saving ? "Сохраняю…" : "Сохранить"}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
