/**
 * 任务中心存储管理
 * 统一管理预约、报名、订单等任务数据，使用 localStorage 持久化
 *
 * 设计约定：
 * - 任务记录是「我的报名/预约/订单」的唯一事实来源，页面状态一律从这里派生
 * - add() 按业务键幂等：同一课程/赛事/订单的有效记录只保留一条，防止重复报名
 * - 取消（remove）会释放占用的名额；学习进度按 courseId 隔离更新，不会串课
 * - taskState.version 在每次写入后自增，供 Vue 计算属性建立响应式依赖
 */

import { reactive } from 'vue'

const STORAGE_KEY = 'billiard_user_tasks'

/** 响应式版本号：读取任务的计算属性访问它后，任何写入都会触发重新计算 */
export const taskState = reactive({ version: 0 })

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

/** 终态：不再占用名额/不作为"进行中"的重复报名依据 */
function isInactiveStatus(status) {
  return status === 'completed' || status === 'cancelled'
}

/**
 * 任务业务键：同一业务对象的有效任务只允许一条。
 * 取消/完成后再次报名不会被拦截。
 */
function dedupKey(task) {
  const extra = task.extra || {}
  switch (task.type) {
    case 'course':
      return extra.courseId != null ? `course:${extra.courseId}` : null
    case 'competition':
      return extra.competitionId != null ? `competition:${extra.competitionId}` : null
    case 'order':
      return extra.orderNo ? `order:${extra.orderNo}` : null
    case 'booking':
      return extra.tableId != null && extra.date && extra.time
        ? `booking:${extra.tableId}:${extra.date}:${extra.time}`
        : null
    default:
      return null
  }
}

function loadTasks() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return getDefaultTasks()
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed) ? parsed : getDefaultTasks()
  } catch (e) {
    logger.error('加载任务失败', e)
    return getDefaultTasks()
  }
}

function saveTasks(tasks) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
    return true
  } catch (e) {
    logger.error('保存任务失败', e)
    return false
  }
}

function getDefaultTasks() {
  return [
    {
      id: 'T' + Date.now().toString() + '001',
      type: 'booking',
      title: '3号球桌 - 美式九球',
      subtitle: '2026-02-15 14:00 - 16:00',
      amount: 120,
      status: 'pending_payment',
      createdAt: formatDate(new Date(Date.now() - 86400000)),
      extra: { tableId: 3, date: '2026-02-15', time: '14:00 - 16:00' }
    },
    {
      id: 'T' + Date.now().toString() + '002',
      type: 'course',
      title: '台球入门基础课',
      subtitle: '报名成功，等待开课',
      amount: 599,
      status: 'upcoming',
      createdAt: formatDate(new Date(Date.now() - 259200000)),
      extra: { courseId: 1, coach: '张明', lessons: '8课时', progress: 0 }
    },
    {
      id: 'T' + Date.now().toString() + '003',
      type: 'competition',
      title: '周末九球挑战赛',
      subtitle: '比赛进行中',
      amount: 100,
      status: 'ongoing',
      createdAt: formatDate(new Date(Date.now() - 432000000)),
      extra: { competitionId: 2 }
    },
    {
      id: 'T' + Date.now().toString() + '004',
      type: 'order',
      title: 'LP专业斯诺克球杆',
      subtitle: '待发货',
      amount: 2999,
      status: 'pending_shipment',
      createdAt: formatDate(new Date(Date.now() - 172800000)),
      extra: { orderNo: 'SP' + Date.now().toString().slice(-8), productId: 1 }
    }
  ]
}

function formatDate(date) {
  const d = new Date(date)
  const pad = n => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function generateTaskId() {
  return 'T' + Date.now().toString() + Math.floor(Math.random() * 1000).toString().padStart(3, '0')
}

function enrichTask(task) {
  const typeInfo = taskTypeConfig[task.type]
  const statusInfo = statusConfig[task.status]
  const actions = typeInfo?.actions?.[task.status] || []

  return {
    ...task,
    extra: { ...(task.extra || {}) },
    typeName: typeInfo?.name || task.type,
    typeIcon: typeInfo?.icon || '📋',
    statusText: statusInfo?.text || task.status,
    statusType: statusInfo?.type || 'info',
    actions: actions.map(action => ({ ...action }))
  }
}

export const taskStore = {
  /** 供计算属性建立响应式依赖（刷新/跨页面同步） */
  version() {
    return taskState.version
  },

  getAll() {
    // 读取版本号：任何写入后派生列表自动刷新
    void taskState.version
    return loadTasks().map(enrichTask).sort((a, b) =>
      new Date(b.createdAt) - new Date(a.createdAt)
    )
  },

  getByStatus(status) {
    const tasks = this.getAll()
    if (status === 'pending') {
      return tasks.filter(t => !isInactiveStatus(t.status))
    }
    if (status === 'completed') {
      return tasks.filter(t => t.status === 'completed')
    }
    return tasks
  },

  getById(taskId) {
    void taskState.version
    const task = loadTasks().find(t => t.id === taskId)
    return task ? enrichTask(task) : null
  },

  /**
   * 新增任务（幂等）
   * 同一业务键已存在有效任务时直接返回原任务，不产生重复记录
   */
  add(taskData) {
    const tasks = loadTasks()
    const key = dedupKey(taskData)
    if (key) {
      const existing = tasks.find(t => dedupKey(t) === key && !isInactiveStatus(t.status))
      if (existing) {
        logger.info('任务已存在，忽略重复提交', existing.id)
        return enrichTask(existing)
      }
    }

    // id/createdAt 由存储层生成，不允许调用方覆盖，避免主键冲突造成重复渲染
    const newTask = {
      ...taskData,
      extra: { ...(taskData.extra || {}) },
      id: generateTaskId(),
      createdAt: formatDate(new Date())
    }
    tasks.unshift(newTask)
    saveTasks(tasks)
    taskState.version++
    logger.info('任务已添加', newTask)
    return enrichTask(newTask)
  },

  update(taskId, updates) {
    const tasks = loadTasks()
    const index = tasks.findIndex(t => t.id === taskId)
    if (index === -1) {
      logger.warn('任务不存在', taskId)
      return null
    }
    // id/createdAt/type 属于身份字段，禁止通过更新改写，防止记录串位
    const safeUpdates = { ...updates }
    delete safeUpdates.id
    delete safeUpdates.createdAt
    delete safeUpdates.type
    tasks[index] = {
      ...tasks[index],
      ...safeUpdates,
      extra: { ...(tasks[index].extra || {}), ...(safeUpdates.extra || {}) }
    }
    saveTasks(tasks)
    taskState.version++
    logger.info('任务已更新', taskId, updates)
    return enrichTask(tasks[index])
  },

  updateStatus(taskId, newStatus) {
    if (!statusConfig[newStatus]) {
      logger.error('无效的状态', newStatus)
      return null
    }
    return this.update(taskId, { status: newStatus })
  },

  /** 取消任务：物理删除并释放占用的名额 */
  remove(taskId) {
    const tasks = loadTasks()
    const filtered = tasks.filter(t => t.id !== taskId)
    if (filtered.length === tasks.length) {
      logger.warn('任务不存在，无法删除', taskId)
      return false
    }
    saveTasks(filtered)
    taskState.version++
    logger.info('任务已删除', taskId)
    return true
  },

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

  /**
   * 添加课程报名任务（幂等）
   * 完整快照课程信息，后续课程目录展示变化也不会篡改已报课程的价格与进度
   */
  addCourseTask(course, enrollInfo = {}) {
    return this.add({
      type: 'course',
      title: course.name,
      subtitle: enrollInfo.status === 'pending_payment' ? '待支付' : '报名成功，等待开课',
      amount: course.price,
      status: enrollInfo.status || 'upcoming',
      extra: {
        courseId: course.id,
        orderNo: enrollInfo.orderNo,
        courseIcon: course.icon,
        coach: course.coach,
        lessons: course.lessons,
        price: course.price,
        originalPrice: course.originalPrice || null,
        expireDate: enrollInfo.expireDate || null,
        progress: 0
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
      title: order.items.map(i => i.name).join('、'),
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

  markAsPaid(taskId) {
    const task = this.getById(taskId)
    if (!task) return null

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

  // ========== 课程报名派生状态（课程页唯一事实来源） ==========

  /** 返回某门课程当前有效的报名任务（待付款/待开始/进行中/已完成） */
  findCourseTask(courseId) {
    return this.getAll().find(
      t => t.type === 'course' && t.extra.courseId === courseId && !isInactiveStatus(t.status)
    ) || null
  },

  isCourseEnrolled(courseId) {
    return !!this.findCourseTask(courseId)
  },

  /** 当前用户对该课程的有效报名数（取消后会减少，用于名额占用） */
  countActiveCourseEnrollments(courseId) {
    return this.getAll().filter(
      t => t.type === 'course' && t.extra.courseId === courseId && !isInactiveStatus(t.status)
    ).length
  },

  getCourseEnrollments() {
    return this.getAll().filter(t => t.type === 'course' && !isInactiveStatus(t.status))
  },

  /**
   * 仅更新指定课程的学习进度（0-100），按 courseId 定位，
   * 找不到对应报名记录时拒绝写入，保证课程之间进度不串改
   */
  updateCourseProgress(courseId, progress) {
    const tasks = loadTasks()
    const index = tasks.findIndex(
      t => t.type === 'course' && t.extra && t.extra.courseId === courseId && !isInactiveStatus(t.status)
    )
    if (index === -1) {
      logger.warn('课程报名记录不存在，无法更新进度', courseId)
      return null
    }
    const clamped = Math.max(0, Math.min(100, Math.round(progress)))
    tasks[index].extra = { ...(tasks[index].extra || {}), progress: clamped }
    saveTasks(tasks)
    taskState.version++
    logger.info('课程进度已更新', { courseId, progress: clamped })
    return enrichTask(tasks[index])
  },

  getPendingCount() {
    return this.getByStatus('pending').length
  },

  getCompletedCount() {
    return this.getByStatus('completed').length
  },

  clearAll() {
    saveTasks([])
    taskState.version++
    logger.info('所有任务已清除')
  }
}

export default taskStore
