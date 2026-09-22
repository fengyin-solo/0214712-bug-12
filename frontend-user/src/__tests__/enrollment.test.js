/**
 * API 业务流程单元测试
 *
 * 覆盖：
 * - 课程/赛事报名：未登录拒绝、重复报名拒绝、满员拒绝、成功返回快照
 * - 球桌预约：同时段重复拒绝
 * - 订单：空购物车拒绝、服务端核价
 * - 任务：未登录拒绝、支付幂等、取消释放名额
 * - 写请求重复提交去重（in-flight dedup）
 * - AbortSignal 中止请求（关闭弹框/离开页面）
 * - 返回数据深拷贝，调用方不能篡改数据源
 * - 课程/赛事列表附带名额字段
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  api,
  ErrorCodes,
  isAbortError,
  __expireMockToken
} from '../utils/api'
import { login as authLogin, authState } from '../utils/auth'
import taskStore from '../utils/taskStore'

beforeEach(async () => {
  localStorage.clear()
  taskStore.__reset()
  authState.isLoggedIn = false
  authState.user = null
  authState.token = null
})

describe('受保护接口登录校验', () => {
  it('未登录报名课程返回 AUTH_EXPIRED', async () => {
    const result = await api.enrollCourse({ courseId: 1 })
    expect(result.success).toBe(false)
    expect(result.code).toBe(ErrorCodes.AUTH_EXPIRED)
  })

  it('未登录报名赛事返回 AUTH_EXPIRED', async () => {
    const result = await api.joinCompetition({ competitionId: 1 })
    expect(result.success).toBe(false)
    expect(result.code).toBe(ErrorCodes.AUTH_EXPIRED)
  })

  it('未登录创建预约/订单/读取任务均被拒绝', async () => {
    const booking = await api.bookTable({ tableId: 1, date: '2026-03-01', timeSlot: '10:00 - 12:00' })
    const order = await api.createOrder({ items: [{ productId: 1, quantity: 1 }] })
    const tasks = await api.getTasks()

    expect(booking.code).toBe(ErrorCodes.AUTH_EXPIRED)
    expect(order.code).toBe(ErrorCodes.AUTH_EXPIRED)
    expect(tasks.code).toBe(ErrorCodes.AUTH_EXPIRED)
  })

  it('登录态过期后请求返回 AUTH_EXPIRED', async () => {
    await authLogin('user', '123456')
    __expireMockToken()

    const result = await api.enrollCourse({ courseId: 1 })
    expect(result.success).toBe(false)
    expect(result.code).toBe(ErrorCodes.AUTH_EXPIRED)
  })
})

describe('课程报名流程', () => {
  beforeEach(async () => {
    await authLogin('user', '123456')
  })

  it('成功报名返回服务端快照数据并写入任务', async () => {
    // 默认演示数据中课程 1 已报名，选用未报名的课程 4
    const result = await api.enrollCourse({ courseId: 4 })

    expect(result.success).toBe(true)
    expect(result.data.orderNo).toMatch(/^CR\d+$/)
    expect(result.data.courseId).toBe(4)
    expect(result.data.courseName).toBe('比赛心理训练')
    expect(result.data.price).toBe(999)
    expect(result.data.taskId).toBeDefined()
    expect(result.data.expireDate).toBeDefined()

    const active = taskStore.findActiveCourse(4)
    expect(active).toBeTruthy()
    expect(active.amount).toBe(999)
  })

  it('重复报名同一课程返回 DUPLICATE', async () => {
    // 默认演示数据已报名课程 1
    const second = await api.enrollCourse({ courseId: 1 })
    expect(second.success).toBe(false)
    expect(second.code).toBe(ErrorCodes.DUPLICATE)
    expect(second.error).toContain('重复报名')

    const count = taskStore.countActive('course', t => t.extra?.courseId === 1)
    expect(count).toBe(1)
  })

  it('满员课程（id=3，45/45）返回 FULL', async () => {
    const result = await api.enrollCourse({ courseId: 3 })
    expect(result.success).toBe(false)
    expect(result.code).toBe(ErrorCodes.FULL)
    expect(result.error).toContain('名额已满')
  })

  it('课程不存在返回 NOT_FOUND', async () => {
    const result = await api.enrollCourse({ courseId: 9999 })
    expect(result.success).toBe(false)
    expect(result.code).toBe(ErrorCodes.NOT_FOUND)
  })

  it('取消报名（删除任务）后可再次报名', async () => {
    const first = await api.enrollCourse({ courseId: 2 })
    expect(first.success).toBe(true)
    const removed = taskStore.remove(first.data.taskId)
    expect(removed).toBe(true)

    const second = await api.enrollCourse({ courseId: 2 })
    expect(second.success).toBe(true)
  })

  it('GET /courses 返回名额信息与报名标记', async () => {
    const result = await api.getCourses()

    expect(result.success).toBe(true)
    const c1 = result.data.find(c => c.id === 1)
    const c3 = result.data.find(c => c.id === 3)

    // 默认演示数据中课程 1 已报名（156 基线 + 1）
    expect(c1.enrolledByUser).toBe(true)
    expect(c1.enrolledCount).toBe(157)
    expect(c1.remaining).toBe(43)
    expect(c1.full).toBe(false)

    expect(c3.full).toBe(true)
    expect(c3.remaining).toBe(0)
  })

  it('新报名一门课后名额相应增加', async () => {
    await api.enrollCourse({ courseId: 4 })
    const result = await api.getCourses()
    const c4 = result.data.find(c => c.id === 4)
    expect(c4.enrolledCount).toBe(31)
    expect(c4.remaining).toBe(1)
    expect(c4.enrolledByUser).toBe(true)
    expect(c4.full).toBe(false)
  })

  it('返回数据被深拷贝，修改不影响数据源', async () => {
    const r1 = await api.getCourses()
    r1.data[0].price = 1
    r1.data[0].name = '被篡改'
    const r2 = await api.getCourses()
    expect(r2.data[0].price).toBe(599)
    expect(r2.data[0].name).toBe('台球入门基础课')
  })
})

describe('赛事报名流程', () => {
  beforeEach(async () => {
    await authLogin('user', '123456')
  })

  it('成功报名返回报名编号/参赛号并写入任务', async () => {
    const result = await api.joinCompetition({ competitionId: 1 })
    expect(result.success).toBe(true)
    expect(result.data.regNo).toMatch(/^REG\d+$/)
    expect(result.data.playerNo).toBeGreaterThanOrEqual(1)
    expect(taskStore.findActiveCompetition(1)).toBeTruthy()
  })

  it('重复报名返回 DUPLICATE', async () => {
    // 默认演示数据已报名赛事 2；对赛事 1 先报名再重复
    await api.joinCompetition({ competitionId: 1 })
    const again = await api.joinCompetition({ competitionId: 1 })
    expect(again.code).toBe(ErrorCodes.DUPLICATE)
  })

  it('满员赛事（id=2，16/16，已被默认报名占位）返回 FULL', async () => {
    // 默认演示数据中赛事 2 已报名（DUPLICATE 优先）；
    // 这里改为取消默认报名后再次报名，基线人数仍为 16/16，应返回满员
    const defaultTask = taskStore.findActiveCompetition(2)
    taskStore.remove(defaultTask.id)

    const result = await api.joinCompetition({ competitionId: 2 })
    expect(result.success).toBe(false)
    expect(result.code).toBe(ErrorCodes.FULL)
  })

  it('列表返回动态报名人数/满员标记', async () => {
    const result = await api.getCompetitions()
    const c1 = result.data.find(c => c.id === 1)
    expect(c1.full).toBe(false)
    const c2 = result.data.find(c => c.id === 2)
    expect(c2.full).toBe(true)
  })
})

describe('球桌预约', () => {
  beforeEach(async () => {
    await authLogin('user', '123456')
  })

  it('同球桌同时段重复预约返回 DUPLICATE', async () => {
    const payload = { tableId: 3, date: '2026-04-10', timeSlot: '14:00 - 16:00', duration: 2 }
    const first = await api.bookTable(payload)
    expect(first.success).toBe(true)

    const second = await api.bookTable(payload)
    expect(second.success).toBe(false)
    expect(second.code).toBe(ErrorCodes.DUPLICATE)
  })

  it('不同时段可以重复预约', async () => {
    const a = await api.bookTable({ tableId: 3, date: '2026-04-11', timeSlot: '10:00 - 12:00', duration: 1 })
    const b = await api.bookTable({ tableId: 3, date: '2026-04-11', timeSlot: '14:00 - 16:00', duration: 1 })
    expect(a.success).toBe(true)
    expect(b.success).toBe(true)
  })

  it('任务金额按 单价×时长 快照计算', async () => {
    const result = await api.bookTable({ tableId: 3, date: '2026-04-12', timeSlot: '18:00 - 20:00', duration: 3 })
    const task = taskStore.getById(result.data.taskId)
    expect(task.amount).toBe(180)
  })
})

describe('商品订单', () => {
  beforeEach(async () => {
    await authLogin('user', '123456')
  })

  it('空购物车拒绝下单', async () => {
    const result = await api.createOrder({ items: [] })
    expect(result.success).toBe(false)
    expect(result.code).toBe(ErrorCodes.NOT_FOUND)
  })

  it('服务端按目录重新核价，前端改价无效', async () => {
    // 前端试图把 2999 的球杆改成 1 元
    const result = await api.createOrder({
      items: [{ productId: 1, name: 'LP专业斯诺克球杆', price: 1, quantity: 2 }]
    })
    expect(result.success).toBe(true)
    expect(result.data.amount).toBe(5998)
    expect(result.data.items[0].price).toBe(2999)
  })
})

describe('任务操作', () => {
  beforeEach(async () => {
    await authLogin('user', '123456')
  })

  it('支付任务成功后状态流转，重复支付幂等', async () => {
    const task = taskStore.add({
      type: 'course', title: 't', status: 'pending_payment', amount: 100,
      extra: { courseId: 700 }
    })

    const r1 = await api.doTaskAction({ taskId: task.id, action: 'pay' })
    expect(r1.success).toBe(true)
    expect(taskStore.getById(task.id).status).toBe('upcoming')

    const r2 = await api.doTaskAction({ taskId: task.id, action: 'pay' })
    expect(r2.success).toBe(true)
    expect(taskStore.getById(task.id).status).toBe('upcoming')
  })

  it('取消任务后名额释放，重复取消仍返回成功（幂等）', async () => {
    const enrolled = await api.enrollCourse({ courseId: 2 })
    const taskId = enrolled.data.taskId

    const cancel = await api.doTaskAction({ taskId, action: 'cancel' })
    expect(cancel.success).toBe(true)
    expect(taskStore.getById(taskId)).toBeNull()

    const again = await api.doTaskAction({ taskId, action: 'cancel' })
    expect(again.success).toBe(true)

    // 名额已释放，可重新报名
    const reenroll = await api.enrollCourse({ courseId: 2 })
    expect(reenroll.success).toBe(true)
  })

  it('支付不存在的任务报错', async () => {
    const result = await api.doTaskAction({ taskId: 'GONE', action: 'pay' })
    expect(result.success).toBe(false)
    expect(result.code).toBe(ErrorCodes.NOT_FOUND)
  })

  it('getTasks 支持 status=pending 过滤', async () => {
    const pending = await api.getTasks({ status: 'pending' })
    expect(pending.success).toBe(true)
    expect(pending.data.every(t => t.status !== 'completed' && t.status !== 'cancelled')).toBe(true)
  })
})

describe('请求层共享机制', () => {
  beforeEach(async () => {
    await authLogin('user', '123456')
  })

  it('相同写请求并发提交只执行一次（防重复提交）', async () => {
    const payload = { competitionId: 4 }
    const [r1, r2] = await Promise.all([
      api.joinCompetition(payload),
      api.joinCompetition(payload)
    ])

    expect(r1.success).toBe(true)
    // 第二个复用第一个 Promise，结果一致，且不会产生第二条任务
    expect(r2.data.regNo).toBe(r1.data.regNo)
    expect(taskStore.countActive('competition', t => t.extra?.competitionId === 4)).toBe(1)
  })

  it('请求发出后 abort 返回 ABORTED（模拟关闭弹框/离开页面）', async () => {
    const controller = new AbortController()
    const promise = api.enrollCourse({ courseId: 2 }, { signal: controller.signal })
    // 在请求延迟窗口内中止
    controller.abort()
    const result = await promise

    expect(isAbortError(result)).toBe(true)
    expect(taskStore.findActiveCourse(2)).toBeNull()
  })
})
