import { useEffect, useMemo, useState } from "react"
import { Plus, Save, Check, Users, Target, Search, AlertTriangle, X, UserPlus, Sparkles, RefreshCw } from "lucide-react"
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

function nrm(s: string) { return (s || "").replace(/ё/g, "е").replace(/Ё/g, "Е").trim().toLowerCase() }
// совпадение сотрудника и имени из переброса (по подстроке в любую сторону)
function nameMatches(person: string, ovName: string) {
  const a = nrm(person), b = nrm(ovName)
  return !!a && !!b && (a.includes(b) || b.includes(a))
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
  // состав команд
  const [wlRoster, setWlRoster] = useState<Record<string, string[]>>({})
  const [candidates, setCandidates] = useState<string[]>([])
  const [displayMonth, setDisplayMonth] = useState<string>("")
  const [addTeam, setAddTeam] = useState<string | null>(null)
  const [addSearch, setAddSearch] = useState("")
  const [confirm, setConfirm] = useState<{ name: string; team: string; from: string; fromTeam: string } | null>(null)

  const qName = (q: string) => queues?.[q] || q
  const monthOpts = useMemo(() => (months?.length ? months : (month ? [month] : [])), [months, month])

  useEffect(() => {
    if (!open) return
    setLoading(true); setError(null); setSaved(false); setAddTeam(null); setConfirm(null)
    Promise.all([
      fetch("/osp-settings").then(r => r.json()),
      fetch("/osp-worklog").then(r => r.json()).catch(() => null),
    ]).then(([d, wl]: [SettingsResp, any]) => {
      if (!d.ok) { setError("Не удалось загрузить настройки"); return }
      setBaseline(d.baseline || {})
      setVersions(d.sleVersions || [])
      setOverrides(d.teamOverrides || [])
      const ef = month || monthOpts[monthOpts.length - 1] || ""
      setEffFrom(ef)
      setDraft(resolveSle(d.sleVersions || [], d.baseline || {}, ef))
      // ростеры команд и список кандидатов из worklog
      const wmonths: string[] = wl?.months || []
      const dm = month && wmonths.includes(month) ? month : (wmonths[wmonths.length - 1] || "")
      const emps = wl?.employees?.[dm] || {}
      const roster: Record<string, string[]> = {}
      for (const q of QUEUE_ORDER) roster[q] = (emps[q] || []).map((e: any) => e.name)
      setWlRoster(roster)
      setDisplayMonth(dm)
      const seen = new Map<string, string>()
      const add = (n?: string) => { if (n) { const k = nrm(n); if (!seen.has(k)) seen.set(k, n) } }
      for (const mm of wmonths) {
        const em = wl?.employees?.[mm] || {}, ci = wl?.crossIn?.[mm] || {}, co = wl?.crossOut?.[mm] || {}
        for (const q of QUEUE_ORDER) {
          (em[q] || []).forEach((e: any) => add(e.name))
          ;(ci[q] || []).forEach((r: any) => add(r.name))
          ;(co[q] || []).forEach((r: any) => add(r.name))
        }
      }
      setCandidates(Array.from(seen.values()).sort((a, b) => a.localeCompare(b, "ru")))
    }).catch(e => setError(String(e))).finally(() => setLoading(false))
  }, [open])

  // текущий состав команд: ростер из worklog + применённые перебросы (на displayMonth)
  const teamRoster = useMemo(() => {
    const r: Record<string, { name: string; manual: boolean }[]> = {}
    for (const q of QUEUE_ORDER) r[q] = (wlRoster[q] || []).map(n => ({ name: n, manual: false }))
    for (const ov of overrides) {
      if (!ov.name || (ov.from && displayMonth && ov.from > displayMonth)) continue
      let disp = ov.name
      for (const q of QUEUE_ORDER) {
        const hit = (r[q] || []).find(x => nameMatches(x.name, ov.name))
        if (hit) disp = hit.name
        r[q] = (r[q] || []).filter(x => !nameMatches(x.name, ov.name))
      }
      ;(r[ov.team] ||= []).push({ name: disp, manual: true })
    }
    for (const q of QUEUE_ORDER) (r[q] || []).sort((a, b) => a.name.localeCompare(b.name, "ru"))
    return r
  }, [wlRoster, overrides, displayMonth])

  const currentTeamOf = (name: string): string | null => {
    const ov = overrides.find(o => nameMatches(name, o.name) && !(o.from && displayMonth && o.from > displayMonth))
    if (ov) return ov.team
    for (const q of QUEUE_ORDER) if ((wlRoster[q] || []).some(n => nameMatches(n, name))) return q
    return null
  }
  const addMember = (name: string, team: string, from: string) => {
    setOverrides(prev => [...prev.filter(o => !nameMatches(name, o.name)), { name, team, from: from || displayMonth || monthOpts[0] || "2026-01" }])
    setConfirm(null); setAddTeam(null); setAddSearch("")
  }
  const pickCandidate = (name: string, team: string) => {
    const cur = currentTeamOf(name)
    if (cur === team) { setAddTeam(null); setAddSearch(""); return }
    if (cur) { setConfirm({ name, team, from: effFrom || displayMonth, fromTeam: cur }); setAddTeam(null); setAddSearch("") }
    else addMember(name, team, effFrom || displayMonth)
  }
  const removeMember = (name: string) => setOverrides(prev => prev.filter(o => !nameMatches(name, o.name)))

  // при смене «действует с месяца» — подставляем пороги, что действовали тогда
  useEffect(() => {
    if (!loading && open) setDraft(resolveSle(versions, baseline, effFrom))
  }, [effFrom])

  const setCell = (q: string, gkey: string, field: keyof Thr, val: string) => {
    setDraft(prev => ({ ...prev, [q]: { ...prev[q], [gkey]: { ...prev[q][gkey], [field]: Number(val) || 0 } } }))
  }

  const [suggesting, setSuggesting] = useState(false)
  const [suggestNote, setSuggestNote] = useState("")
  const suggestSle = async () => {
    setSuggesting(true); setSuggestNote(""); setError(null)
    try {
      const r = await fetch("/osp-sle/suggest?months=6").then(r => r.json())
      if (!r.ok) { setError(r.error || "Не удалось подобрать пороги"); return }
      const next: SleMap = {}
      for (const q of QUEUE_ORDER) {
        next[q] = {}
        for (const g of SLE_GROUPS) {
          const v = r.sle?.[q]?.[g.key] || { lt: 0, hours: 0 }
          next[q][g.key] = { lt: Number(v.lt) || 0, hours: Number(v.hours) || 0 }
        }
      }
      setDraft(next)
      setSuggestNote(`Подобрано по 85-му перцентилю «дней в работе» и «часов» закрытых задач за 6 мес (${r.tasks} задач). Проверь и сохрани.`)
    } catch (e) { setError(String(e)) } finally { setSuggesting(false) }
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
          {/* Выбор «действует с месяца» */}
          <div className="flex items-center gap-2 mb-4 flex-wrap rounded-lg border border-primary/20 bg-primary/[0.04] px-3 py-2">
            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Действует с месяца</span>
            <select value={effFrom} onChange={e => setEffFrom(e.target.value)}
              className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground focus:border-primary/60 focus:outline-none capitalize">
              {monthOpts.map(m => <option key={m} value={m}>{monLabel(m)}</option>)}
            </select>
            <span className="text-[11px] text-muted-foreground">
              {tab === "sle"
                ? "— пороги считаются для этого месяца и всех последующих; прошлые месяцы — по своим версиям"
                : "— новые перебросы вступают в силу с этого месяца и всех последующих"}
            </span>
          </div>

          {tab === "sle" ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={suggestSle} disabled={suggesting}
                  className="relative inline-flex items-center gap-2 rounded-xl px-4 h-9 text-xs font-bold text-white shadow-[0_4px_16px_rgba(168,85,247,0.4)] transition-all hover:-translate-y-0.5 hover:shadow-[0_6px_22px_rgba(168,85,247,0.55)] disabled:opacity-60"
                  style={{ background: "linear-gradient(90deg, #6C63FF 0%, #A855F7 50%, #EC4899 100%)" }}>
                  {suggesting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {suggesting ? "Считаю по факту…" : "Пересчитать с AI (P85)"}
                </button>
                <span className="text-[11px] text-muted-foreground">подберёт пороги по 85-му перцентилю закрытых задач за 6 мес</span>
              </div>
              {suggestNote && (
                <div className="rounded-lg border border-primary/30 bg-primary/[0.06] px-3 py-2 text-[11px] text-foreground">✨ {suggestNote}</div>
              )}
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
            <div className="space-y-3">
              <p className="text-[11px] text-muted-foreground">
                Кто сейчас в каждой команде по часам{displayMonth ? <span className="capitalize"> ({monLabel(displayMonth)})</span> : ""}. «+» — добавить сотрудника из тех, кто был в часах. Метка <UserPlus className="inline w-3 h-3 text-primary" /> = добавлен вручную, ✕ убирает переброс.
              </p>

              {confirm && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 flex items-center gap-3 flex-wrap">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="text-xs text-foreground flex-1 min-w-[200px]">
                    Внимание: <b>{confirm.name}</b> сейчас в команде <b>{qName(confirm.fromTeam)}</b>. Перебросить в <b>{qName(confirm.team)}</b>?
                  </span>
                  <div className="flex gap-2">
                    <button onClick={() => addMember(confirm.name, confirm.team, confirm.from)}
                      className="rounded-md bg-primary px-3 py-1 text-xs font-bold text-primary-foreground shadow-[0_2px_8px_rgba(108,99,255,0.4)] hover:opacity-90">Добавить</button>
                    <button onClick={() => setConfirm(null)}
                      className="rounded-md border border-border px-3 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground">Отмена</button>
                  </div>
                </div>
              )}

              {QUEUE_ORDER.map(q => {
                const list = teamRoster[q] || []
                const filtered = candidates.filter(n => nrm(n).includes(nrm(addSearch)))
                return (
                  <div key={q} className="rounded-xl border border-border bg-card p-3">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-black uppercase tracking-wide text-foreground">
                        {qName(q)} <span className="font-normal text-muted-foreground">· {list.length}</span>
                      </h4>
                      <button onClick={() => { setAddTeam(addTeam === q ? null : q); setAddSearch("") }}
                        className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:text-primary hover:border-primary/50 transition-all">
                        <Plus className="w-3.5 h-3.5" /> Добавить
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {list.length === 0 && <span className="text-[11px] text-muted-foreground/60">никого</span>}
                      {list.map(m => (
                        <span key={m.name} className={cn("inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px]",
                          m.manual ? "bg-primary/10 text-primary border border-primary/30" : "bg-secondary/60 text-foreground")}>
                          {m.manual && <UserPlus className="w-3 h-3" />}{m.name}
                          {m.manual && (
                            <button onClick={() => removeMember(m.name)} className="ml-0.5 opacity-70 hover:opacity-100 hover:text-destructive" title="Убрать переброс">
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                    {addTeam === q && (
                      <div className="mt-2 rounded-lg border border-border bg-background p-2">
                        <div className="flex items-center gap-1.5 mb-1.5 border-b border-border pb-1.5">
                          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <input autoFocus value={addSearch} onChange={e => setAddSearch(e.target.value)} placeholder="Поиск по тем, кто был в часах…"
                            className="flex-1 bg-transparent text-xs text-foreground focus:outline-none" />
                          <button onClick={() => setAddTeam(null)} className="text-muted-foreground/60 hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
                        </div>
                        <div className="max-h-52 overflow-auto flex flex-col">
                          {filtered.length === 0 && <span className="px-2 py-2 text-[11px] text-muted-foreground/60">ничего не найдено</span>}
                          {filtered.slice(0, 60).map(n => {
                            const cur = currentTeamOf(n)
                            return (
                              <button key={n} onClick={() => pickCandidate(n, q)}
                                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs text-left text-foreground hover:bg-secondary transition-colors">
                                <span className="truncate">{n}</span>
                                {cur && <span className={cn("text-[10px] shrink-0", cur === q ? "text-emerald-500" : "text-amber-500")}>{cur === q ? "уже здесь" : qName(cur)}</span>}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
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
