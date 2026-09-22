/**
 * API 接口层
 *
 * 功能说明：
 * - 封装所有后端API请求
 * - 支持模拟数据模式和真实API模式
 * - 提供统一的错误处理、请求中止、重复提交防护和登录失效处理
 *
 * 使用方式：
 * import { api, logger, isAbortError } from '@/utils/api'
 * const result = await api.enrollCourse({ courseId: 1 }, { signal })
 *
 * 切换模式：
 * - 设置 VITE_USE_MOCK=true 使用模拟数据
 * - 设置 VITE_USE_MOCK=false 调用真实API
 */

// API基础地址，从环境变量读取
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

// 日志级别配置
const LOG_LEVEL = import.meta.env.VITE_LOG_LEVEL || (import.meta.env.MODE === 'test' ? 'error' : 'info')
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }

// 任务存储（用于任务中心数据持久化）
import { taskStore as ts } from './taskStore'
const taskStore = ts

/**
 * 模拟网络延迟
 * @param {number} ms - 延迟毫秒数
 * @returns {Promise} 延迟Promise
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * 日志记录器
 */
export const logger = {
  shouldLog(level) {
    return LOG_LEVELS[level] >= LOG_LEVELS[LOG_LEVEL]
  },

  format(level, message) {
    return `[${level.toUpperCase()}] ${new Date().toISOString()} - ${message}`
  },

  debug(message, data) {
    if (this.shouldLog('debug')) {
      console.debug(this.format('debug', message), data || '')
    }
  },

  info(message, data) {
    if (this.shouldLog('info')) {
      console.log(this.format('info', message), data || '')
    }
  },

  warn(message, data) {
    if (this.shouldLog('warn')) {
      console.warn(this.format('warn', message), data || '')
    }
  },

  error(message, error) {
    if (this.shouldLog('error')) {
      console.error(this.format('error', message), error || '')
    }
  }
}

// ==================== 业务错误定义 ====================

/** 业务错误码 */
export const ErrorCodes = {
  AUTH_EXPIRED: 'AUTH_EXPIRED',
  DUPLICATE: 'DUPLICATE',
  FULL: 'FULL',
  NOT_FOUND: 'NOT_FOUND',
  ABORTED: 'ABORTED',
  NETWORK: 'NETWORK'
}

/**
 * 业务异常：携带 code，便于调用方区分“重复报名/满员/登录失效”等场景
 */
export class ApiError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

/** 判断请求结果是否为指定错误 */
export function isError(result, code) {
  return !!result && result.success === false && result.code === code
}

/** 判断失败是否由主动中止引起（页面离开/关闭弹框后不应提示错误） */
export function isAbortError(result) {
  return isError(result, ErrorCodes.ABORTED)
}

// ==================== 登录失效处理 ====================

let authExpiredHandler = null

/**
 * 注册登录失效回调（由 auth 模块注册）。
 * 任何请求返回 401 / AUTH_EXPIRED 时触发，统一清除本地登录态。
 */
export function setAuthExpiredHandler(handler) {
  authExpiredHandler = handler
}

function notifyAuthExpired() {
  logger.warn('登录态已失效')
  if (typeof authExpiredHandler === 'function') {
    authExpiredHandler()
  }
}

function getToken() {
  try {
    return localStorage.getItem('billiard_token') || ''
  } catch {
    return ''
  }
}

/** 仅供测试：使当前登录态立即失效（下一次受保护请求将返回 AUTH_EXPIRED） */
export function __expireMockToken() {
  const token = getToken()
  if (token) localStorage.setItem('billiard_token', token + ':expired')
}

// ==================== 重复提交防护 ====================

/** 进行中的写请求：相同端点 + 相同请求体只允许一个，防止双击重复提交 */
const pendingMutations = new Map()

function mutationKey(url, options) {
  return `${options.method || 'POST'} ${url} :: ${options.body || ''}`
}

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

/**
 * 统一请求封装
 *
 * @param {string} url - 请求路径（不含基础URL）
 * @param {Object} options - 请求配置
 * @param {string} options.method - 请求方法 GET/POST/PUT/DELETE
 * @param {Object} options.body - 请求体（会自动JSON序列化）
 * @param {Object} options.headers - 额外的请求头
 * @param {Object} options.params - URL查询参数
 * @param {AbortSignal} options.signal - 中止信号（离开页面/关闭弹框时中止）
 * @returns {Promise<{success: boolean, data?: any, error?: string, code?: string, aborted?: boolean}>}
 */
async function request(url, options = {}) {
  const method = options.method || 'GET'
  const fullUrl = `${API_BASE_URL}${url}`
  const key = mutationKey(url, options)
  const isMutation = method !== 'GET'

  // 已被主动中止的请求不再发起
  if (options.signal?.aborted) {
    return { success: false, error: '请求已取消', code: ErrorCodes.ABORTED, aborted: true }
  }

  // 重复写请求直接复用进行中的 Promise
  if (isMutation && pendingMutations.has(key)) {
    logger.warn('忽略重复提交，复用进行中的请求', { url })
    return pendingMutations.get(key)
  }

  const promise = doRequest(url, options)
  if (isMutation) {
    pendingMutations.set(key, promise)
    promise.finally(() => pendingMutations.delete(key))
  }
  return promise
}

async function doRequest(url, options) {
  const method = options.method || 'GET'
  logger.info(`API Request: ${method} ${API_BASE_URL}${url}`)

  try {
    // 模拟模式：使用前端模拟数据
    if (import.meta.env.VITE_USE_MOCK !== 'false') {
      logger.debug('Using mock data mode')
      const data = await mockRequest(url, options)
      logger.info(`API Response: ${url}`, { status: 'success' })
      // 出参深拷贝，避免调用方修改污染模拟数据源
      return { success: true, data: deepClone(data) }
    }

    // 真实API调用
    const response = await fetch(`${API_BASE_URL}${url}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getToken()}`,
        ...options.headers
      },
      body: options.body,
      signal: options.signal
    })

    // 登录失效：统一通知 auth 模块清除状态
    if (response.status === 401) {
      notifyAuthExpired()
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        code: ErrorCodes.AUTH_EXPIRED,
        error: errorData.error || '登录已失效，请重新登录'
      }
    }

    // 检查HTTP状态码
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        code: errorData.code || ErrorCodes.NETWORK,
        error: errorData.error || `HTTP ${response.status}: ${response.statusText}`
      }
    }

    const data = await response.json()
    logger.info(`API Response: ${url}`, { status: 'success' })
    return { success: true, data }
  } catch (error) {
    // 主动中止：交由调用方静默处理
    if (error?.name === 'AbortError' || options.signal?.aborted) {
      logger.info(`API Aborted: ${url}`)
      return { success: false, error: '请求已取消', code: ErrorCodes.ABORTED, aborted: true }
    }
    logger.error(`API Error: ${url}`, error)
    // mock 处理器抛出的业务错误（重复报名/满员/未登录等）保留其错误码
    if (error instanceof ApiError) {
      // 未登录类错误同时触发登录失效清理
      if (error.code === ErrorCodes.AUTH_EXPIRED) notifyAuthExpired()
      return { success: false, code: error.code, error: error.message }
    }
    return {
      success: false,
      code: ErrorCodes.NETWORK,
      error: error.message || '网络请求失败，请稍后重试'
    }
  }
}

// ==================== 模拟数据定义 ====================

const mockData = {
  // 用户信息
  user: {
    id: 'U20260001',
    name: '张三',
    level: '黄金',
    points: 2580,
    totalHours: 156,
    competitions: 12,
    wins: 8,
    courses: 3,
    phone: '138****8888',
    email: 'zhang***@email.com'
  },

  // 球桌列表
  tables: [
    { id: 1, name: '1号球桌', type: '斯诺克', typeId: 'snooker', price: 80, available: true, size: '12尺', brand: '星牌' },
    { id: 2, name: '2号球桌', type: '斯诺克', typeId: 'snooker', price: 80, available: false, size: '12尺', brand: '星牌' },
    { id: 3, name: '3号球桌', type: '美式九球', typeId: 'pool', price: 60, available: true, size: '9尺', brand: 'Brunswick' },
    { id: 4, name: '4号球桌', type: '美式九球', typeId: 'pool', price: 60, available: true, size: '9尺', brand: 'Brunswick' },
    { id: 5, name: '5号球桌', type: '中式八球', typeId: 'chinese', price: 50, available: false, size: '9尺', brand: '乔氏' },
    { id: 6, name: '6号球桌', type: '中式八球', typeId: 'chinese', price: 50, available: true, size: '9尺', brand: '乔氏' }
  ],

  // 课程列表（maxStudents 为名额上限，与 Courses 视图目录保持一致）
  courses: [
    {
      id: 1, name: '台球入门基础课', icon: '🎯', level: '入门', duration: '4周', lessons: '8课时',
      students: 156, maxStudents: 200, price: 599, originalPrice: 799,
      description: '从零开始学习台球，掌握基本姿势、握杆方法和击球技巧，适合完全没有基础的新手',
      coach: '张明', coachTitle: '高级教练',
      coachBio: '10年教学经验，培养学员超过500人，擅长基础教学和纠正动作',
      gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      outline: ['台球基础知识介绍', '正确的站姿与握杆', '基本击球动作练习', '直线球练习', '简单角度球', '基础走位概念', '实战练习', '结业考核']
    },
    {
      id: 2, name: '斯诺克进阶训练', icon: '🎱', level: '进阶', duration: '6周', lessons: '12课时',
      students: 89, maxStudents: 100, price: 1299, originalPrice: 1599,
      description: '深入学习斯诺克战术布局，提升走位和防守能力，掌握高级杆法技巧',
      coach: '李强', coachTitle: '国家级教练',
      coachBio: '前省队选手，15年执教经验，多次带队获得全国比赛冠军',
      gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      outline: ['斯诺克规则深度解析', '高级杆法：低杆与高杆', '塞球技术详解', '走位规划与执行', '防守策略', '清台技巧', '比赛心态调整', '模拟比赛训练']
    },
    {
      id: 3, name: '九球高级技巧', icon: '🏆', level: '高级', duration: '8周', lessons: '16课时',
      students: 45, maxStudents: 45, price: 1999, originalPrice: 2499,
      description: '掌握高级杆法、塞球技术和复杂局面处理，提升比赛实战能力',
      coach: '王磊', coachTitle: '职业选手',
      coachBio: '现役职业选手，全国九球锦标赛前八，擅长实战技巧教学',
      gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
      outline: ['九球比赛规则与策略', '开球技巧优化', '组合球与翻袋', '高级塞球应用', '困难球处理', '安全球战术', '关键球心理', '实战对抗训练']
    },
    {
      id: 4, name: '比赛心理训练', icon: '🧠', level: '专业', duration: '3周', lessons: '6课时',
      students: 30, maxStudents: 32, price: 999,
      description: '提升比赛心理素质，学习压力管理和专注力训练，突破瓶颈期',
      coach: '赵芳', coachTitle: '运动心理师',
      coachBio: '国家认证运动心理咨询师，服务多支省级运动队',
      gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
      outline: ['运动心理学基础', '压力与焦虑管理', '专注力训练方法', '比赛前心理准备', '失误后的心态调整', '建立自信心']
    }
  ],

  // 赛事列表（maxParticipants 为名额上限）
  competitions: [
    { id: 1, name: '2026春季斯诺克公开赛', type: '斯诺克', date: '2026-03-15', location: '主馆A区', prize: 50000, fee: 200, participants: 28, maxParticipants: 32, status: 'upcoming' },
    { id: 2, name: '周末九球挑战赛', type: '美式九球', date: '2026-02-14', location: '主馆B区', prize: 10000, fee: 100, participants: 16, maxParticipants: 16, status: 'ongoing' },
    { id: 3, name: '新年中式八球锦标赛', type: '中式八球', date: '2026-01-20', location: '主馆A区', prize: 30000, fee: 150, participants: 64, maxParticipants: 64, status: 'finished' },
    { id: 4, name: '会员积分争霸赛', type: '综合', date: '2026-04-01', location: '主馆C区', prize: 20000, fee: 50, participants: 12, maxParticipants: 48, status: 'upcoming' },
    { id: 5, name: '女子台球精英赛', type: '美式九球', date: '2026-03-08', location: '主馆B区', prize: 15000, fee: 80, participants: 8, maxParticipants: 16, status: 'upcoming' }
  ],

  // 商品列表
  products: [
    { id: 1, name: 'LP专业斯诺克球杆', brand: 'LP', price: 2999, originalPrice: 3599, category: 'cue', icon: '🏏', description: '进口白蜡木杆身，专业级配置', sales: 328, hot: true },
    { id: 2, name: 'Predator美式九球杆', brand: 'Predator', price: 4599, category: 'cue', icon: '🏏', description: '碳纤维前节，低偏转技术', sales: 156, new: true },
    { id: 3, name: '星牌比赛用球', brand: '星牌', price: 1299, originalPrice: 1499, category: 'ball', icon: '🎱', description: '国际比赛标准，酚醛树脂材质', sales: 892, hot: true },
    { id: 4, name: 'Aramith水晶球套装', brand: 'Aramith', price: 2199, category: 'ball', icon: '🎱', description: '比利时进口，透明水晶材质', sales: 234 },
    { id: 5, name: 'Master专业巧克粉', brand: 'Master', price: 39, category: 'accessory', icon: '🧊', description: '美国原装进口，防滑效果好', sales: 2341, hot: true },
    { id: 6, name: '球杆延长器', brand: 'Generic', price: 199, originalPrice: 259, category: 'accessory', icon: '🔧', description: '铝合金材质，轻便耐用', sales: 567 },
    { id: 7, name: 'Kamui台球手套', brand: 'Kamui', price: 89, category: 'accessory', icon: '🧤', description: '日本进口，透气舒适', sales: 1234 },
    { id: 8, name: '专业比赛马甲', brand: 'Billiard Pro', price: 299, category: 'clothing', icon: '🎽', description: '修身剪裁，舒适透气', sales: 445, new: true }
  ],

  // 预约记录（初始演示数据）
  bookings: [
    { id: 1, orderNo: 'BK20260001', tableName: '3号球桌 - 美式九球', date: '2026-02-15', time: '14:00 - 16:00', status: 'upcoming' },
    { id: 2, orderNo: 'BK20260002', tableName: '1号球桌 - 斯诺克', date: '2026-02-10', time: '19:00 - 21:00', status: 'completed' }
  ]
}

// ==================== 模拟请求处理器 ====================

function parseBody(options) {
  try {
    return JSON.parse(options.body || '{}')
  } catch {
    return {}
  }
}

/** 模拟登录态校验：未登录或 token 已失效抛出 AUTH_EXPIRED */
function requireAuth() {
  const token = getToken()
  if (!token) throw new ApiError('请先登录', ErrorCodes.AUTH_EXPIRED)
  if (token.endsWith(':expired')) throw new ApiError('登录已失效，请重新登录', ErrorCodes.AUTH_EXPIRED)
}

function findCourse(courseId) {
  const id = Number(courseId)
  return mockData.courses.find(c => c.id === id) || null
}

function findCompetition(compId) {
  const id = Number(compId)
  return mockData.competitions.find(c => c.id === id) || null
}

function findTable(tableId) {
  const id = Number(tableId)
  return mockData.tables.find(t => t.id === id) || null
}

/** 课程当前有效报名人数：目录基线人数 + 当前用户进行中的课程任务（入参可为课程对象或 id） */
function courseEnrolledCount(courseOrId) {
  const id = Number(courseOrId && typeof courseOrId === 'object' ? courseOrId.id : courseOrId)
  const course = findCourse(id)
  const base = course ? course.students : 0
  return base + taskStore.countActive('course', t => Number(t.extra?.courseId) === id)
}

/** 赛事当前报名人数：目录基线人数 + 当前用户进行中的赛事任务 */
function competitionEnrolledCount(comp) {
  const id = Number(comp.id)
  return comp.participants +
    taskStore.countActive('competition', t => Number(t.extra?.competitionId) === id)
}

/**
 * 处理登录请求
 */
function handleLogin(options) {
  const { username, password } = parseBody(options)

  if (username === 'user' && password === '123456') {
    const token = 'mock_token_' + Date.now()
    logger.info('Mock login successful', { username })
    return { token, user: mockData.user }
  }

  logger.warn('Mock login failed', { username })
  throw new Error('用户名或密码错误')
}

function handleLogout() {
  logger.info('Mock logout')
  return { message: '退出成功' }
}

/** GET: 球桌列表（支持按类型过滤；模拟数据不被调用方修改） */
function handleGetTables(options) {
  let tables = mockData.tables
  const typeId = options.params?.type
  if (typeId && typeId !== 'all') {
    tables = tables.filter(t => t.typeId === typeId)
  }
  return deepClone(tables)
}

/**
 * 预约球桌：
 * - 需要登录
 * - 同球桌同时段存在进行中预约时拒绝（防止重复提交/重复预约）
 */
function handleBookings(options) {
  if (options.method === 'POST') {
    requireAuth()
    const body = parseBody(options)
    const table = findTable(body.tableId)
    if (!table) throw new ApiError('球桌不存在', ErrorCodes.NOT_FOUND)

    const time = body.timeSlot || body.time
    if (body.date && time) {
      const duplicate = taskStore.findActiveBooking(table.id, body.date, time)
      if (duplicate) {
        throw new ApiError('该时段已预约，请勿重复提交', ErrorCodes.DUPLICATE)
      }
    }

    const orderNo = 'BK' + Date.now().toString().slice(-8)
    const bookingInfo = {
      orderNo,
      date: body.date,
      time,
      duration: body.duration ?? 2
    }
    const task = taskStore.addBookingTask(table, bookingInfo)
    logger.info('Mock booking created', { orderNo, taskId: task.id })
    // status 保持 upcoming 以兼容既有接口测试，同时返回 taskId 供任务中心跟踪
    return {
      orderNo,
      taskId: task.id,
      tableId: table.id,
      tableName: `${table.name} - ${table.type}`,
      date: bookingInfo.date,
      time: bookingInfo.time,
      status: 'upcoming'
    }
  }
  return deepClone(mockData.bookings)
}

/**
 * 课程报名：
 * - 需要登录
 * - 已报名（进行中）拒绝重复报名
 * - 名额已满拒绝报名
 * - 课程价格/信息以服务端目录为准（快照），前端无法篡改
 */
function handleCourseEnroll(options) {
  requireAuth()
  const body = parseBody(options)
  const course = findCourse(body.courseId)
  if (!course) throw new ApiError('课程不存在', ErrorCodes.NOT_FOUND)

  if (taskStore.findActiveCourse(course.id)) {
    throw new ApiError('您已报名该课程，请勿重复报名', ErrorCodes.DUPLICATE)
  }

  if (courseEnrolledCount(course) >= course.maxStudents) {
    throw new ApiError('该课程名额已满', ErrorCodes.FULL)
  }

  const orderNo = 'CR' + Date.now().toString().slice(-8)
  const task = taskStore.addCourseTask(course, { orderNo })

  const expireDate = new Date()
  expireDate.setMonth(expireDate.getMonth() + 6)

  logger.info('Mock course enroll created', { orderNo, courseId: course.id, taskId: task.id })
  return {
    orderNo,
    taskId: task.id,
    courseId: course.id,
    courseName: course.name,
    courseIcon: course.icon,
    coach: course.coach,
    lessons: course.lessons,
    price: course.price,
    progress: 0,
    expireDate: expireDate.toISOString().split('T')[0],
    createTime: new Date().toLocaleString()
  }
}

/** GET: 课程列表，附带当前名额/报名人数/满员标记 */
function handleGetCourses() {
  return mockData.courses.map(course => {
    const enrolled = courseEnrolledCount(course)
    const enrolledByUser = !!taskStore.findActiveCourse(course.id)
    return {
      ...deepClone(course),
      enrolledCount: enrolled,
      remaining: Math.max(0, course.maxStudents - enrolled),
      full: enrolled >= course.maxStudents,
      enrolledByUser
    }
  })
}

/**
 * 赛事报名：登录、重复报名、满员三重校验
 */
function handleCompetitionJoin(options) {
  requireAuth()
  const body = parseBody(options)
  const comp = findCompetition(body.competitionId)
  if (!comp) throw new ApiError('赛事不存在', ErrorCodes.NOT_FOUND)

  if (comp.status !== 'upcoming' && comp.status !== 'ongoing') {
    throw new ApiError('该赛事已结束，无法报名', ErrorCodes.NOT_FOUND)
  }

  if (taskStore.findActiveCompetition(comp.id)) {
    throw new ApiError('您已报名该赛事，请勿重复报名', ErrorCodes.DUPLICATE)
  }

  if (competitionEnrolledCount(comp) >= comp.maxParticipants) {
    throw new ApiError('该赛事报名名额已满', ErrorCodes.FULL)
  }

  const regInfo = {
    regNo: 'REG' + Date.now().toString().slice(-8),
    playerNo: Math.floor(Math.random() * 100) + 1
  }
  const task = taskStore.addCompetitionTask(comp, regInfo)
  logger.info('Mock competition join created', { regNo: regInfo.regNo, taskId: task.id })

  return {
    ...regInfo,
    taskId: task.id,
    competitionId: comp.id,
    compName: comp.name
  }
}

/** GET: 赛事列表，附带当前报名人数/满员标记 */
function handleGetCompetitions() {
  return mockData.competitions.map(comp => {
    const enrolled = competitionEnrolledCount(comp)
    return {
      ...deepClone(comp),
      participants: enrolled,
      remaining: Math.max(0, comp.maxParticipants - enrolled),
      full: enrolled >= comp.maxParticipants,
      joinedByUser: !!taskStore.findActiveCompetition(comp.id)
    }
  })
}

/**
 * 商品订单：
 * - 需要登录
 * - 价格以服务端商品目录重新计算，防止前端改价
 * - 空购物车拒绝下单
 */
function handleOrders(options) {
  if (options.method === 'POST') {
    requireAuth()
    const body = parseBody(options)
    const items = Array.isArray(body.items) ? body.items : []
    if (items.length === 0) {
      throw new ApiError('购物车为空，无法结算', ErrorCodes.NOT_FOUND)
    }

    const enrichedItems = items.map(item => {
      const product = mockData.products.find(p => p.id === Number(item.productId ?? item.id))
      const qty = Math.max(1, Number(item.quantity ?? item.qty) || 1)
      const price = product ? product.price : Number(item.price) || 0
      return {
        id: product ? product.id : item.id,
        name: product ? product.name : item.name,
        brand: product ? product.brand : item.brand,
        icon: product ? product.icon : item.icon,
        price,
        qty
      }
    })

    const amount = enrichedItems.reduce((sum, i) => sum + i.price * i.qty, 0)
    const orderNo = 'SP' + Date.now().toString().slice(-8)
    const order = {
      orderNo,
      amount,
      items: enrichedItems,
      status: 'paid',
      createTime: new Date().toLocaleString()
    }
    const task = taskStore.addOrderTask(order)
    logger.info('Mock order created', { orderNo, amount, taskId: task.id })
    return { ...order, taskId: task.id }
  }
  return []
}

/**
 * 任务中心：
 * GET 需登录，返回任务列表，支持 status 参数
 * POST 需登录，执行 pay/cancel 等操作（幂等）
 */
function handleUserTasks(options) {
  requireAuth()

  if (options.method === 'POST') {
    const { taskId, action } = parseBody(options)
    logger.info('Task action via API', { taskId, action })

    if (action === 'pay') {
      const result = taskStore.markAsPaid(taskId)
      if (!result) throw new ApiError('任务不存在或已被删除', ErrorCodes.NOT_FOUND)
      return { success: true, message: '支付成功', task: result }
    }

    if (action === 'cancel') {
      // 取消：直接删除任务并释放名额；重复取消幂等返回
      const existed = !!taskStore.getById(taskId)
      if (!existed) {
        return { success: true, message: '任务已取消', task: null }
      }
      taskStore.remove(taskId)
      return { success: true, message: '取消成功', task: null }
    }

    if (action === 'confirm') {
      const result = taskStore.updateStatus(taskId, 'completed')
      if (!result) throw new ApiError('任务不存在或已被删除', ErrorCodes.NOT_FOUND)
      return { success: true, message: '操作成功', task: result }
    }

    return { success: true, message: '操作成功' }
  }

  const status = options.params?.status
  const list = status ? taskStore.getByStatus(status) : taskStore.getAll()
  return deepClone(list)
}

/**
 * 模拟请求处理器路由
 * 根据 方法 + URL 路由到对应的模拟数据处理函数
 */
async function mockRequest(url, options) {
  if (options.signal?.aborted) {
    const abortError = new Error('请求已取消')
    abortError.name = 'AbortError'
    throw abortError
  }

  // 测试环境保留极短延迟以覆盖 abort 窗口；其余环境模拟 500-900ms 网络延迟
  const latency = import.meta.env.MODE === 'test' ? 5 : 500 + Math.random() * 400
  if (latency > 0) {
    await delay(latency)
    // 测试环境下极小概率事件可忽略；保持 signal 复查
  }
  // 延迟期间可能已被关闭弹框/离开页面中止
  if (options.signal?.aborted) {
    const abortError = new Error('请求已取消')
    abortError.name = 'AbortError'
    throw abortError
  }

  const route = `${options.method || 'GET'} ${url}`
  const routes = {
    'POST /auth/login': handleLogin,
    'POST /auth/logout': handleLogout,
    'GET /tables': handleGetTables,
    'POST /bookings': handleBookings,
    'GET /bookings': handleBookings,
    'GET /courses': handleGetCourses,
    'POST /courses/enroll': handleCourseEnroll,
    'GET /competitions': handleGetCompetitions,
    'POST /competitions/join': handleCompetitionJoin,
    'GET /products': () => deepClone(mockData.products),
    'POST /orders': handleOrders,
    'GET /user/profile': () => deepClone(mockData.user),
    'GET /user/tasks': handleUserTasks,
    'POST /user/tasks': handleUserTasks
  }

  const handler = routes[route]
  if (!handler) {
    throw new ApiError(`API not found: ${route}`, ErrorCodes.NOT_FOUND)
  }
  return handler(options)
}

// ==================== 导出API方法 ====================

export const api = {
  // ========== 认证模块 ==========

  login: (username, password) => request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  }),

  logout: () => request('/auth/logout', { method: 'POST' }),

  // ========== 球桌模块 ==========

  /**
   * 获取球桌列表
   * @param {Object} params - 查询参数 { type, date }
   */
  getTables: (params) => request('/tables', { params }),

  /**
   * 创建球桌预约（需登录；同时段重复预约返回 DUPLICATE）
   */
  bookTable: (data, config = {}) => request('/bookings', {
    method: 'POST',
    body: JSON.stringify(data),
    signal: config.signal
  }),

  // ========== 课程模块 ==========

  getCourses: (config = {}) => request('/courses', { signal: config.signal }),

  /**
   * 报名课程（需登录；重复报名 DUPLICATE、满员 FULL）
   */
  enrollCourse: (data, config = {}) => request('/courses/enroll', {
    method: 'POST',
    body: JSON.stringify(data),
    signal: config.signal
  }),

  // ========== 赛事模块 ==========

  getCompetitions: (params) => request('/competitions', { params }),

  /**
   * 报名参赛（需登录；重复报名 DUPLICATE、满员 FULL）
   */
  joinCompetition: (data, config = {}) => request('/competitions/join', {
    method: 'POST',
    body: JSON.stringify(data),
    signal: config.signal
  }),

  // ========== 商品模块 ==========

  getProducts: (params) => request('/products', { params }),

  /**
   * 创建商品订单（需登录；服务端重新核价，空购物车报错）
   */
  createOrder: (data, config = {}) => request('/orders', {
    method: 'POST',
    body: JSON.stringify(data),
    signal: config.signal
  }),

  // ========== 用户模块 ==========

  getProfile: () => request('/user/profile'),

  updateProfile: (data) => request('/user/profile', {
    method: 'PUT',
    body: JSON.stringify(data)
  }),

  getBookings: () => request('/bookings'),

  // ========== 任务中心模块 ==========

  /**
   * 获取用户任务列表（需登录）
   * @param {Object} params - { status: pending/completed }
   */
  getTasks: (params) => request('/user/tasks', { params }),

  /**
   * 执行任务操作（需登录，幂等）
   * @param {Object} data - { taskId, action: pay/cancel/confirm }
   */
  doTaskAction: (data, config = {}) => request('/user/tasks', {
    method: 'POST',
    body: JSON.stringify(data),
    signal: config.signal
  })
}

export default api
