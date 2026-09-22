/**
 * taskStore 单元测试
 *
 * 覆盖：
 * - 重复报名幂等（同课程/赛事/订单/预约只保留一条有效记录）
 * - 取消/完成后名额释放，可再次报名
 * - 空记录与损坏数据兜底
 * - 支付、取消等任务结果不串改
 * - 学习进度按 courseId 隔离更新
 * - 刷新后从 localStorage 恢复，且版本号驱动派生更新
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { taskStore, taskState } from '../utils/taskStore'

const STORAGE_KEY = 'billiard_user_tasks'

const courseA = { id: 1, name: '台球入门基础课', icon: '🎯', coach: '张明', lessons: '8课时', price: 599 }
const courseB = { id: 2, name: '斯诺克进阶训练', icon: '🎱', coach: '李强', lessons: '12课时', price: 1299 }

function resetStore() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([]))
  taskState.version = 0
}

describe('taskStore', () => {
  beforeEach(() => {
    resetStore()
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('空记录与脏数据', () => {
    it('存储为空时返回空数组', () => {
      localStorage.setItem(STORAGE_KEY, '[]')
      expect(taskStore.getAll()).toEqual([])
    })

    it('JSON 损坏时回退默认数据，不抛异常', () => {
      localStorage.setItem(STORAGE_KEY, 'not-a-json')
      expect(() => taskStore.getAll()).not.toThrow()
      expect(taskStore.getAll().length).toBeGreaterThan(0)
    })

    it('存储的是非数组时回退默认数据', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: 1 }))
      expect(Array.isArray(taskStore.getAll())).toBe(true)
    })

    it('clearAll 后立即为空', () => {
      taskStore.addCourseTask(courseA, { orderNo: 'X1' })
      taskStore.clearAll()
      expect(taskStore.getAll()).toEqual([])
    })
  })

  describe('课程报名幂等', () => {
    it('同一课程重复 addCourseTask 只保留一条任务', () => {
      const first = taskStore.addCourseTask(courseA, { orderNo: 'CR1' })
      const second = taskStore.addCourseTask(courseA, { orderNo: 'CR2' })

      expect(second.id).toBe(first.id)
      const courseTasks = taskStore.getAll().filter(t => t.type === 'course' && t.extra.courseId === 1)
      expect(courseTasks).toHaveLength(1)
    })

    it('不同课程各自独立，不互相影响', () => {
      taskStore.addCourseTask(courseA, { orderNo: 'CR1' })
      taskStore.addCourseTask(courseB, { orderNo: 'CR2' })

      expect(taskStore.countActiveCourseEnrollments(1)).toBe(1)
      expect(taskStore.countActiveCourseEnrollments(2)).toBe(1)
      expect(taskStore.getCourseEnrollments()).toHaveLength(2)
    })

    it('取消（remove）后名额释放，允许重新报名', () => {
      const task = taskStore.addCourseTask(courseA, { orderNo: 'CR1' })
      expect(taskStore.isCourseEnrolled(1)).toBe(true)
      expect(taskStore.countActiveCourseEnrollments(1)).toBe(1)

      expect(taskStore.remove(task.id)).toBe(true)
      expect(taskStore.isCourseEnrolled(1)).toBe(false)
      expect(taskStore.countActiveCourseEnrollments(1)).toBe(0)

      const again = taskStore.addCourseTask(courseA, { orderNo: 'CR2' })
      expect(again.id).not.toBe(task.id)
      expect(taskStore.countActiveCourseEnrollments(1)).toBe(1)
    })

    it('已完成的旧报名不拦截新报名', () => {
      const old = taskStore.addCourseTask(courseA, { orderNo: 'CR1' })
      taskStore.updateStatus(old.id, 'completed')
      expect(taskStore.isCourseEnrolled(1)).toBe(false)

      const renewed = taskStore.addCourseTask(courseA, { orderNo: 'CR2' })
      expect(renewed.status).toBe('upcoming')
      expect(taskStore.countActiveCourseEnrollments(1)).toBe(1)
    })
  })

  describe('赛事/订单/预约幂等', () => {
    it('同一赛事重复报名只保留一条', () => {
      const comp = { id: 7, name: '测试赛', fee: 100, status: 'upcoming', date: '2026-05-01' }
      taskStore.addCompetitionTask(comp, { regNo: 'R1', playerNo: 1 })
      taskStore.addCompetitionTask(comp, { regNo: 'R2', playerNo: 2 })

      const compTasks = taskStore.getAll().filter(t => t.type === 'competition' && t.extra.competitionId === 7)
      expect(compTasks).toHaveLength(1)
    })

    it('相同 orderNo 的订单只保留一条', () => {
      taskStore.addOrderTask({ orderNo: 'SP999', amount: 100, items: [], createTime: 'now' })
      taskStore.addOrderTask({ orderNo: 'SP999', amount: 100, items: [], createTime: 'now' })

      expect(taskStore.getAll().filter(t => t.type === 'order' && t.extra.orderNo === 'SP999')).toHaveLength(1)
    })

    it('同球桌同时段重复预约只保留一条，不同时段允许两条', () => {
      const table = { id: 3, name: '3号球桌', type: '美式九球', price: 60 }
      taskStore.addBookingTask(table, { orderNo: 'B1', date: '2026-03-01', time: '14:00 - 16:00', duration: 2 })
      taskStore.addBookingTask(table, { orderNo: 'B2', date: '2026-03-01', time: '14:00 - 16:00', duration: 2 })
      taskStore.addBookingTask(table, { orderNo: 'B3', date: '2026-03-01', time: '16:00 - 18:00', duration: 2 })

      const bookings = taskStore.getAll().filter(t => t.type === 'booking' && t.extra.tableId === 3)
      expect(bookings).toHaveLength(2)
    })
  })

  describe('支付与任务结果', () => {
    it('课程任务支付后状态由待付款变为待开始', () => {
      const task = taskStore.addCourseTask(courseA, { orderNo: 'CR1', status: 'pending_payment' })
      expect(task.status).toBe('pending_payment')

      const paid = taskStore.markAsPaid(task.id)
      expect(paid.status).toBe('upcoming')
      expect(paid.subtitle).toContain('支付成功')
    })

    it('订单任务支付后进入待发货', () => {
      const order = { orderNo: 'SP1', amount: 200, items: [], createTime: 'now' }
      const task = taskStore.add({
        type: 'order',
        title: '商品',
        subtitle: '待支付',
        amount: 200,
        status: 'pending_payment',
        extra: { orderNo: 'SP1' }
      })
      const paid = taskStore.markAsPaid(task.id)
      expect(paid.status).toBe('pending_shipment')
    })

    it('支付不存在的任务返回 null，不产生副作用', () => {
      expect(taskStore.markAsPaid('not-exist')).toBeNull()
    })

    it('update 不允许改写 id/type 身份字段', () => {
      const task = taskStore.addCourseTask(courseA, { orderNo: 'CR1' })
      const updated = taskStore.update(task.id, { id: 'HACK', type: 'order' })
      expect(updated.id).toBe(task.id)
      expect(updated.type).toBe('course')
    })
  })

  describe('学习进度隔离', () => {
    it('只更新指定 courseId 的进度', () => {
      const taskA = taskStore.addCourseTask(courseA, { orderNo: 'CR1' })
      taskStore.addCourseTask(courseB, { orderNo: 'CR2' })

      taskStore.updateCourseProgress(1, 30)

      const a = taskStore.getById(taskA.id)
      expect(a.extra.progress).toBe(30)
      const b = taskStore.getAll().find(t => t.extra.courseId === 2)
      expect(b.extra.progress).toBe(0)
    })

    it('进度自动夹取到 0-100', () => {
      const task = taskStore.addCourseTask(courseA, { orderNo: 'CR1' })
      taskStore.updateCourseProgress(1, 200)
      expect(taskStore.getById(task.id).extra.progress).toBe(100)
      taskStore.updateCourseProgress(1, -5)
      expect(taskStore.getById(task.id).extra.progress).toBe(0)
    })

    it('对未报名课程更新进度返回 null，不创建脏数据', () => {
      expect(taskStore.updateCourseProgress(999, 50)).toBeNull()
      expect(taskStore.getAll()).toHaveLength(0)
    })

    it('更新课程进度不串改价格与名称', () => {
      const task = taskStore.addCourseTask(courseA, { orderNo: 'CR1' })
      taskStore.updateCourseProgress(1, 40)
      const fresh = taskStore.getById(task.id)
      expect(fresh.title).toBe('台球入门基础课')
      expect(fresh.amount).toBe(599)
      expect(fresh.extra.price).toBe(599)
      expect(fresh.extra.progress).toBe(40)
    })
  })

  describe('刷新/响应式版本', () => {
    it('写入后自增 version，读取可看到刷新后的数据', () => {
      const v0 = taskState.version
      taskStore.addCourseTask(courseA, { orderNo: 'CR1' })
      expect(taskState.version).toBeGreaterThan(v0)

      // 模拟刷新：重新读取 localStorage
      expect(taskStore.isCourseEnrolled(1)).toBe(true)
    })

    it('remove 不存在的任务返回 false', () => {
      expect(taskStore.remove('nope')).toBe(false)
    })

    it('getByStatus 正确区分待处理与已完成', () => {
      const t1 = taskStore.addCourseTask(courseA, { orderNo: 'CR1' })
      const t2 = taskStore.addCourseTask(courseB, { orderNo: 'CR2' })
      taskStore.updateStatus(t2.id, 'completed')

      expect(taskStore.getPendingCount()).toBe(1)
      expect(taskStore.getCompletedCount()).toBe(1)
      expect(taskStore.getByStatus('pending').map(t => t.id)).toContain(t1.id)
      expect(taskStore.getByStatus('completed').map(t => t.id)).toContain(t2.id)
    })

    it('enrichTask 不返回共享的 actions 引用', () => {
      taskStore.addCourseTask(courseA, { orderNo: 'CR1' })
      const [a] = taskStore.getAll()
      const [b] = taskStore.getAll()
      expect(a.actions).not.toBe(b.actions)
    })
  })
})
