/**
 * 任务中心存储管理
 * 统一管理预约、报名、订单等任务数据，使用 localStorage 持久化
 *
 * 设计原则：
 * - 单一数据源：所有任务的增删改都经过本模块，业务页面只读取派生状态
 * - 响应式：state 为 reactive，视图计算属性依赖 version 自动刷新
 * - 幂等：支付/取消重复执行不会产生重复或错位记录
 * - 快照隔离：任务保存的是报名/下单时刻的业务数据快照，不与目录数据互相修改
 */

import { reactive } from 'vue'

const STORAGE_KEY = 'billiard_user_tasks'
const PROGRESS_KEY = 'billiard_course_progress'

const logger = {
  info: (...args) => console.log('[taskStore]', ...args),
  warn: (...args) => console.warn('[taskStore]', ...args),
  error: (...args) => console.error('[taskStore]', ...args)
}

const taskTypeConfig = {
  booking: {
    name: '球桌预约',
    icon: '🎱',
    actions: {
      pending_payment: [
        { key: 'pay', label: '继续付款', type: 'primary', route: '/tables' },
        { key: 'cancel', label: '取消', type: 'danger' }
      ],
      upcoming: [
        { key: 'view', label: '查看详情', type: 'primary' },
        { key: 'rebook', label: '再次预约', type: 'default', route: '/tables' }
      ],
      ongoing: [
        { key: 'view', label: '查看详情', type: 'primary' }
      ],
      completed: [
        { key: 'view', label: '查看结果', type: 'default' },
        { key: 'rebook', label: '再次预约', type: 'primary', route: '/tables' }
      ]
    }
  },
  course: {
    name: '课程报名',
    icon: '📚',
    actions: {
      pending_payment: [
        { key: 'pay', label: '继续付款', type: 'primary', route: '/courses' },
        { key: 'cancel', label: '取消', type: 'danger' }
      ],
      upcoming: [
        { key: 'view', label: '查看详情', type: 'primary', route: '/courses' }
      ],
      ongoing: [
        { key: 'view', label: '继续学习', type: 'primary', route: '/courses' }
      ],
      completed: [
        { key: 'view', label: '查看结果', type: 'default' },
        { key: 'review', label: '评价', type: 'primary' }
      ]
    }
  },
  competition: {
    name: '赛事报名',
    icon: '🏆',
    actions: {
      pending_payment: [
        { key: 'pay', label: '继续付款', type: 'primary', route: '/competitions' },
        { key: 'cancel', label: '取消', type: 'danger' }
      ],
      upcoming: [
        { key: 'view', label: '查看赛程', type: 'primary', route: '/competitions' }
      ],
      ongoing: [
        { key: 'view', label: '观看直播', type: 'primary', route: '/competitions' }
      ],
      completed: [
        { key: 'view', label: '查看结果', type: 'default', route: '/competitions' }
      ]
    }
  },
  order: {
    name: '商城订单',
    icon: '🛒',
    actions: {
      pending_payment: [
        { key: 'pay', label: '继续付款', type: 'primary', route: '/shop' },
        { key: 'cancel', label: '取消', type: 'danger' }
      ],
      pending_shipment: [
        { key: 'view', label: '查看订单', type: 'primary', route: '/shop' },
        { key: 'remind', label: '提醒发货', type: 'default' }
      ],
      shipped: [
        { key: 'view', label: '查看物流', type: 'primary', route: '/shop' },
        { key: 'confirm', label: '确认收货', type: 'primary' }
      ],
      completed: [
        { key: 'view', label: '查看结果', type: 'default', route: '/shop' },
        { key: 'review', label: '评价', type: 'primary' },
        { key: 'rebuy', label: '再次购买', type: 'default', route: '/shop' }
      ]
    }
  }
}

const statusConfig = {
  pending_payment: { text: '待付款', type: 'warning' },
  upcoming: { text: '待开始', type: 'info' },
  ongoing: { text: '进行中', type: 'primary' },
  pending_shipment: { text: '待发货', type: 'warning' },
  shipped: { text: '已发货', type: 'info' },
  completed: { text: '已完成', type: 'success' },
  cancelled: { text: '已取消', type: 'success' }
}

/** 进行中的状态：占用名额、不允许重复报名 */
const ACTIVE_STATUSES = ['pending_payment', 'upcoming', 'ongoing', 'pending_shipment', 'shipped']
const VALID_TYPES = Object.keys(taskTypeConfig)

// ==================== 持久化 ====================

function isValidTask(task) {
  return task && typeof task === 'object' && typeof task.id === 'string' &&
    VALID_TYPES.includes(task.type) && !!statusConfig[task.status]
}

function loadTasks() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return getDefaultTasks()
    const parsed = JSON.parse(stored)
    if (!Array.isArray(parsed)) {
      logger.warn('任务数据格式错误，已重置为默认数据')
      return getDefaultTasks()
    }
    const valid = parsed.filter(isValidTask)
    if (valid.length !== parsed.length) {
      logger.warn(`已过滤 ${parsed.length - valid.length} 条无效任务记录`)
    }
    // 去重：同 id 只保留最新一条，防止重复显示
    const seen = new Set()
    return valid.filter(task => {
      if (seen.has(task.id)) return false
      seen.add(task.id)
      return true
    })
  } catch (e) {
    logger.error('加载任务失败', e)
    return getDefaultTasks()
  }
}

function loadProgress() {
  try {
    const stored = localStorage.getItem(PROGRESS_KEY)
    if (!stored) return { 1: 30 } // 演示数据：默认课程已有 30% 学习进度
    const parsed = JSON.parse(stored)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (e) {
    logger.error('加载学习进度失败', e)
    return {}
  }
}

function saveTasks() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks))
    return true
  } catch (e) {
    logger.error('保存任务失败', e)
    return false
  }
}

function saveProgress() {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progressState))
    return true
  } catch (e) {
    logger.error('保存学习进度失败', e)
    return false
  }
}

function getDefaultTasks() {
  const now = Date.now()
  return [
    {
      id: 'T-DEFAULT-001',
      type: 'booking',
      title: '3号球桌 - 美式九球',
      subtitle: '2026-02-15 14:00 - 16:00',
      amount: 120,
      status: 'pending_payment',
      createdAt: formatDate(new Date(now - 86400000)),
      extra: { tableId: 3, date: '2026-02-15', time: '14:00 - 16:00', duration: 2 }
    },
    {
      id: 'T-DEFAULT-002',
      type: 'course',
      title: '台球入门基础课',
      subtitle: '报名成功，等待开课',
      amount: 599,
      status: 'upcoming',
      createdAt: formatDate(new Date(now - 259200000)),
      extra: { courseId: 1, orderNo: 'CRDEFAULT02', coach: '张明', lessons: '8课时', icon: '🎯' }
    },
    {
      id: 'T-DEFAULT-003',
      type: 'competition',
      title: '周末九球挑战赛',
      subtitle: '比赛进行中',
      amount: 100,
      status: 'ongoing',
      createdAt: formatDate(new Date(now - 432000000)),
      extra: { competitionId: 2, regNo: 'REGDEFAULT03', playerNo: 7, date: '2026-02-14' }
    },
    {
      id: 'T-DEFAULT-004',
      type: 'order',
      title: 'LP专业斯诺克球杆',
      subtitle: '待发货',
      amount: 2999,
      status: 'pending_shipment',
      createdAt: formatDate(new Date(now - 172800000)),
      extra: {
        orderNo: 'SPDEFAULT04',
        items: [{ id: 1, name: 'LP专业斯诺克球杆', icon: '🏏', qty: 1 }],
        createTime: formatDate(new Date(now - 172800000))
      }
    }
  ]
}

function formatDate(date) {
  const d = new Date(date)
  const pad = n => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

let idSeq = 0
function generateTaskId() {
  idSeq += 1
  return 'T' + Date.now().toString(36) + idSeq.toString(36) + Math.floor(Math.random() * 1e4).toString(36)
}

/**
 * 附加展示字段。每次返回全新对象/数组，
 * 避免调用方修改 actions 时污染共享配置或其它任务。
 */
function enrichTask(task) {
  const typeInfo = taskTypeConfig[task.type]
  const statusInfo = statusConfig[task.status]
  const sourceActions = typeInfo?.actions?.[task.status] || []

  return {
    ...task,
    extra: task.extra ? JSON.parse(JSON.stringify(task.extra)) : {},
    typeName: typeInfo?.name || task.type,
    typeIcon: typeInfo?.icon || '📋',
    statusText: statusInfo?.text || task.status,
    statusType: statusInfo?.type || 'info',
    actions: sourceActions.map(a => ({ ...a }))
  }
}

// ==================== 响应式状态（单一数据源） ====================

const state = reactive({
  tasks: loadTasks(),
  version: 0
})

const progressState = reactive(loadProgress())

function bumpVersion() {
  state.version++
}

export const taskStore = {
  /** 响应式版本号，计算属性中读取后，任意增删改都会触发重新计算 */
  get version() {
    return state.version
  },

  getAll() {
    // 依赖 version 与 tasks，保证视图在任务变化后自动刷新
    void state.version
    return state.tasks.map(enrichTask).sort((a, b) =>
      new Date(b.createdAt) - new Date(a.createdAt)
    )
  },

  getByStatus(status) {
    const tasks = this.getAll()
    if (status === 'pending') {
      return tasks.filter(t => t.status !== 'completed' && t.status !== 'cancelled')
    }
    if (status === 'completed') {
      return tasks.filter(t => t.status === 'completed')
    }
    return tasks
  },

  getById(taskId) {
    void state.version
    const task = state.tasks.find(t => t.id === taskId)
    return task ? enrichTask(task) : null
  },

  /**
   * 新增任务。
   * id/createdAt 由存储统一生成，调用方无法覆盖，避免记录错位。
   */
  add(taskData) {
    const newTask = {
      ...taskData,
      id: generateTaskId(),
      createdAt: formatDate(new Date())
    }
    state.tasks.unshift(newTask)
    saveTasks()
    bumpVersion()
    logger.info('任务已添加', newTask)
    return enrichTask(newTask)
  },

  update(taskId, updates) {
    const index = state.tasks.findIndex(t => t.id === taskId)
    if (index === -1) {
      logger.warn('任务不存在', taskId)
      return null
    }
    // 不允许通过 update 篡改 id / 创建时间 / 类型 / 关联业务
    const safeUpdates = { ...(updates || {}) }
    delete safeUpdates.id
    delete safeUpdates.createdAt
    delete safeUpdates.type
    state.tasks[index] = { ...state.tasks[index], ...safeUpdates }
    saveTasks()
    bumpVersion()
    logger.info('任务已更新', taskId, safeUpdates)
    return enrichTask(state.tasks[index])
  },

  updateStatus(taskId, newStatus) {
    if (!statusConfig[newStatus]) {
      logger.error('无效的状态', newStatus)
      return null
    }
    return this.update(taskId, { status: newStatus })
  },

  remove(taskId) {
    const index = state.tasks.findIndex(t => t.id === taskId)
    if (index === -1) {
      logger.warn('任务不存在，无法删除', taskId)
      return false
    }
    state.tasks.splice(index, 1)
    saveTasks()
    bumpVersion()
    logger.info('任务已删除', taskId)
    return true
  },

  // ========== 业务关联查询（用于重复报名/名额判断） ==========

  /**
   * 查找某类业务的进行中任务。
   * 已完成/已取消的记录不占用名额，允许重新报名。
   */
  findActive(type, matcher) {
    void state.version
    return state.tasks.find(t =>
      t.type === type &&
      ACTIVE_STATUSES.includes(t.status) &&
      (!matcher || matcher(t))
    ) || null
  },

  findActiveCourse(courseId) {
    const id = Number(courseId)
    return this.findActive('course', t => Number(t.extra?.courseId) === id)
  },

  findActiveCompetition(competitionId) {
    const id = Number(competitionId)
    return this.findActive('competition', t => Number(t.extra?.competitionId) === id)
  },

  findActiveBooking(tableId, date, time) {
    const id = Number(tableId)
    return this.findActive('booking', t =>
      Number(t.extra?.tableId) === id && t.extra?.date === date && t.extra?.time === time
    )
  },

  countActive(type, matcher) {
    void state.version
    return state.tasks.filter(t =>
      t.type === type &&
      ACTIVE_STATUSES.includes(t.status) &&
      (!matcher || matcher(t))
    ).length
  },

  // ========== 业务任务工厂（保存下单时刻快照） ==========

  addBookingTask(table, bookingInfo) {
    return this.add({
      type: 'booking',
      title: `${table.name} - ${table.type}`,
      subtitle: `${bookingInfo.date} ${bookingInfo.time}`,
      amount: table.price * bookingInfo.duration,
      status: 'pending_payment',
      extra: {
        tableId: table.id,
        date: bookingInfo.date,
        time: bookingInfo.time,
        duration: bookingInfo.duration,
        orderNo: bookingInfo.orderNo
      }
    })
  },

  addCourseTask(course, enrollInfo) {
    return this.add({
      type: 'course',
      title: course.name,
      subtitle: '报名成功，等待开课',
      amount: course.price,
      status: enrollInfo.status || 'upcoming',
      extra: {
        courseId: course.id,
        orderNo: enrollInfo.orderNo,
        coach: course.coach,
        lessons: course.lessons,
        icon: course.icon
      }
    })
  },

  addCompetitionTask(competition, regInfo) {
    return this.add({
      type: 'competition',
      title: competition.name,
      subtitle: competition.status === 'upcoming' ? '等待比赛开始' : '比赛进行中',
      amount: competition.fee,
      status: competition.status === 'upcoming' ? 'upcoming' : 'ongoing',
      extra: {
        competitionId: competition.id,
        regNo: regInfo.regNo,
        playerNo: regInfo.playerNo,
        date: competition.date
      }
    })
  },

  addOrderTask(order) {
    return this.add({
      type: 'order',
      title: (order.items || []).map(i => i.name).join('、'),
      subtitle: '已下单，待发货',
      amount: order.amount,
      status: 'pending_shipment',
      extra: {
        orderNo: order.orderNo,
        items: order.items,
        createTime: order.createTime
      }
    })
  },

  /**
   * 支付：仅待付款任务可支付；重复支付直接返回当前任务（幂等）。
   */
  markAsPaid(taskId) {
    const task = this.getById(taskId)
    if (!task) return null

    // 已支付过：幂等返回，不改变任何状态
    if (task.status !== 'pending_payment') {
      logger.info('任务无需重复支付', taskId)
      return task
    }

    let newStatus = 'upcoming'
    let newSubtitle = '支付成功'

    if (task.type === 'order') {
      newStatus = 'pending_shipment'
      newSubtitle = '支付成功，待发货'
    } else if (task.type === 'course') {
      newSubtitle = '支付成功，等待开课'
    } else if (task.type === 'booking') {
      newSubtitle = '支付成功，等待使用'
    }

    return this.update(taskId, { status: newStatus, subtitle: newSubtitle })
  },

  // ========== 学习进度（独立存储，不随报名/刷新被重置或串改） ==========

  getCourseProgress(courseId) {
    const value = Number(progressState[courseId])
    return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0
  },

  setCourseProgress(courseId, progress) {
    const value = Math.min(100, Math.max(0, Math.round(Number(progress) || 0)))
    progressState[courseId] = value
    saveProgress()
    return value
  },

  getAllCourseProgress() {
    return Object.fromEntries(
      Object.entries(progressState).map(([id, p]) => [id, Math.min(100, Math.max(0, Number(p) || 0))])
    )
  },

  getPendingCount() {
    return this.getByStatus('pending').length
  },

  getCompletedCount() {
    return this.getByStatus('completed').length
  },

  clearAll() {
    state.tasks.splice(0, state.tasks.length)
    saveTasks()
    bumpVersion()
    logger.info('所有任务已清除')
  },

  /** 仅供测试：恢复默认任务 */
  __reset() {
    state.tasks.splice(0, state.tasks.length, ...getDefaultTasks())
    Object.keys(progressState).forEach(k => delete progressState[k])
    Object.assign(progressState, { 1: 30 })
    saveTasks()
    saveProgress()
    bumpVersion()
  },

  /** 仅供测试：从 localStorage 重新加载（模拟刷新页面） */
  __reload() {
    state.tasks.splice(0, state.tasks.length, ...loadTasks())
    Object.keys(progressState).forEach(k => delete progressState[k])
    Object.assign(progressState, loadProgress())
    bumpVersion()
  }
}

export default taskStore
