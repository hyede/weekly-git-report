import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Edit, Loader2, MoreHorizontal, Play, Plus, Trash2 } from 'lucide-react'
import type { ReportCadence, ReportTask, ReportTaskMode, RepositoryProject } from '@weekly-git-report/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { getErrorMessage } from '@/lib/errors'
import { showErrorToast, showSuccessToast } from '@/lib/toast'

export function Tasks() {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<ReportTask | null>()
  const state = useQuery({ queryKey: ['tasks-state'], queryFn: () => window.electronAPI.tasks.state() })
  const projects = useQuery({
    queryKey: ['projects-state'],
    queryFn: () => window.electronAPI.projects.state(),
  })
  const save = useMutation({
    mutationFn: async (tasks: ReportTask[]) => {
      if (!state.data) throw new Error('任务配置尚未读取。')
      return window.electronAPI.tasks.save({ version: 1, tasks }, state.data.revision)
    },
    onSuccess: (next) => {
      queryClient.setQueryData(['tasks-state'], next)
      void queryClient.invalidateQueries({ queryKey: ['desktop-overview'] })
      showSuccessToast('任务配置已保存')
    },
    onError: (error) => showErrorToast(getErrorMessage(error)),
  })
  const run = useMutation({
    mutationFn: (id: string) => window.electronAPI.tasks.run(id),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['runs'] })
      showSuccessToast(result.status === 'awaiting_review' ? '报告草稿已生成，请前往执行记录审核' : '任务执行完成')
    },
    onError: (error) => showErrorToast(getErrorMessage(error)),
  })

  function updateTask(task: ReportTask) {
    const tasks = state.data?.document.tasks ?? []
    save.mutate(tasks.some((item) => item.id === task.id)
      ? tasks.map((item) => item.id === task.id ? task : item)
      : [...tasks, task])
    setEditing(undefined)
  }

  return (
    <>
      <Header><div className='me-auto text-sm font-medium'>定时生成报告</div><ThemeSwitch /></Header>
      <Main className='space-y-6'>
        <div className='flex flex-wrap items-end justify-between gap-3'>
          <div><h1 className='text-2xl font-bold tracking-tight md:text-3xl'>报告任务</h1><p className='text-muted-foreground'>按本地时间定时生成日报、周报或月报，也可以立即执行。</p></div>
          <Button onClick={() => setEditing(null)}><Plus />新建任务</Button>
        </div>
        <div className='grid gap-4 lg:grid-cols-2'>
          {state.data?.document.tasks.map((task) => (
            <Card key={task.id}>
              <CardHeader>
                <div className='flex items-start justify-between gap-3'>
                  <div><CardTitle className='flex items-center gap-2'><CalendarClock />{task.name}</CardTitle><CardDescription>{scheduleLabel(task)} · {task.mode === 'draft' ? '生成后审核' : '自动保存'}</CardDescription></div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button size='icon' variant='ghost'><MoreHorizontal /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align='end'>
                      <DropdownMenuItem onSelect={() => setEditing(task)}><Edit />编辑任务</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => run.mutate(task.id)}><Play />立即运行</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant='destructive' onSelect={() => save.mutate((state.data?.document.tasks ?? []).filter((item) => item.id !== task.id))}><Trash2 />删除任务</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent className='flex items-center justify-between'>
                <div className='flex gap-2'><Badge variant='outline'>{cadenceLabel(task.cadence)}</Badge>{task.publishToFeishu && <Badge variant='secondary'>飞书</Badge>}</div>
                <div className='flex items-center gap-2'><span className='text-sm text-muted-foreground'>{task.enabled ? '已启用' : '已停用'}</span><Switch checked={task.enabled} disabled={save.isPending} onCheckedChange={(enabled) => save.mutate((state.data?.document.tasks ?? []).map((item) => item.id === task.id ? { ...item, enabled, updatedAt: new Date().toISOString() } : item))} /></div>
              </CardContent>
            </Card>
          ))}
        </div>
        {state.isLoading && <p className='flex items-center gap-2 text-muted-foreground'><Loader2 className='animate-spin' />正在读取任务…</p>}
        {state.data?.document.tasks.length === 0 && <Card className='border-dashed'><CardHeader className='items-center py-14 text-center'><CalendarClock className='size-8 text-muted-foreground' /><CardTitle>还没有报告任务</CardTitle><CardDescription>先配置 AI 服务，然后创建日报、周报或月报任务。</CardDescription></CardHeader></Card>}
      </Main>
      {editing !== undefined && <TaskDialog key={editing?.id ?? 'new'} task={editing} projects={projects.data?.projects ?? []} projectsLoading={projects.isLoading} open onOpenChange={(open) => !open && setEditing(undefined)} onSave={updateTask} />}
    </>
  )
}

function TaskDialog({ task, projects, projectsLoading, open, onOpenChange, onSave }: { task: ReportTask | null; projects: RepositoryProject[]; projectsLoading: boolean; open: boolean; onOpenChange(open: boolean): void; onSave(task: ReportTask): void }) {
  const [name, setName] = useState(task?.name ?? '')
  const [cadence, setCadence] = useState<ReportCadence>(task?.cadence ?? 'weekly')
  const [mode, setMode] = useState<ReportTaskMode>(task?.mode ?? 'draft')
  const [hour, setHour] = useState(task?.schedule.hour ?? 18)
  const [minute, setMinute] = useState(task?.schedule.minute ?? 0)
  const [includeWeekends, setIncludeWeekends] = useState(task?.schedule.includeWeekends ?? false)
  const [publish, setPublish] = useState(task?.publishToFeishu ?? false)
  const enabledProjects = projects.filter((project) => project.enabled)
  const [projectIds, setProjectIds] = useState<string[] | undefined>(
    task?.projectIds.length ? task.projectIds : undefined,
  )
  const selectedProjectIds = projectIds ?? enabledProjects.map((project) => project.id)
  const visibleProjects = projects.filter(
    (project) => project.enabled || selectedProjectIds.includes(project.id),
  )
  const disabledSelectedProjects = visibleProjects.filter((project) => !project.enabled)
  const hasRepositorySelection = selectedProjectIds.some((id) =>
    enabledProjects.some((project) => project.id === id),
  )

  function submit() {
    const now = new Date().toISOString()
    onSave({
      id: task?.id ?? crypto.randomUUID(),
      name: name.trim() || `${cadenceLabel(cadence)}任务`,
      cadence,
      enabled: task?.enabled ?? false,
      mode,
      publishToFeishu: publish,
      projectIds: selectedProjectIds,
      schedule: { hour, minute, includeWeekends },
      createdAt: task?.createdAt ?? now,
      updatedAt: now,
    })
  }

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{task ? '编辑任务' : '新建任务'}</DialogTitle><DialogDescription>应用会将任务添加到系统计划中，到达设定时间后自动执行。</DialogDescription></DialogHeader><div className='space-y-4'>
    <div className='space-y-2'><Label>任务名称</Label><Input value={name} onChange={(event) => setName(event.target.value)} placeholder={`${cadenceLabel(cadence)}任务`} /></div>
    <div className='grid gap-4 sm:grid-cols-2'><div className='space-y-2'><Label>报告周期</Label><Select value={cadence} onValueChange={(value) => setCadence(value as ReportCadence)}><SelectTrigger className='w-full'><SelectValue /></SelectTrigger><SelectContent><SelectItem value='daily'>日报</SelectItem><SelectItem value='weekly'>周报</SelectItem><SelectItem value='monthly'>月报</SelectItem></SelectContent></Select></div><div className='space-y-2'><Label>保存方式</Label><Select value={mode} onValueChange={(value) => setMode(value as ReportTaskMode)}><SelectTrigger className='w-full'><SelectValue /></SelectTrigger><SelectContent><SelectItem value='draft'>生成草稿，审核后保存</SelectItem><SelectItem value='autoPublish'>生成后自动保存</SelectItem></SelectContent></Select></div></div>
    <div className='grid gap-4 sm:grid-cols-2'><div className='space-y-2'><Label>小时</Label><Input type='number' min={0} max={23} value={hour} onChange={(event) => setHour(Number(event.target.value))} /></div><div className='space-y-2'><Label>分钟</Label><Input type='number' min={0} max={59} value={minute} onChange={(event) => setMinute(Number(event.target.value))} /></div></div>
    {cadence === 'daily' && <label className='flex items-center justify-between rounded-lg border p-3 text-sm'><span>周末也生成日报</span><Switch checked={includeWeekends} onCheckedChange={setIncludeWeekends} /></label>}
    <div className='space-y-2'>
      <div className='flex items-center justify-between'><Label>参与报告的仓库</Label><span className='text-xs text-muted-foreground'>已选 {selectedProjectIds.length} / {enabledProjects.length}</span></div>
      {projectsLoading ? <p className='text-sm text-muted-foreground'>正在读取启用的仓库…</p> : enabledProjects.length ? (
        <div className='max-h-36 space-y-1 overflow-y-auto rounded-md border p-2'>
          {visibleProjects.map((project) => <RepositoryCheckbox key={project.id} project={project} checked={selectedProjectIds.includes(project.id)} onCheckedChange={(checked) => setProjectIds((current) => {
            const selected = new Set(current ?? enabledProjects.map((item) => item.id))
            if (checked && project.enabled) selected.add(project.id)
            else selected.delete(project.id)
            return [...selected]
          })} />)}
        </div>
      ) : <p className='text-sm text-destructive'>没有已启用的仓库，请先到仓库设置中启用仓库。</p>}
      {disabledSelectedProjects.length ? <p className='text-xs text-amber-700'>已停用的仓库会在任务执行时跳过：{disabledSelectedProjects.map((project) => project.name).join('、')}</p> : null}
      {!projectsLoading && enabledProjects.length > 0 && !hasRepositorySelection ? <p className='text-xs text-destructive'>至少选择一个已启用的仓库。</p> : null}
    </div>
    <label className='flex items-center justify-between rounded-lg border p-3 text-sm'><span>保存后推送飞书</span><Switch checked={publish} onCheckedChange={setPublish} /></label>
  </div><DialogFooter><Button variant='outline' onClick={() => onOpenChange(false)}>取消</Button><Button onClick={submit} disabled={projectsLoading || !hasRepositorySelection}>保存任务</Button></DialogFooter></DialogContent></Dialog>
}

function RepositoryCheckbox({ project, checked, onCheckedChange }: { project: RepositoryProject; checked: boolean; onCheckedChange(checked: boolean): void }) {
  return <label className='flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted'>
    <Checkbox checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)} />
    <span className='truncate'>{project.name}{!project.enabled ? '（已停用）' : ''}</span>
    <span className='ms-auto truncate text-xs text-muted-foreground'>{project.branch}</span>
  </label>
}

function cadenceLabel(cadence: ReportCadence) { return cadence === 'daily' ? '日报' : cadence === 'weekly' ? '周报' : '月报' }
function scheduleLabel(task: ReportTask) {
  const time = `${String(task.schedule.hour).padStart(2, '0')}:${String(task.schedule.minute).padStart(2, '0')}`
  if (task.cadence === 'daily') return `${task.schedule.includeWeekends ? '每天' : '每个工作日'} ${time} · 生成当天`
  if (task.cadence === 'weekly') return `每周一 ${time} · 生成上一完整周`
  return `每月 1 日 ${time} · 生成上一完整月`
}
